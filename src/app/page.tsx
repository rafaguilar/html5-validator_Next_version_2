
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
// Defines a list of possible dimensions if not found in filename or meta tag
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
  // console.log(`[resolveAssetPathInZip] Attempting to resolve: base='${baseFilePath}', asset='${assetPath}'`);
  if (assetPath.startsWith('data:') || assetPath.startsWith('http:') || assetPath.startsWith('https:')) {
    // console.log(`[resolveAssetPathInZip] Path is data URI or absolute URL, not resolving: ${assetPath}`);
    return null; 
  }

  const baseDir = baseFilePath.includes('/') ? baseFilePath.substring(0, baseFilePath.lastIndexOf('/') + 1) : '';
  let fullPathAttempt;

  if (assetPath.startsWith('/')) { // Asset path is absolute from ZIP root
    fullPathAttempt = assetPath.substring(1);
    // console.log(`[resolveAssetPathInZip] Asset path starts with '/', treating as root-relative: '${fullPathAttempt}'`);
  } else { // Asset path is relative to the baseFilePath
    const pathParts = (baseDir + assetPath).split('/');
    const resolvedParts: string[] = [];
    for (const part of pathParts) {
      if (part === '.' || part === '') continue; // Ignore . and empty parts
      if (part === '..') {
        if (resolvedParts.length > 0) {
          resolvedParts.pop();
        } else {
          console.warn(`[resolveAssetPathInZip] Path traversal above root for: base='${baseFilePath}', asset='${assetPath}'`);
          return null; // Cannot go above root
        }
      } else {
        resolvedParts.push(part);
      }
    }
    fullPathAttempt = resolvedParts.join('/');
    // console.log(`[resolveAssetPathInZip] Resolved relative path: baseDir='${baseDir}', assetPath='${assetPath}', result='${fullPathAttempt}'`);
  }
  
  if (zip.file(fullPathAttempt)) {
    // console.log(`[resolveAssetPathInZip] Found file at primary resolved path: '${fullPathAttempt}'`);
    return fullPathAttempt;
  }

  // Fallback: try assetPath directly as if it's root-relative (common mistake in creatives)
  if (fullPathAttempt !== assetPath && zip.file(assetPath)) { 
    // console.log(`[resolveAssetPathInZip] Found file at fallback root-relative path: '${assetPath}'`);
    return assetPath;
  }
  
  console.warn(`[resolveAssetPathInZip] Could NOT RESOLVE asset: base='${baseFilePath}', asset='${assetPath}'. Tried full path='${fullPathAttempt}' and direct path='${assetPath}' (if different).`);
  return null;
};

// Helper function to inline URLs within CSS content
const inlineCssUrls = async (cssContent: string, cssFilePath: string, zip: JSZip): Promise<string> => {
  // console.log(`[inlineCssUrls] Processing CSS file: ${cssFilePath}`);
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

  if (matches.length === 0) {
    // console.log(`[inlineCssUrls] No url() patterns found in ${cssFilePath}. CSS content (first 300 chars): ${cssContent.substring(0,300)}`);
    return cssContent; // No URLs to process
  }
  
  let resolvedAnyUrl = false;

  // Process matches in reverse order to avoid index issues when replacing
  for (let i = matches.length - 1; i >= 0; i--) {
    const currentMatch = matches[i];
    let assetPath = currentMatch.assetPath.trim();

    // console.log(`[inlineCssUrls] Found URL in ${cssFilePath}: '${currentMatch.originalUrlPattern}', extracted asset path: '${assetPath}'`);

    if (assetPath.startsWith('data:') || assetPath.startsWith('http:') || assetPath.startsWith('https:')) {
      // console.log(`[inlineCssUrls] Asset path '${assetPath}' is data URI or absolute URL, skipping.`);
      continue; 
    }

    const resolvedAssetZipPath = resolveAssetPathInZip(cssFilePath, assetPath, zip);

    if (resolvedAssetZipPath) {
      const assetFile = zip.file(resolvedAssetZipPath);
      if (assetFile) {
        try {
          console.log(`[inlineCssUrls] Inlining asset '${resolvedAssetZipPath}' referenced from CSS '${cssFilePath}' (original URL pattern: '${currentMatch.originalUrlPattern}')`);
          const base64Content = await assetFile.async('base64');
          const mimeType = getMimeTypeFromPath(resolvedAssetZipPath);
          const dataUri = `data:${mimeType};base64,${base64Content}`;
          updatedCssContent = 
            updatedCssContent.substring(0, currentMatch.index) + 
            `url(${dataUri})` + 
            updatedCssContent.substring(currentMatch.index + currentMatch.length);
          resolvedAnyUrl = true;
          // console.log(`[inlineCssUrls] Successfully inlined '${resolvedAssetZipPath}' as data URI.`);
        } catch (e) {
          console.warn(`[inlineCssUrls] Failed to read/encode asset ${resolvedAssetZipPath} for CSS ${cssFilePath}:`, e);
        }
      } else {
         console.warn(`[inlineCssUrls] Asset file object NOT FOUND in zip for CSS asset: '${resolvedAssetZipPath}' (referenced by ${cssFilePath} for path '${assetPath}')`);
      }
    } else {
      // console.warn(`[inlineCssUrls] Could NOT RESOLVE asset path in zip for CSS asset: '${assetPath}' (referenced from ${cssFilePath} with pattern '${currentMatch.originalUrlPattern}')`);
    }
  }
  
  if (matches.length > 0 && !resolvedAnyUrl) {
    console.warn(`[inlineCssUrls] Processed ${matches.length} url() patterns in ${cssFilePath} but failed to resolve/inline any of them.`);
  }
  return updatedCssContent;
};


const extractAndProcessHtmlFromZip = async (file: File): Promise<string | undefined> => {
  console.log(`[extractAndProcessHtmlFromZip] Starting processing for file: ${file.name}`);
  try {
    const zip = await JSZip.loadAsync(file);
    const zipFileEntries = Object.keys(zip.files);
    console.log('[extractAndProcessHtmlFromZip] ZIP file entries:', zipFileEntries);

    let htmlFileEntry: JSZipObject | null = null;
    let htmlFilePath = ""; 
    let baseDirFromZipRoot = ""; 

    const commonRootHtmlNames = ["index.html", "Index.html"];
    for (const name of commonRootHtmlNames) {
        const potentialRootPath = name; 
        const filesInRootFolder = zipFileEntries.find(entry => entry.toLowerCase().endsWith(`/${name.toLowerCase()}`));
        
        if (zip.file(potentialRootPath)) { // Check actual root first
            htmlFileEntry = zip.file(potentialRootPath);
            htmlFilePath = potentialRootPath;
            console.log(`[extractAndProcessHtmlFromZip] Found HTML file at ZIP root: ${htmlFilePath}`);
            break; 
        } else if (filesInRootFolder) { // Check if it's in a single top-level folder
            const parts = filesInRootFolder.split('/');
            if (parts.length === 2) { // e.g. "folderName/index.html"
                 htmlFileEntry = zip.file(filesInRootFolder);
                 htmlFilePath = filesInRootFolder;
                 console.log(`[extractAndProcessHtmlFromZip] Found HTML file in single root subfolder: ${htmlFilePath}`);
                 break;
            }
        }
    }
    
    if (!htmlFileEntry) {
        const anyHtmlFiles = zipFileEntries.filter(name => 
            !name.startsWith('__MACOSX/') && 
            !name.endsWith('/') && 
            name.toLowerCase().endsWith('.html')
        );

        if (anyHtmlFiles.length > 0) {
            htmlFilePath = anyHtmlFiles[0]; 
            htmlFileEntry = zip.file(htmlFilePath);
            console.log(`[extractAndProcessHtmlFromZip] Found HTML file (possibly in subdir): ${htmlFilePath}`);
        } else {
            console.warn(`[extractAndProcessHtmlFromZip] No HTML file found in ZIP: ${file.name}`);
            return undefined;
        }
    }

    if (htmlFilePath.includes('/')) {
        baseDirFromZipRoot = htmlFilePath.substring(0, htmlFilePath.lastIndexOf('/') + 1);
        console.log(`[extractAndProcessHtmlFromZip] Determined base directory in ZIP: '${baseDirFromZipRoot}'`);
    }


    if (htmlFileEntry) {
      const htmlContent = await htmlFileEntry.async("string");
      const doc = new DOMParser().parseFromString(htmlContent, "text/html");
      const alreadyInlinedCssPaths = new Set<string>();

      const linkNodes = Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'));
      console.log(`[extractAndProcessHtmlFromZip] Found ${linkNodes.length} <link rel="stylesheet"> tags.`);
      await Promise.all(linkNodes.map(async (linkNode) => {
        const href = linkNode.getAttribute('href');
        if (href && !(href.startsWith('http:') || href.startsWith('https:'))) {
          console.log(`[extractAndProcessHtmlFromZip] Processing <link href="${href}">`);
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
                console.log(`[extractAndProcessHtmlFromZip] Successfully inlined <link href="${href}"> as <style> tag (resolved path: ${assetZipPath})`);
              } catch (e) {
                console.warn(`[extractAndProcessHtmlFromZip] Failed to inline CSS ${href} (resolved path: ${assetZipPath}):`, e);
              }
            } else {
                console.warn(`[extractAndProcessHtmlFromZip] CSS asset file object not found in zip for <link href="${href}"> (resolved path: ${assetZipPath})`);
            }
          } else {
             console.warn(`[extractAndProcessHtmlFromZip] Could not resolve CSS path for <link href="${href}"> (base HTML: ${htmlFilePath})`);
          }
        }
      }));

      const scriptNodes = Array.from(doc.querySelectorAll('script[src]'));
      console.log(`[extractAndProcessHtmlFromZip] Found ${scriptNodes.length} <script src="..."> tags.`);
      await Promise.all(scriptNodes.map(async (scriptNode) => {
        const src = scriptNode.getAttribute('src');
        if (src && !(src.startsWith('http:') || src.startsWith('https:'))) { 
          console.log(`[extractAndProcessHtmlFromZip] Processing <script src="${src}">`);
          const assetZipPath = resolveAssetPathInZip(htmlFilePath, src, zip);
          if (assetZipPath) {
            const assetFile = zip.file(assetZipPath);
            if (assetFile) {
              try {
                const jsContent = await assetFile.async('string');
                const newScriptNode = doc.createElement('script');
                newScriptNode.textContent = jsContent;
                Array.from(scriptNode.attributes).forEach(attr => {
                    if (attr.name.toLowerCase() !== 'src') {
                        newScriptNode.setAttribute(attr.name, attr.value);
                    }
                });
                scriptNode.parentNode?.replaceChild(newScriptNode, scriptNode);
                console.log(`[extractAndProcessHtmlFromZip] Successfully inlined <script src="${src}"> (resolved path: ${assetZipPath})`);
              } catch (e) {
                console.warn(`[extractAndProcessHtmlFromZip] Failed to inline JS ${src} (resolved path: ${assetZipPath}):`, e);
              }
            } else {
                 console.warn(`[extractAndProcessHtmlFromZip] JS asset file object not found in zip for <script src="${src}"> (resolved path: ${assetZipPath})`);
            }
          } else {
            console.warn(`[extractAndProcessHtmlFromZip] Could not resolve JS path for <script src="${src}"> (base HTML: ${htmlFilePath})`);
          }
        }
      }));

      const imgNodes = Array.from(doc.querySelectorAll('img[src]'));
      console.log(`[extractAndProcessHtmlFromZip] Found ${imgNodes.length} <img src="..."> tags.`);
      await Promise.all(imgNodes.map(async (imgNode) => {
        const src = imgNode.getAttribute('src');
        if (src && !src.startsWith('data:') && !(src.startsWith('http:') || src.startsWith('https:'))) {
          console.log(`[extractAndProcessHtmlFromZip] Processing <img src="${src}">`);
          const assetZipPath = resolveAssetPathInZip(htmlFilePath, src, zip);
          if (assetZipPath) {
            const assetFile = zip.file(assetZipPath);
            if (assetFile) {
              try {
                const base64Content = await assetFile.async('base64');
                const mimeType = getMimeTypeFromPath(assetZipPath);
                imgNode.setAttribute('src', `data:${mimeType};base64,${base64Content}`);
                console.log(`[extractAndProcessHtmlFromZip] Successfully inlined <img src="${src}"> (resolved path: ${assetZipPath})`);
              } catch (e) {
                console.warn(`[extractAndProcessHtmlFromZip] Failed to inline image ${src} (resolved path: ${assetZipPath}):`, e);
              }
            } else {
                 console.warn(`[extractAndProcessHtmlFromZip] Image asset file object not found in zip for <img src="${src}"> (resolved path: ${assetZipPath})`);
            }
          } else {
            console.warn(`[extractAndProcessHtmlFromZip] Could not resolve image path for <img src="${src}"> (base HTML: ${htmlFilePath})`);
          }
        }
      }));
      
      const sourceNodes = Array.from(doc.querySelectorAll('source[src]'));
      console.log(`[extractAndProcessHtmlFromZip] Found ${sourceNodes.length} <source src="..."> tags.`);
       await Promise.all(sourceNodes.map(async (sourceNode) => {
        const src = sourceNode.getAttribute('src');
        if (src && !src.startsWith('data:') && !(src.startsWith('http:') || src.startsWith('https:'))) {
          console.log(`[extractAndProcessHtmlFromZip] Processing <source src="${src}">`);
          const assetZipPath = resolveAssetPathInZip(htmlFilePath, src, zip);
          if (assetZipPath) {
            const assetFile = zip.file(assetZipPath);
            if (assetFile) {
              try {
                const base64Content = await assetFile.async('base64');
                const mimeType = getMimeTypeFromPath(assetZipPath);
                sourceNode.setAttribute('src', `data:${mimeType};base64,${base64Content}`);
                console.log(`[extractAndProcessHtmlFromZip] Successfully inlined <source src="${src}"> (resolved path: ${assetZipPath})`);
              } catch (e) {
                console.warn(`[extractAndProcessHtmlFromZip] Failed to inline source ${src} (resolved path: ${assetZipPath}):`, e);
              }
            } else {
                console.warn(`[extractAndProcessHtmlFromZip] Source asset file object not found in zip for <source src="${src}"> (resolved path: ${assetZipPath})`);
            }
          } else {
            console.warn(`[extractAndProcessHtmlFromZip] Could not resolve source path for <source src="${src}"> (base HTML: ${htmlFilePath})`);
          }
        }
      }));

      const commonCssFileSuffixes = ['style.css', 'css/style.css', 'main.css', 'css/main.css'];
      console.log(`[extractAndProcessHtmlFromZip] Starting proactive CSS inlining. Base dir in ZIP: '${baseDirFromZipRoot}'. Checking suffixes: ${commonCssFileSuffixes.join(', ')}`);
      
      for (const commonSuffix of commonCssFileSuffixes) {
        const fullCssPathInZip = baseDirFromZipRoot + commonSuffix;
        if (!alreadyInlinedCssPaths.has(fullCssPathInZip)) { 
          const cssFileEntry = zip.file(fullCssPathInZip); 
          if (cssFileEntry) {
            console.log(`[extractAndProcessHtmlFromZip] Attempting to proactively inline CSS: ${fullCssPathInZip}`);
            try {
              const rawCssContent = await cssFileEntry.async('string');
              const processedCssContent = await inlineCssUrls(rawCssContent, fullCssPathInZip, zip); 
              const styleNode = doc.createElement('style');
              styleNode.textContent = processedCssContent;
              doc.head.appendChild(styleNode);
              alreadyInlinedCssPaths.add(fullCssPathInZip); 
              console.log(`[extractAndProcessHtmlFromZip] Successfully proactively inlined CSS: ${fullCssPathInZip}`);
            } catch (e) {
              console.warn(`[extractAndProcessHtmlFromZip] Failed to proactively inline CSS ${fullCssPathInZip}:`, e);
            }
          } else {
            // console.log(`[extractAndProcessHtmlFromZip] Proactive CSS path not found in ZIP: ${fullCssPathInZip}`);
          }
        } else {
          // console.log(`[extractAndProcessHtmlFromZip] Proactive CSS path already inlined (from <link>): ${fullCssPathInZip}`);
        }
      }
      console.log(`[extractAndProcessHtmlFromZip] Finished processing. Serializing HTML.`);
      return doc.documentElement.outerHTML;
    }
    console.warn(`[extractAndProcessHtmlFromZip] HTML file entry was null for ${file.name}`);
    return undefined;
  } catch (error) {
    console.error(`[extractAndProcessHtmlFromZip] Error processing ZIP file ${file.name} or inlining assets:`, error);
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
    simulatedMetaTagContentString = `width=${fileIntrinsicWidth},height=${fileIntrinsicHeight}`; // Assume meta matches filename if present
    actualMetaWidth = fileIntrinsicWidth; 
    actualMetaHeight = fileIntrinsicHeight;
  } else {
    const metaTagScenario = Math.random();
    if (metaTagScenario < 0.05) { 
      simulatedMetaTagContentString = null; 
      issues.push(createMockIssue('error', 'Required ad.size meta tag not found in HTML.', 'Ensure <meta name="ad.size" content="width=XXX,height=XXX"> is present.'));
    } else if (metaTagScenario < 0.15) { 
      const malformType = Math.random();
      if (malformType < 0.25) simulatedMetaTagContentString = "width=300,height=BAD";
      else if (malformType < 0.50) simulatedMetaTagContentString = "width=300";
      else if (malformType < 0.75) simulatedMetaTagContentString = "height=250";
      else simulatedMetaTagContentString = "size=300x250";
      issues.push(createMockIssue('error', 'Invalid ad.size meta tag format.', `Meta tag content found: "${simulatedMetaTagContentString}". Expected format: "width=XXX,height=XXX".`));
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
          issues.push(createMockIssue('error', 'Invalid numeric values in ad.size meta tag.', `Parsed non-numeric values from: "${simulatedMetaTagContentString}"`));
        }
      } else {
         issues.push(createMockIssue('error', 'Malformed ad.size meta tag content (fallback parsing).', `Content: "${simulatedMetaTagContentString}". Expected "width=XXX,height=YYY".`));
      }
    }
  }
  
  let expectedDim: { width: number; height: number };
  if (actualMetaWidth !== undefined && actualMetaHeight !== undefined) {
    expectedDim = { width: actualMetaWidth, height: actualMetaHeight };
  } else if (fileIntrinsicWidth !== undefined && fileIntrinsicHeight !== undefined) {
      expectedDim = { width: fileIntrinsicWidth, height: fileIntrinsicHeight };
  } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0) {
      expectedDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
  } else {
      expectedDim = { width: 300, height: 250 }; 
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

  const clickTagScenario = Math.random();
  if (clickTagScenario > 0.1) { 
    const ct1: ClickTagInfo = { name: 'clickTag', url: "https://www.symbravohcp.com", isHttps: true };
    const ct2: ClickTagInfo = { name: 'clickTag2', url: "http://www.axsome.com/symbravo-prescribing-information.pdf", isHttps: false };
    detectedClickTags.push(ct1, ct2);
    if (!ct2.isHttps) {
      issues.push(createMockIssue('warning', `ClickTag '${ct2.name}' uses non-HTTPS URL.`, `URL: ${ct2.url}`));
    }
  } else { 
    issues.push(createMockIssue('error', 'Missing or invalid clickTag implementation.'));
  }
  
  const fileStructureOk = true;

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
         const htmlProcessingErrorIssue = createMockIssue('error', `Failed to process HTML from ${file.name}.`, (e as Error).message);
         initialResults[index].issues.push(htmlProcessingErrorIssue);
         initialResults[index].status = 'error'; 
      }

      const mockResultPart = await mockValidateFile(file);
      
      const finalIssues = [...initialResults[index].issues, ...mockResultPart.issues];
      
      let finalStatus = mockResultPart.status; 
      if (initialResults[index].status === 'error' || finalIssues.some(issue => issue.type === 'error')) {
        finalStatus = 'error'; 
      } else if (finalStatus !== 'error' && finalIssues.some(issue => issue.type === 'warning')) {
        finalStatus = 'warning'; 
      }


      return {
        ...initialResults[index], 
        ...mockResultPart,        
        htmlContent: processedHtmlContent, 
        issues: finalIssues,       
        status: finalStatus,       
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

