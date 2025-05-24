
"use client";

import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import { AppHeader } from '@/components/layout/header';
import { FileUploader } from '@/components/html-validator/file-uploader';
import { ValidationResults } from '@/components/html-validator/validation-results';
import type { ValidationResult, ValidationIssue, ClickTagInfo } from '@/types';
import { useToast } from "@/hooks/use-toast";

const MOCK_MAX_FILE_SIZE = 2.2 * 1024 * 1024; // 2.2MB
const POSSIBLE_FALLBACK_DIMENSIONS = [
  { width: 300, height: 250 }, { width: 728, height: 90 },
  { width: 160, height: 600 }, { width: 300, height: 600 },
  { width: 468, height: 60 },  { width: 120, height: 600 },
  { width: 320, height: 50 },   { width: 300, height: 50 },
  { width: 970, height: 250 }, { width: 336, height: 280 },
];


const createMockIssue = (type: 'error' | 'warning', message: string, details?: string): ValidationIssue => ({
  id: `issue-${Math.random().toString(36).substr(2, 9)}`,
  type,
  message,
  details,
});

const extractHtmlContentFromZip = async (file: File): Promise<string | null> => {
  try {
    const zip = await JSZip.loadAsync(file);
    let htmlFile = zip.file("index.html") || zip.file(/[^/]+\.html$/i)[0]; // index.html at root or first .html at root
    
    if (!htmlFile) { // If not found at root, search deeper
        const htmlFiles = zip.file(/\.html$/i); // Get all .html files
        if (htmlFiles.length > 0) {
            // Prefer index.html if available anywhere
            const indexFile = htmlFiles.find(f => f.name.toLowerCase().endsWith('index.html'));
            htmlFile = indexFile || htmlFiles[0]; // Pick index.html or the first one found
        }
    }

    if (htmlFile) {
      return await htmlFile.async("string");
    }
    return null;
  } catch (error) {
    console.error("Error extracting HTML from ZIP:", error);
    return null;
  }
};

const findClickTagsInHtml = (htmlContent: string | null): ClickTagInfo[] => {
  if (!htmlContent) return [];

  const clickTags: ClickTagInfo[] = [];
  // Regex to find clickTag assignments: var clickTag = "URL"; or var clickTagN = "URL";
  // or window.clickTag = "URL"; Also handles single quotes and case-insensitivity for "clickTag".
  const clickTagRegex = /(?:var|window\.)\s*([a-zA-Z0-9_]*clickTag[a-zA-Z0-9_]*)\s*=\s*["'](http[^"']+)["']/gi;
  
  let match;
  // First, find all script contents
  const scriptContentRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  let fullScriptContent = "";
  while ((scriptMatch = scriptContentRegex.exec(htmlContent)) !== null) {
    fullScriptContent += scriptMatch[1] + "\n";
  }

  // Then, parse clickTags from the aggregated script content
  while ((match = clickTagRegex.exec(fullScriptContent)) !== null) {
    const name = match[1];
    const url = match[2];
    clickTags.push({
      name,
      url,
      isHttps: url.startsWith('https://'),
    });
  }
  return clickTags;
};


const buildValidationResult = async (
  file: File, 
  htmlContent: string | null, 
  detectedClickTagsFromParsing: ClickTagInfo[]
): Promise<Omit<ValidationResult, 'id' | 'fileName' | 'fileSize'>> => {
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

  const issues: ValidationIssue[] = [];
  let status: ValidationResult['status'] = 'success';
  
  // Use the actually detected clickTags
  const detectedClickTags = detectedClickTagsFromParsing;

  if (detectedClickTags.length === 0) {
     issues.push(createMockIssue('error', 'No clickTags found or clickTag implementation is missing/invalid.'));
  } else {
    for (const tag of detectedClickTags) {
      if (!tag.isHttps) {
        issues.push(createMockIssue('warning', `ClickTag '${tag.name}' uses non-HTTPS URL.`, `URL: ${tag.url}`));
      }
    }
  }

  let actualMetaWidth: number | undefined = undefined;
  let actualMetaHeight: number | undefined = undefined;
  let simulatedMetaTagContentString: string | null = null;

  let fileIntrinsicWidth: number | undefined;
  let fileIntrinsicHeight: number | undefined;
  const filenameDimMatch = file.name.match(/_(\d+)x(\d+)(?:[^/]*)\.zip$/i);

  if (filenameDimMatch && filenameDimMatch[1] && filenameDimMatch[2]) {
    fileIntrinsicWidth = parseInt(filenameDimMatch[1], 10);
    fileIntrinsicHeight = parseInt(filenameDimMatch[2], 10);
    simulatedMetaTagContentString = `width=${fileIntrinsicWidth},height=${fileIntrinsicHeight}`; // Simulate meta tag based on filename
    const metaMatch = simulatedMetaTagContentString.match(/width=(\d+)[,;]?\s*height=(\d+)/i);
      if (metaMatch && metaMatch[1] && metaMatch[2]) {
        const wVal = parseInt(metaMatch[1], 10);
        const hVal = parseInt(metaMatch[2], 10);
        if (!isNaN(wVal) && !isNaN(hVal)) {
          actualMetaWidth = wVal;
          actualMetaHeight = hVal;
        } else {
           issues.push(createMockIssue('error', 'Invalid numeric values in ad.size meta tag (from filename).', `Parsed non-numeric values from: "${simulatedMetaTagContentString}"`));
        }
      } else {
         issues.push(createMockIssue('error', 'Malformed ad.size meta tag content (from filename parsing).', `Content: "${simulatedMetaTagContentString}". Expected "width=XXX,height=YYY".`));
      }
  } else if (htmlContent) { // Try to parse from actual HTML if no filename dimensions
    const metaTagRegex = /<meta\s+name=["']ad\.size["']\s+content=["']([^"']+)["'][^>]*>/i;
    const metaTagMatch = htmlContent.match(metaTagRegex);
    if (metaTagMatch && metaTagMatch[1]) {
      simulatedMetaTagContentString = metaTagMatch[1];
      const metaMatch = simulatedMetaTagContentString.match(/width=(\d+)[,;]?\s*height=(\d+)/i);
      if (metaMatch && metaMatch[1] && metaMatch[2]) {
        const wVal = parseInt(metaMatch[1], 10);
        const hVal = parseInt(metaMatch[2], 10);
        if (!isNaN(wVal) && !isNaN(hVal)) {
          actualMetaWidth = wVal;
          actualMetaHeight = hVal;
        } else {
           issues.push(createMockIssue('error', 'Invalid numeric values in ad.size meta tag.', `Parsed non-numeric values from: "${simulatedMetaTagContentString}"`));
        }
      } else {
         issues.push(createMockIssue('error', 'Malformed ad.size meta tag content.', `Content: "${simulatedMetaTagContentString}". Expected "width=XXX,height=YYY".`));
      }
    } else {
      issues.push(createMockIssue('error', 'Required ad.size meta tag not found in HTML.', 'Ensure <meta name="ad.size" content="width=XXX,height=XXX"> is present.'));
    }
  } else { // Fallback if no filename dimensions and no HTML content
    const metaTagScenario = Math.random();
    if (metaTagScenario < 0.05) { 
      simulatedMetaTagContentString = null;
      issues.push(createMockIssue('error', 'Required ad.size meta tag not found (simulated).', 'Ensure <meta name="ad.size" content="width=XXX,height=XXX"> is present.'));
    } else if (metaTagScenario < 0.15) { 
      const malformType = Math.random();
      if (malformType < 0.25) simulatedMetaTagContentString = "width=300,height=BAD";
      else if (malformType < 0.50) simulatedMetaTagContentString = "width=300";
      else if (malformType < 0.75) simulatedMetaTagContentString = "height=250";
      else simulatedMetaTagContentString = "size=300x250";
      issues.push(createMockIssue('error', 'Invalid ad.size meta tag format (simulated).', `Meta tag content found: "${simulatedMetaTagContentString}". Expected format: "width=XXX,height=YYY".`));
    } else { 
      const chosenFallbackDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
      simulatedMetaTagContentString = `width=${chosenFallbackDim.width},height=${chosenFallbackDim.height}`;
      const metaMatch = simulatedMetaTagContentString.match(/width=(\d+)[,;]?\s*height=(\d+)/i);
      if (metaMatch && metaMatch[1] && metaMatch[2]) {
        const wVal = parseInt(metaMatch[1], 10);
        const hVal = parseInt(metaMatch[2], 10);
        if (!isNaN(wVal) && !isNaN(hVal)) {
          actualMetaWidth = wVal;
          actualMetaHeight = hVal;
        } else {
          issues.push(createMockIssue('error', 'Invalid numeric values in ad.size meta tag (simulated).', `Parsed non-numeric values from: "${simulatedMetaTagContentString}"`));
        }
      } else {
         issues.push(createMockIssue('error', 'Malformed ad.size meta tag content (simulated fallback parsing).', `Content: "${simulatedMetaTagContentString}". Expected "width=XXX,height=YYY".`));
      }
    }
  }
  

  let expectedDim: { width: number; height: number };
  if (actualMetaWidth !== undefined && actualMetaHeight !== undefined) {
    expectedDim = { width: actualMetaWidth, height: actualMetaHeight };
  } else if (fileIntrinsicWidth !== undefined && fileIntrinsicHeight !== undefined) {
      expectedDim = { width: fileIntrinsicWidth, height: fileIntrinsicHeight };
      if (!issues.some(iss => iss.message.includes("ad.size meta tag"))) { 
        issues.push(createMockIssue('warning', 'Ad dimensions inferred from filename due to missing/invalid ad.size meta tag.'));
      }
  } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0) {
      const fallbackDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
      expectedDim = {width: fallbackDim.width, height: fallbackDim.height};
      if (simulatedMetaTagContentString !== null && !issues.some(issue => issue.message.includes("ad.size meta tag"))) {
         issues.push(createMockIssue('warning', `Ad dimensions are a fallback guess (${fallbackDim.width}x${fallbackDim.height}). Verify ad.size meta tag and filename conventions.`));
      } else if (simulatedMetaTagContentString === null && !htmlContent) { // Only if HTML content wasn't available either
         issues.push(createMockIssue('warning', `Dimensions defaulted to ${fallbackDim.width}x${fallbackDim.height} due to missing meta tag (or HTML parse error) and no dimensions in filename.`));
      }
  } else {
      expectedDim = { width: 300, height: 250 }; 
      issues.push(createMockIssue('error', 'Could not determine ad dimensions. Ensure ad.size meta tag or filename convention is used.'));
  }

  const adDimensions: ValidationResult['adDimensions'] = {
    width: expectedDim.width,
    height: expectedDim.height,
    actual: (actualMetaWidth !== undefined && actualMetaHeight !== undefined)
            ? { width: actualMetaWidth, height: actualMetaHeight }
            : undefined,
  };

  const isTooLarge = file.size > MOCK_MAX_FILE_SIZE;
  if (isTooLarge) {
    issues.push(createMockIssue('error', `File size exceeds limit (${(MOCK_MAX_FILE_SIZE / (1024*1024)).toFixed(1)}MB).`));
  }

  const fileStructureOk = true; // Assume true for now, can be refined later

  if (Math.random() < 0.10 && issues.length === 0 && !isTooLarge && !htmlContent) { // Only add if no html content
     issues.push(createMockIssue('warning', 'Creative uses deprecated JavaScript features (simulated).', 'Consider updating to modern ES6+ syntax for better performance and compatibility.'));
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
    htmlContent: htmlContent || undefined, // Include actual HTML content if extracted
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
      let initialWidth = 0;
      let initialHeight = 0;
      const filenameDimMatch = file.name.match(/_(\d+)x(\d+)(?:[^/]*)\.zip$/i);
      if (filenameDimMatch && filenameDimMatch[1] && filenameDimMatch[2]) {
        initialWidth = parseInt(filenameDimMatch[1], 10);
        initialHeight = parseInt(filenameDimMatch[2], 10);
      } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0) {
        const tempDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
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
        fileStructureOk: true, 
        adDimensions: {
          width: initialWidth,
          height: initialHeight,
          actual: undefined
        },
        detectedClickTags: undefined,
        htmlContent: undefined,
      };
    });

    const initialResults = await Promise.all(initialResultsPromises);
    setValidationResults(initialResults);

    const resultsPromises = selectedFiles.map(async (file, index) => {
      const htmlContent = await extractHtmlContentFromZip(file);
      const detectedClickTags = findClickTagsInHtml(htmlContent);
      const validationResultPart = await buildValidationResult(file, htmlContent, detectedClickTags);
      
      const finalIssues = [...initialResults[index].issues, ...validationResultPart.issues];

      let finalStatus = validationResultPart.status;
      if (initialResults[index].status === 'error' || finalIssues.some(issue => issue.type === 'error')) {
        finalStatus = 'error';
      } else if (finalStatus !== 'error' && (initialResults[index].status === 'warning' || finalIssues.some(issue => issue.type === 'warning'))) {
        finalStatus = 'warning';
      }

      return {
        ...initialResults[index], 
        ...validationResultPart, 
        issues: finalIssues,
        status: finalStatus,
        htmlContent: htmlContent || undefined,
      };
    });

    for (let i = 0; i < resultsPromises.length; i++) {
      try {
        const result = await resultsPromises[i];
        setValidationResults(prevResults =>
          prevResults.map(pr => pr.id === result.id ? result : pr)
        );
      } catch (error) {
        let errorInitialWidth = 0;
        let errorInitialHeight = 0;
        const errorFilenameDimMatch = selectedFiles[i].name.match(/_(\d+)x(\d+)(?:[^/]*)\.zip$/i);
        if (errorFilenameDimMatch && errorFilenameDimMatch[1] && errorFilenameDimMatch[2]) {
            errorInitialWidth = parseInt(errorFilenameDimMatch[1], 10);
            errorInitialHeight = parseInt(errorFilenameDimMatch[2], 10);
        } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0) {
            const tempDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
            errorInitialWidth = tempDim.width;
            errorInitialHeight = tempDim.height;
        }

        const errorResult: ValidationResult = {
          id: `${selectedFiles[i].name}-${Date.now()}-error-${Math.random()}`,
          fileName: selectedFiles[i].name,
          status: 'error',
          issues: [createMockIssue('error', 'An unexpected error occurred during validation process.', (error as Error).message)],
          fileSize: selectedFiles[i].size,
          maxFileSize: MOCK_MAX_FILE_SIZE,
          fileStructureOk: false,
           adDimensions: {
            width: errorInitialWidth,
            height: errorInitialHeight,
            actual: undefined
          },
          htmlContent: undefined,
        };
        setValidationResults(prevResults =>
          prevResults.map(pr => (pr.fileName === selectedFiles[i].name && (pr.status === 'validating' || pr.id.includes('-pending-'))) ? errorResult : pr)
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
