
"use client";

import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import type { JSZipObject } from 'jszip';
import { AppHeader } from '@/components/layout/header';
import { FileUploader } from '@/components/html-validator/file-uploader';
import { ValidationResults } from '@/components/html-validator/validation-results';
import type { ValidationResult, ValidationIssue, ClickTagInfo } from '@/types';
import { useToast } from "@/hooks/use-toast";

const MOCK_MAX_FILE_SIZE = 2.2 * 1024 * 1024; // 2.2MB
const POSSIBLE_ACTUAL_DIMENSIONS_FROM_META_FALLBACK = [ // Used if filename has no dims AND meta tag is being simulated as "valid but random"
  { width: 300, height: 250 }, { width: 728, height: 90 },
  { width: 160, height: 600 }, { width: 300, height: 600 },
  { width: 468, height: 60 },  { width: 120, height: 600 },
  { width: 320, height: 50 },   { width: 300, height: 50 },
  { width: 970, height: 250 }, { width: 336, height: 280 },
];
// Fallback if filename has no dims AND meta tag is missing/invalid
const MOCK_EXPECTED_DIMENSIONS_FALLBACK = POSSIBLE_ACTUAL_DIMENSIONS_FROM_META_FALLBACK;


const createMockIssue = (type: 'error' | 'warning', message: string, details?: string): ValidationIssue => ({
  id: `issue-${Math.random().toString(36).substr(2, 9)}`,
  type,
  message,
  details,
});

const getMimeTypeFromPath = (filePath: string): string => {
  const extension = filePath.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    case 'css': return 'text/css';
    case 'js': return 'application/javascript';
    case 'html': return 'text/html';
    // Font MIME types
    case 'woff': return 'font/woff';
    case 'woff2': return 'font/woff2';
    case 'ttf': return 'font/ttf';
    case 'eot': return 'application/vnd.ms-fontobject';
    case 'otf': return 'font/otf';
    default: return 'application/octet-stream';
  }
};

const resolveAssetPathInZip = (baseFilePath: string, assetPath: string, zip: JSZip): string | null => {
  if (assetPath.startsWith('data:') || assetPath.startsWith('http:') || assetPath.startsWith('https:')) {
    return null; // It's a data URI or an absolute external URL, not a local zip asset
  }

  const baseDir = baseFilePath.includes('/') ? baseFilePath.substring(0, baseFilePath.lastIndexOf('/') + 1) : '';
  let fullPathAttempt;

  if (assetPath.startsWith('/')) {
    // Absolute path from ZIP root
    fullPathAttempt = assetPath.substring(1);
  } else {
    // Relative path
    const pathParts = (baseDir + assetPath).split('/');
    const resolvedParts: string[] = [];
    for (const part of pathParts) {
      if (part === '.' || part === '') continue;
      if (part === '..') {
        if (resolvedParts.length > 0) {
          resolvedParts.pop();
        } else {
          // Tried to go above root, path is likely invalid relative to zip structure
          // console.warn(`[resolveAssetPathInZip] Path traversal above root for: base='${baseFilePath}', asset='${assetPath}'`);
          return null;
        }
      } else {
        resolvedParts.push(part);
      }
    }
    fullPathAttempt = resolvedParts.join('/');
  }
  
  if (zip.file(fullPathAttempt)) return fullPathAttempt;

  // Fallback: try assetPath directly as if it's root-relative (common mistake in creatives)
  if (zip.file(assetPath)) return assetPath;
  
  // console.warn(`[resolveAssetPathInZip] Could not resolve: base='${baseFilePath}', asset='${assetPath}', triedFull='${fullPathAttempt}'`);
  return null;
};

// Helper function to inline URLs within CSS content
const inlineCssUrls = async (cssContent: string, cssFilePath: string, zip: JSZip): Promise<string> => {
  const urlRegex = /url\(\s*(?:['"]?)([^'"\)\?#]+)(?:['"]?)[\?#]?[^)]*\s*\)/g;
  let updatedCssContent = cssContent;
  
  const matches = [];
  let match;
  while ((match = urlRegex.exec(cssContent)) !== null) {
    matches.push({
      originalUrlPattern: match[0], 
      assetPath: match[1],
      index: match.index,
      length: match[0].length,
    });
  }

  for (let i = matches.length - 1; i >= 0; i--) {
    const currentMatch = matches[i];
    let assetPath = currentMatch.assetPath.trim();

    if (assetPath.startsWith('data:') || assetPath.startsWith('http:') || assetPath.startsWith('https:')) {
      continue; 
    }

    const resolvedAssetZipPath = resolveAssetPathInZip(cssFilePath, assetPath, zip);

    if (resolvedAssetZipPath) {
      const assetFile = zip.file(resolvedAssetZipPath);
      if (assetFile) {
        try {
          const base64Content = await assetFile.async('base64');
          const mimeType = getMimeTypeFromPath(resolvedAssetZipPath);
          const dataUri = `data:${mimeType};base64,${base64Content}`;
          updatedCssContent = 
            updatedCssContent.substring(0, currentMatch.index) + 
            `url(${dataUri})` + 
            updatedCssContent.substring(currentMatch.index + currentMatch.length);
        } catch (e) {
          // console.warn(`Failed to inline asset ${assetPath} from CSS ${cssFilePath}:`, e);
        }
      } else {
        //  console.warn(`[inlineCssUrls] Asset file object not found in zip for CSS asset: ${resolvedAssetZipPath} (referenced by ${cssFilePath} for path ${assetPath})`);
      }
    } else {
      // console.warn(`[inlineCssUrls] Could not resolve asset path in zip for CSS asset: ${assetPath} (referenced by ${cssFilePath})`);
    }
  }
  return updatedCssContent;
};


const extractAndProcessHtmlFromZip = async (file: File): Promise<string | undefined> => {
  try {
    const zip = await JSZip.loadAsync(file);
    let htmlFileEntry: JSZipObject | null = zip.file("index.html");
    let htmlFilePath = "index.html";

    if (!htmlFileEntry) {
      const htmlFiles = zip.file(/\.html?$/i);
      const rootHtmlFiles = htmlFiles.filter(f => !f.name.includes('/') && f.name !== file.name);
      if (rootHtmlFiles.length > 0) {
        htmlFileEntry = rootHtmlFiles[0];
        htmlFilePath = rootHtmlFiles[0].name;
      } else if (htmlFiles.length > 0) {
        htmlFileEntry = htmlFiles[0];
        htmlFilePath = htmlFiles[0].name;
      }
    }

    if (htmlFileEntry) {
      const htmlContent = await htmlFileEntry.async("string");
      const doc = new DOMParser().parseFromString(htmlContent, "text/html");
      const alreadyInlinedCssPaths = new Set<string>();

      // Inline CSS (<link rel="stylesheet">) and process their internal url() references
      const linkNodes = Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'));
      await Promise.all(linkNodes.map(async (linkNode) => {
        const href = linkNode.getAttribute('href');
        if (href) {
          const assetZipPath = resolveAssetPathInZip(htmlFilePath, href, zip);
          if (assetZipPath) {
            const assetFile = zip.file(assetZipPath);
            if (assetFile) {
              try {
                const rawCssContent = await assetFile.async('string');
                const processedCssContent = await inlineCssUrls(rawCssContent, assetZipPath, zip);
                const styleNode = doc.createElement('style');
                styleNode.textContent = processedCssContent;
                linkNode.parentNode?.replaceChild(styleNode, linkNode);
                alreadyInlinedCssPaths.add(assetZipPath);
              } catch (e) {
                // console.warn(`Failed to inline CSS ${href}:`, e);
              }
            }
          }
        }
      }));

      // Inline JavaScript (<script src="...">)
      const scriptNodes = Array.from(doc.querySelectorAll('script[src]'));
      await Promise.all(scriptNodes.map(async (scriptNode) => {
        const src = scriptNode.getAttribute('src');
        if (src && !(src.startsWith('http:') || src.startsWith('https:'))) { // Only process local scripts
          const assetZipPath = resolveAssetPathInZip(htmlFilePath, src, zip);
          if (assetZipPath) {
            const assetFile = zip.file(assetZipPath);
            if (assetFile) {
              try {
                const jsContent = await assetFile.async('string');
                const newScriptNode = doc.createElement('script');
                newScriptNode.textContent = jsContent;
                scriptNode.parentNode?.replaceChild(newScriptNode, scriptNode);
              } catch (e) {
                // console.warn(`Failed to inline JS ${src}:`, e);
              }
            }
          }
        }
      }));

      // Inline Images (<img src="...">)
      const imgNodes = Array.from(doc.querySelectorAll('img[src]'));
      await Promise.all(imgNodes.map(async (imgNode) => {
        const src = imgNode.getAttribute('src');
        if (src && !src.startsWith('data:')) {
          const assetZipPath = resolveAssetPathInZip(htmlFilePath, src, zip);
          if (assetZipPath) {
            const assetFile = zip.file(assetZipPath);
            if (assetFile) {
              try {
                const base64Content = await assetFile.async('base64');
                const mimeType = getMimeTypeFromPath(assetZipPath);
                imgNode.setAttribute('src', `data:${mimeType};base64,${base64Content}`);
              } catch (e) {
                // console.warn(`Failed to inline image ${src}:`, e);
              }
            }
          }
        }
      }));
      
      // Inline <source src="...">
      const sourceNodes = Array.from(doc.querySelectorAll('source[src]'));
       await Promise.all(sourceNodes.map(async (sourceNode) => {
        const src = sourceNode.getAttribute('src');
        if (src && !src.startsWith('data:')) {
          const assetZipPath = resolveAssetPathInZip(htmlFilePath, src, zip);
          if (assetZipPath) {
            const assetFile = zip.file(assetZipPath);
            if (assetFile) {
              try {
                const base64Content = await assetFile.async('base64');
                const mimeType = getMimeTypeFromPath(assetZipPath);
                sourceNode.setAttribute('src', `data:${mimeType};base64,${base64Content}`);
              } catch (e) {
                // console.warn(`Failed to inline source ${src}:`, e);
              }
            }
          }
        }
      }));

      // Proactive inlining of common local CSS files potentially loaded by scripts
      const commonCssFilePaths = ['style.css', 'css/style.css', 'main.css', 'css/main.css'];
      for (const commonPath of commonCssFilePaths) {
        if (!alreadyInlinedCssPaths.has(commonPath)) {
          const cssFileEntry = zip.file(commonPath);
          if (cssFileEntry) {
            try {
              // console.log(`[extractAndProcessHtmlFromZip] Proactively inlining CSS: ${commonPath}`);
              const rawCssContent = await cssFileEntry.async('string');
              const processedCssContent = await inlineCssUrls(rawCssContent, commonPath, zip);
              const styleNode = doc.createElement('style');
              styleNode.textContent = processedCssContent;
              doc.head.appendChild(styleNode);
              alreadyInlinedCssPaths.add(commonPath); // Mark as inlined
            } catch (e) {
              // console.warn(`Failed to proactively inline CSS ${commonPath}:`, e);
            }
          }
        }
      }

      return doc.documentElement.outerHTML;
    }
    return undefined;
  } catch (error) {
    // console.error("Error processing ZIP file or inlining assets:", file.name, error);
    return undefined;
  }
};


const mockValidateFile = async (file: File): Promise<Omit<ValidationResult, 'id' | 'fileName' | 'fileSize' | 'htmlContent'>> => {
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200)); 

  const issues: ValidationIssue[] = [];
  let status: ValidationResult['status'] = 'success';
  const detectedClickTags: ClickTagInfo[] = [];
  
  let actualMetaWidth: number | undefined = undefined;
  let actualMetaHeight: number | undefined = undefined;
  let simulatedMetaTagContentString: string | null = null;

  let fileIntrinsicWidth: number | undefined;
  let fileIntrinsicHeight: number | undefined;
  const filenameDimMatch = file.name.match(/_(\d+)x(\d+)(?:[^/]*)\.zip$/i);

  if (filenameDimMatch && filenameDimMatch[1] && filenameDimMatch[2]) {
    fileIntrinsicWidth = parseInt(filenameDimMatch[1], 10);
    fileIntrinsicHeight = parseInt(filenameDimMatch[2], 10);
    // If filename has dimensions, assume meta tag is correct and reflects these
    simulatedMetaTagContentString = `width=${fileIntrinsicWidth},height=${fileIntrinsicHeight}`;
    actualMetaWidth = fileIntrinsicWidth; // Directly use filename dimensions for "actual" if meta is "correct"
    actualMetaHeight = fileIntrinsicHeight;
  } else {
    // Filename does not have dimensions, simulate meta tag status randomly
    const metaTagScenario = Math.random();
    if (metaTagScenario < 0.05) { // 5% chance missing
      simulatedMetaTagContentString = null; 
      issues.push(createMockIssue('error', 'Required ad.size meta tag not found in HTML.', 'Ensure <meta name="ad.size" content="width=XXX,height=XXX"> is present.'));
    } else if (metaTagScenario < 0.15) { // 10% chance malformed
      const malformType = Math.random();
      if (malformType < 0.25) simulatedMetaTagContentString = "width=300,height=BAD";
      else if (malformType < 0.50) simulatedMetaTagContentString = "width=300";
      else if (malformType < 0.75) simulatedMetaTagContentString = "height=250";
      else simulatedMetaTagContentString = "size=300x250";
      issues.push(createMockIssue('error', 'Invalid ad.size meta tag format.', `Meta tag content found: "${simulatedMetaTagContentString}". Expected format: "width=XXX,height=XXX".`));
    } else { // 85% chance present and "valid" (randomly chosen dimensions)
      const chosenFallbackDim = POSSIBLE_ACTUAL_DIMENSIONS_FROM_META_FALLBACK[Math.floor(Math.random() * POSSIBLE_ACTUAL_DIMENSIONS_FROM_META_FALLBACK.length)];
      simulatedMetaTagContentString = `width=${chosenFallbackDim.width},height=${chosenFallbackDim.height}`;
      // Attempt to parse this simulated string for actualMetaWidth/Height
      const match = simulatedMetaTagContentString.match(/width=(\d+)[,;]?\s*height=(\d+)/i);
      if (match && match[1] && match[2]) {
        const wVal = parseInt(match[1], 10);
        const hVal = parseInt(match[2], 10);
        if (!isNaN(wVal) && !isNaN(hVal)) {
          actualMetaWidth = wVal;
          actualMetaHeight = hVal;
        } else {
          issues.push(createMockIssue('error', 'Invalid numeric values in ad.size meta tag.', `Parsed non-numeric values from: "${simulatedMetaTagContentString}"`));
        }
      } else {
         issues.push(createMockIssue('error', 'Malformed ad.size meta tag content (fallback parsing).', `Content: "${simulatedMetaTagContentString}". Expected "width=XXX,height=YYY".`));
      }
    }
  }
  
  let expectedDim: { width: number; height: number };
  if (actualMetaWidth !== undefined && actualMetaHeight !== undefined) {
    // If meta tag was valid and provided dimensions, these are the expected dimensions.
    expectedDim = { width: actualMetaWidth, height: actualMetaHeight };
  } else {
    // Fallback if meta tag was missing/invalid
    if (fileIntrinsicWidth !== undefined && fileIntrinsicHeight !== undefined) {
        expectedDim = { width: fileIntrinsicWidth, height: fileIntrinsicHeight }; // Use filename dimensions if meta fails
    } else if (MOCK_EXPECTED_DIMENSIONS_FALLBACK.length > 0) {
        expectedDim = MOCK_EXPECTED_DIMENSIONS_FALLBACK[Math.floor(Math.random() * MOCK_EXPECTED_DIMENSIONS_FALLBACK.length)]; // Use a random default from the list
    } else {
        expectedDim = { width: 300, height: 250 }; // Absolute fallback if everything else fails
    }
  }
  
  const adDimensions: ValidationResult['adDimensions'] = {
    width: expectedDim.width, 
    height: expectedDim.height, 
    actual: (actualMetaWidth !== undefined && actualMetaHeight !== undefined)
            ? { width: actualMetaWidth, height: actualMetaHeight }
            : undefined, // actual will be undefined if meta tag was missing or malformed
  };

  // File Size Check
  const isTooLarge = file.size > MOCK_MAX_FILE_SIZE;
  if (isTooLarge) {
    issues.push(createMockIssue('error', `File size exceeds limit (${(MOCK_MAX_FILE_SIZE / (1024*1024)).toFixed(1)}MB).`));
  }

  // ClickTag Simulation
  const clickTagScenario = Math.random();
  if (clickTagScenario > 0.1) { // 90% chance to find these clickTags
    const ct1: ClickTagInfo = { name: 'clickTag', url: "https://www.symbravohcp.com", isHttps: true };
    const ct2: ClickTagInfo = { name: 'clickTag2', url: "http://www.axsome.com/symbravo-prescribing-information.pdf", isHttps: false };
    detectedClickTags.push(ct1, ct2);

    if (!ct2.isHttps) {
      issues.push(createMockIssue('warning', `ClickTag '${ct2.name}' uses non-HTTPS URL.`, `URL: ${ct2.url}`));
    }
  } else { // 10% chance no clickTags are found
    issues.push(createMockIssue('error', 'Missing or invalid clickTag implementation.'));
  }
  
  const fileStructureOk = true; // Assume structure is OK for mock.

  if (Math.random() < 0.10 && issues.length === 0 && !isTooLarge) {
     issues.push(createMockIssue('warning', 'Creative uses deprecated JavaScript features.', 'Consider updating to modern ES6+ syntax for better performance and compatibility.'));
  }

  const hasErrors = issues.some(issue => issue.type === 'error');
  const hasWarnings = issues.some(issue => issue.type === 'warning');

  if (hasErrors) {
    status = 'error';
  } else if (hasWarnings) {
    status = 'warning';
  } else {
    status = 'success';
  }
  
  if (!isTooLarge && file.size > MOCK_MAX_FILE_SIZE * 0.75 && !hasErrors) {
    issues.push(createMockIssue('warning', 'File size is large, consider optimizing assets for faster loading.', `Current size: ${(file.size / (1024*1024)).toFixed(2)}MB.`));
    if (status !== 'error') status = 'warning';
  }

  return {
    status,
    issues,
    adDimensions, 
    fileStructureOk,
    detectedClickTags: detectedClickTags.length > 0 ? detectedClickTags : undefined,
    maxFileSize: MOCK_MAX_FILE_SIZE,
  };
};


export default function HomePage() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleValidateFiles = async () => {
    if (selectedFiles.length === 0) {
      toast({
        title: "No files selected",
        description: "Please select one or more ZIP files to validate.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    const initialResultsPromises = selectedFiles.map(async (file) => {
      // For initial display, try to get dimensions from filename, then fallback
      let initialWidth = 0;
      let initialHeight = 0;
      const filenameDimMatch = file.name.match(/_(\d+)x(\d+)(?:[^/]*)\.zip$/i);
      if (filenameDimMatch && filenameDimMatch[1] && filenameDimMatch[2]) {
        initialWidth = parseInt(filenameDimMatch[1], 10);
        initialHeight = parseInt(filenameDimMatch[2], 10);
      } else if (MOCK_EXPECTED_DIMENSIONS_FALLBACK.length > 0) {
        const tempDim = MOCK_EXPECTED_DIMENSIONS_FALLBACK[Math.floor(Math.random() * MOCK_EXPECTED_DIMENSIONS_FALLBACK.length)];
        initialWidth = tempDim.width;
        initialHeight = tempDim.height;
      }

      return {
        id: `${file.name}-${Date.now()}-pending-${Math.random()}`,
        fileName: file.name,
        status: 'validating' as ValidationResult['status'],
        issues: [],
        fileSize: file.size,
        maxFileSize: MOCK_MAX_FILE_SIZE,
        fileStructureOk: true, // Assume OK initially
        adDimensions: { 
          width: initialWidth, 
          height: initialHeight,
          actual: undefined 
        },
        htmlContent: undefined, 
      };
    });

    const initialResults = await Promise.all(initialResultsPromises);
    setValidationResults(initialResults);
    
    const resultsPromises = selectedFiles.map(async (file, index) => {
      let processedHtmlContent: string | undefined;
      try {
        processedHtmlContent = await extractAndProcessHtmlFromZip(file);
      } catch (e) {
        // console.error(`Failed to extract and process HTML for ${file.name}`, e);
         const htmlProcessingErrorIssue = createMockIssue('error', `Failed to process HTML from ${file.name}.`, (e as Error).message);
         initialResults[index].issues.push(htmlProcessingErrorIssue);
         initialResults[index].status = 'error'; 
      }

      const mockResultPart = await mockValidateFile(file);
      
      const finalIssues = [...initialResults[index].issues, ...mockResultPart.issues];
      let finalStatus = mockResultPart.status;
      if (initialResults[index].status === 'error' || finalIssues.some(issue => issue.type === 'error')) {
        finalStatus = 'error';
      } else if (finalIssues.some(issue => issue.type === 'warning')) {
        finalStatus = 'warning';
      }


      return {
        ...initialResults[index], 
        ...mockResultPart,        
        htmlContent: processedHtmlContent, 
        issues: finalIssues,      
        status: finalStatus,
        // Ensure adDimensions from mockValidateFile (which now considers meta tags more directly) are used
        adDimensions: mockResultPart.adDimensions 
      };
    });
    
    for (let i = 0; i < resultsPromises.length; i++) {
      try {
        const result = await resultsPromises[i];
        setValidationResults(prevResults => 
          prevResults.map(pr => pr.id === result.id ? result : pr)
        );
      } catch (error) {
        // console.error("Validation error for file:", selectedFiles[i].name, error);
        
        let errorInitialWidth = 0;
        let errorInitialHeight = 0;
        const errorFilenameDimMatch = selectedFiles[i].name.match(/_(\d+)x(\d+)(?:[^/]*)\.zip$/i);
        if (errorFilenameDimMatch && errorFilenameDimMatch[1] && errorFilenameDimMatch[2]) {
            errorInitialWidth = parseInt(errorFilenameDimMatch[1], 10);
            errorInitialHeight = parseInt(errorFilenameDimMatch[2], 10);
        } else if (MOCK_EXPECTED_DIMENSIONS_FALLBACK.length > 0) {
            const tempDim = MOCK_EXPECTED_DIMENSIONS_FALLBACK[Math.floor(Math.random() * MOCK_EXPECTED_DIMENSIONS_FALLBACK.length)];
            errorInitialWidth = tempDim.width;
            errorInitialHeight = tempDim.height;
        }

        const errorResult: ValidationResult = {
          id: `${selectedFiles[i].name}-${Date.now()}-error-${Math.random()}`,
          fileName: selectedFiles[i].name,
          status: 'error',
          issues: [createMockIssue('error', 'An unexpected error occurred during validation.', (error as Error).message)],
          fileSize: selectedFiles[i].size,
          fileStructureOk: false, 
           adDimensions: {
            width: errorInitialWidth,
            height: errorInitialHeight,
            actual: undefined
          },
          htmlContent: undefined,
        };
        setValidationResults(prevResults => 
          prevResults.map(pr => (pr.fileName === selectedFiles[i].name && (pr.status === 'validating' || pr.id.endsWith('-pending'))) ? errorResult : pr)
        );
      }
    }
    
    setIsLoading(false);
    toast({
      title: "Validation Complete",
      description: `Processed ${selectedFiles.length} file(s). Check the report below.`,
    });
  };
  
  useEffect(() => {
    if (selectedFiles.length === 0) {
        setValidationResults([]);
    }
  }, [selectedFiles]);


  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-grow container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto space-y-8">
          <FileUploader
            selectedFiles={selectedFiles}
            setSelectedFiles={setSelectedFiles}
            onValidate={handleValidateFiles}
            isLoading={isLoading}
          />
          <ValidationResults results={validationResults} isLoading={isLoading} />
        </div>
      </main>
      <footer className="py-6 text-center text-sm text-muted-foreground border-t bg-card">
        © {new Date().getFullYear()} HTML Validator. All rights reserved.
      </footer>
    </div>
  );
}

