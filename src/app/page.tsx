"use client";

import React, { useState, useEffect, ChangeEvent } from 'react';
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

interface MissingAssetInfo {
  type: 'cssRef' | 'htmlImg' | 'htmlSource' | 'htmlLinkCss' | 'htmlScript';
  path: string; // The path of the missing asset as referenced
  referencedFrom: string; // Path of the file (HTML or CSS) that referenced it
  originalSrc: string; // The original src/href/url value
}

const createMockIssue = (type: 'error' | 'warning', message: string, details?: string): ValidationIssue => ({
  id: `issue-${Math.random().toString(36).substr(2, 9)}`,
  type,
  message,
  details,
});

// Helper to resolve asset paths within the ZIP, considering the base path of the referencing file (HTML or CSS)
const resolveAssetPathInZip = (assetPath: string, baseFilePath: string, zip: JSZip): string | null => {
  if (assetPath.startsWith('data:') || assetPath.startsWith('http:') || assetPath.startsWith('https://') || assetPath.startsWith('//')) {
    return assetPath; // Absolute URL or data URI, not in ZIP, or already processed
  }

  let basePathSegments = baseFilePath.includes('/') ? baseFilePath.split('/').slice(0, -1) : []; // Directory of the base file
  const assetPathSegments = assetPath.split('/');
  let combinedSegments = [...basePathSegments];

  for (const segment of assetPathSegments) {
    if (segment === '..') {
      if (combinedSegments.length > 0) {
        combinedSegments.pop();
      }
    } else if (segment !== '.' && segment !== '') {
      combinedSegments.push(segment);
    }
  }
  
  const resolvedPath = combinedSegments.join('/');
  
  if (zip.file(resolvedPath)) {
    return resolvedPath;
  } else {
    // console.warn(`[resolveAssetPathInZip] WARN: Could not resolve asset path "${assetPath}" from base "${baseFilePath}". Tried "${resolvedPath}". File exists? ${!!zip.file(resolvedPath)}`);
    return null; 
  }
};


// Function to find the primary HTML file in a ZIP
const findHtmlFileInZip = async (zip: JSZip): Promise<{ path: string, content: string } | null> => {
  // Prioritize index.html at the root of any directory structure within the zip
  const allFiles = Object.keys(zip.files);
  const rootIndexHtml = allFiles.find(path => path.toLowerCase().endsWith('index.html') && !path.substring(0, path.lastIndexOf('/')).includes('/'));
  if (rootIndexHtml && zip.file(rootIndexHtml)) {
      const content = await zip.file(rootIndexHtml)!.async("string");
      return { path: rootIndexHtml, content };
  }
  
  // Fallback: any index.html
  const anyIndexHtml = allFiles.find(path => path.toLowerCase().endsWith('index.html'));
   if (anyIndexHtml && zip.file(anyIndexHtml)) {
      const content = await zip.file(anyIndexHtml)!.async("string");
      return { path: anyIndexHtml, content };
  }

  // Fallback: first .html file at the root of any directory structure
  const firstRootHtml = allFiles.find(path => path.toLowerCase().endsWith('.html') && !path.substring(0, path.lastIndexOf('/')).includes('/'));
  if (firstRootHtml && zip.file(firstRootHtml)) {
      const content = await zip.file(firstRootHtml)!.async("string");
      return { path: firstRootHtml, content };
  }

  // Fallback: first .html file anywhere
  const firstAnyHtml = allFiles.find(path => path.toLowerCase().endsWith('.html'));
  if (firstAnyHtml && zip.file(firstAnyHtml)) {
      const content = await zip.file(firstAnyHtml)!.async("string");
      return { path: firstAnyHtml, content };
  }
  
  return null;
};

// Function to process CSS content and identify missing assets referenced via url()
// Also collects successfully referenced asset paths.
const processCssContentAndCollectReferences = async (
  cssContent: string,
  cssFilePath: string, // Full path of the CSS file within the ZIP
  zip: JSZip,
  missingAssetsCollector: MissingAssetInfo[],
  referencedAssetPathsCollector: Set<string>
): Promise<void> => {
  const urlPattern = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match;

  while ((match = urlPattern.exec(cssContent)) !== null) {
    const originalUrl = match[0]; 
    const assetUrlFromCss = match[2];

    if (assetUrlFromCss.startsWith('data:') || assetUrlFromCss.startsWith('http:') || assetUrlFromCss.startsWith('https://') || assetUrlFromCss.startsWith('//')) {
      continue; 
    }

    const resolvedAssetPath = resolveAssetPathInZip(assetUrlFromCss, cssFilePath, zip);

    if (resolvedAssetPath && zip.file(resolvedAssetPath)) {
      referencedAssetPathsCollector.add(resolvedAssetPath);
    } else {
      missingAssetsCollector.push({
        type: 'cssRef',
        path: assetUrlFromCss,
        referencedFrom: cssFilePath,
        originalSrc: originalUrl 
      });
    }
  }
};


// Analyzes creative assets within a ZIP for missing linked resources and unreferenced files
const analyzeCreativeAssets = async (file: File): Promise<{
  missingAssets: MissingAssetInfo[],
  unreferencedFiles: string[],
  foundHtmlPath?: string,
  htmlContent?: string
}> => {
  const missingAssets: MissingAssetInfo[] = [];
  const referencedAssetPaths = new Set<string>();
  let foundHtmlPath: string | undefined;
  let htmlContentForAnalysis: string | undefined;

  try {
    const zip = await JSZip.loadAsync(file);
    const htmlFile = await findHtmlFileInZip(zip);

    if (!htmlFile) {
      // console.warn(`[analyzeCreativeAssets] No HTML file found in ${file.name}`);
      // If no HTML, all non-metadata files are unreferenced (except if we want to analyze CSS directly later)
      const unreferencedDueToNoHtml: string[] = [];
      Object.keys(zip.files).forEach(filePathInZip => {
        if (!zip.files[filePathInZip].dir && !filePathInZip.startsWith('__MACOSX/') && !filePathInZip.endsWith('/.DS_Store')) {
            unreferencedDueToNoHtml.push(filePathInZip);
        }
      });
      return { missingAssets, unreferencedFiles: unreferencedDueToNoHtml };
    }
    
    foundHtmlPath = htmlFile.path;
    referencedAssetPaths.add(foundHtmlPath); // The HTML file itself is referenced
    htmlContentForAnalysis = htmlFile.content;
    const doc = new DOMParser().parseFromString(htmlContentForAnalysis, 'text/html');
    const baseDir = foundHtmlPath.includes('/') ? foundHtmlPath.substring(0, foundHtmlPath.lastIndexOf('/') + 1) : '';

    // 1. Check linked stylesheets in HTML
    const linkedStylesheets = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
    const processedCssPaths = new Set<string>(); // To avoid processing the same CSS file multiple times

    for (const linkTag of linkedStylesheets) {
      const href = linkTag.getAttribute('href');
      if (href && !href.startsWith('http:') && !href.startsWith('https://') && !href.startsWith('data:')) {
        const cssFilePath = resolveAssetPathInZip(href, foundHtmlPath, zip);
        if (cssFilePath && zip.file(cssFilePath)) {
          referencedAssetPaths.add(cssFilePath);
          processedCssPaths.add(cssFilePath);
          const cssContent = await zip.file(cssFilePath)!.async('string');
          await processCssContentAndCollectReferences(cssContent, cssFilePath, zip, missingAssets, referencedAssetPaths);
        } else {
          missingAssets.push({ type: 'htmlLinkCss', path: href, referencedFrom: foundHtmlPath, originalSrc: href });
        }
      }
    }

    // 2. Proactively check common CSS paths (if not already processed)
    const commonCssSuffixes = ['style.css', 'css/style.css', 'main.css', 'css/main.css'];
    for (const suffix of commonCssSuffixes) {
      const potentialCssPath = baseDir + suffix; // Assumes relative to HTML's directory
      if (zip.file(potentialCssPath) && !processedCssPaths.has(potentialCssPath)) {
        referencedAssetPaths.add(potentialCssPath);
        const cssContent = await zip.file(potentialCssPath)!.async('string');
        await processCssContentAndCollectReferences(cssContent, potentialCssPath, zip, missingAssets, referencedAssetPaths);
        processedCssPaths.add(potentialCssPath);
      }
    }
    
    // 3. Check images and sources in HTML
    const mediaElements = Array.from(doc.querySelectorAll('img[src], source[src]'));
    for (const el of mediaElements) {
        const srcAttr = el.getAttribute('src');
        if (srcAttr && !srcAttr.startsWith('data:') && !srcAttr.startsWith('http:') && !srcAttr.startsWith('https://') && !srcAttr.startsWith('//')) {
            const assetPath = resolveAssetPathInZip(srcAttr, foundHtmlPath, zip);
            if (assetPath && zip.file(assetPath)) {
                referencedAssetPaths.add(assetPath);
            } else {
                missingAssets.push({
                    type: el.tagName.toLowerCase() === 'img' ? 'htmlImg' : 'htmlSource',
                    path: srcAttr,
                    referencedFrom: foundHtmlPath,
                    originalSrc: srcAttr
                });
            }
        }
    }

    // 4. Check script tags in HTML
    const scriptElements = Array.from(doc.querySelectorAll('script[src]'));
    for (const el of scriptElements) {
        const srcAttr = el.getAttribute('src');
        if (srcAttr && !srcAttr.startsWith('http:') && !srcAttr.startsWith('https://')) { // Don't try to check CDNs
            const assetPath = resolveAssetPathInZip(srcAttr, foundHtmlPath, zip);
            if (assetPath && zip.file(assetPath)) {
                referencedAssetPaths.add(assetPath);
            } else {
                 missingAssets.push({
                    type: 'htmlScript',
                    path: srcAttr,
                    referencedFrom: foundHtmlPath,
                    originalSrc: srcAttr
                });
            }
        }
    }

    // 5. Identify unreferenced files
    const unreferencedFiles: string[] = [];
    Object.keys(zip.files).forEach(filePathInZip => {
        if (!zip.files[filePathInZip].dir && 
            !filePathInZip.startsWith('__MACOSX/') && 
            !filePathInZip.endsWith('/.DS_Store') && // Handles .DS_Store inside subfolders
            !filePathInZip.endsWith('.DS_Store') && // Handles .DS_Store at root of a folder entry if name ends with /
            !referencedAssetPaths.has(filePathInZip)) {
            unreferencedFiles.push(filePathInZip);
        }
    });
    
    return { missingAssets, unreferencedFiles, foundHtmlPath, htmlContent: htmlContentForAnalysis };

  } catch (error) {
    console.error(`Error analyzing assets for ${file.name}:`, error);
    // Optionally, add a general error to missingAssets here
    return { missingAssets, unreferencedFiles: [], foundHtmlPath, htmlContent: htmlContentForAnalysis };
  }
};


const findClickTagsInHtml = (htmlContent: string | null): ClickTagInfo[] => {
  if (!htmlContent) return [];

  const clickTags: ClickTagInfo[] = [];
  const clickTagRegex = /(?:^|[\s;,\{\(])\s*(?:(?:var|let|const)\s+)?(?:window\.)?([a-zA-Z0-9_]*clickTag[a-zA-Z0-9_]*)\s*=\s*["'](http[^"']+)["']/gmi;
  
  let match;
  const scriptContentRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  let fullScriptContent = "";
  while ((scriptMatch = scriptContentRegex.exec(htmlContent)) !== null) {
    fullScriptContent += scriptMatch[1] + "\n";
  }

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
  analysis: { 
    missingAssets: MissingAssetInfo[],
    unreferencedFiles: string[],
    foundHtmlPath?: string, 
    htmlContent?: string 
  }
): Promise<Omit<ValidationResult, 'id' | 'fileName' | 'fileSize'>> => {
  const issues: ValidationIssue[] = [];
  let status: ValidationResult['status'] = 'success';

  const detectedClickTags = findClickTagsInHtml(analysis.htmlContent || null);

  if (detectedClickTags.length === 0 && analysis.htmlContent) { // Only if HTML was processed
     issues.push(createMockIssue('error', 'No clickTags found or clickTag implementation is missing/invalid.'));
  } else {
    for (const tag of detectedClickTags) {
      if (!tag.isHttps) {
        issues.push(createMockIssue('warning', `ClickTag '${tag.name}' uses non-HTTPS URL.`, `URL: ${tag.url}`));
      }
    }
  }

  for (const missing of analysis.missingAssets) {
    let message = "";
    if (missing.type === 'cssRef') {
      message = `Asset '${missing.originalSrc}' referenced in CSS file '${missing.referencedFrom}' not found in ZIP.`;
    } else if (missing.type === 'htmlImg') {
      message = `Image '${missing.originalSrc}' referenced in HTML file '${missing.referencedFrom}' not found in ZIP.`;
    } else if (missing.type === 'htmlSource') {
      message = `Media source '${missing.originalSrc}' referenced in HTML file '${missing.referencedFrom}' not found in ZIP.`;
    } else if (missing.type === 'htmlLinkCss') {
      message = `CSS file '${missing.originalSrc}' linked in HTML file '${missing.referencedFrom}' not found in ZIP.`;
    } else if (missing.type === 'htmlScript') {
      message = `JavaScript file '${missing.originalSrc}' linked in HTML file '${missing.referencedFrom}' not found in ZIP.`;
    }
    issues.push(createMockIssue('warning', message, `Original path: ${missing.path}`));
  }

  for (const unreferencedFilePath of analysis.unreferencedFiles) {
    issues.push(createMockIssue('warning', `Unreferenced file in ZIP: '${unreferencedFilePath}'.`, `Consider removing if not used to reduce file size.`));
  }


  let actualMetaWidth: number | undefined = undefined;
  let actualMetaHeight: number | undefined = undefined;
  let adSizeMetaTagContent: string | null = null;

  let filenameIntrinsicWidth: number | undefined;
  let filenameIntrinsicHeight: number | undefined;
  const filenameDimMatch = file.name.match(/_(\d+)x(\d+)(?:[^/]*)\.zip$/i);

  if (filenameDimMatch && filenameDimMatch[1] && filenameDimMatch[2]) {
    filenameIntrinsicWidth = parseInt(filenameDimMatch[1], 10);
    filenameIntrinsicHeight = parseInt(filenameDimMatch[2], 10);
  }
  
  if (analysis.htmlContent) {
    const metaTagRegex = /<meta\s+name=["']ad\.size["']\s+content=["']([^"']+)["'][^>]*>/i;
    const metaTagMatch = analysis.htmlContent.match(metaTagRegex);
    if (metaTagMatch && metaTagMatch[1]) {
      adSizeMetaTagContent = metaTagMatch[1];
      const metaDimMatch = adSizeMetaTagContent.match(/width=(\d+)[,;]?\s*height=(\d+)/i);
      if (metaDimMatch && metaDimMatch[1] && metaDimMatch[2]) {
        const wVal = parseInt(metaDimMatch[1], 10);
        const hVal = parseInt(metaDimMatch[2], 10);
        if (!isNaN(wVal) && !isNaN(hVal)) {
          actualMetaWidth = wVal;
          actualMetaHeight = hVal;
        } else {
           issues.push(createMockIssue('error', 'Invalid numeric values in ad.size meta tag.', `Parsed non-numeric values from: "${adSizeMetaTagContent}"`));
        }
      } else {
         issues.push(createMockIssue('error', 'Malformed ad.size meta tag content.', `Content: "${adSizeMetaTagContent}". Expected "width=XXX,height=YYY".`));
      }
    } else {
      if (filenameIntrinsicWidth !== undefined && filenameIntrinsicHeight !== undefined) {
        actualMetaWidth = filenameIntrinsicWidth;
        actualMetaHeight = filenameIntrinsicHeight;
        issues.push(createMockIssue('warning', 'Required ad.size meta tag not found in HTML. Dimensions inferred from filename.', 'Ensure <meta name="ad.size" content="width=XXX,height=YYY"> is present.'));
      } else {
        issues.push(createMockIssue('error', 'Required ad.size meta tag not found in HTML and no dimensions in filename.', 'Ensure <meta name="ad.size" content="width=XXX,height=YYY"> is present or include dimensions in filename like _WIDTHxHEIGHT.zip.'));
      }
    }
  } else { 
    if (filenameIntrinsicWidth !== undefined && filenameIntrinsicHeight !== undefined) {
      actualMetaWidth = filenameIntrinsicWidth;
      actualMetaHeight = filenameIntrinsicHeight;
      issues.push(createMockIssue('warning', 'Could not extract HTML. Dimensions inferred from filename.', 'Creative might be structured unusually or ZIP is empty/corrupt. Ad.size meta tag could not be verified.'));
    } else {
      issues.push(createMockIssue('error', 'Could not extract HTML and no dimensions in filename.', 'Unable to determine dimensions. Ad.size meta tag could not be verified.'));
    }
  }
  
  let expectedDim: { width: number; height: number };
  if (actualMetaWidth !== undefined && actualMetaHeight !== undefined) {
    expectedDim = { width: actualMetaWidth, height: actualMetaHeight };
  } else if (filenameIntrinsicWidth !== undefined && filenameIntrinsicHeight !== undefined) {
      expectedDim = { width: filenameIntrinsicWidth, height: filenameIntrinsicHeight };
      if (!issues.some(iss => iss.message.includes("ad.size meta tag") || iss.message.includes("Could not extract HTML"))) { 
        issues.push(createMockIssue('warning', 'Ad dimensions inferred from filename due to missing/invalid ad.size meta tag or HTML extraction issues.'));
      }
  } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0 && analysis.htmlContent) { // Fallback only if HTML was processed, otherwise it's too speculative
      const fallbackDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
      expectedDim = {width: fallbackDim.width, height: fallbackDim.height};
      issues.push(createMockIssue('error', `Could not determine ad dimensions from meta tag or filename. Defaulted to a fallback guess: ${fallbackDim.width}x${fallbackDim.height}. Verify ad.size meta tag and filename conventions.`));
  } else { 
      expectedDim = { width: 300, height: 250 }; // Absolute fallback
      if (analysis.htmlContent || (filenameIntrinsicWidth === undefined && filenameIntrinsicHeight === undefined)) {
         issues.push(createMockIssue('error', 'Could not determine ad dimensions. Defaulted to 300x250. Ensure ad.size meta tag or filename convention is used.'));
      }
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

  const fileStructureOk = !!analysis.foundHtmlPath; 
  if (!fileStructureOk && !issues.some(iss => iss.message.includes("Could not extract HTML"))) {
    issues.push(createMockIssue('error', 'Invalid file structure. Primary HTML file could not be extracted.'));
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
    htmlContent: analysis.htmlContent,
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
    const initialPendingResults: ValidationResult[] = selectedFiles.map(file => {
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
            id: `${file.name}-${Date.now()}-pending-${Math.random().toString(36).substring(2,9)}`,
            fileName: file.name,
            status: 'validating',
            issues: [],
            fileSize: file.size,
            maxFileSize: MOCK_MAX_FILE_SIZE,
            fileStructureOk: true, 
            adDimensions: { width: initialWidth, height: initialHeight, actual: undefined },
            detectedClickTags: undefined,
            htmlContent: undefined, // Placeholder for actual content later
        };
    });
    setValidationResults(initialPendingResults);


    const resultsPromises = selectedFiles.map(async (file, index) => {
      const currentPendingResultId = initialPendingResults[index].id;
      try {
        const assetAnalysis = await analyzeCreativeAssets(file);
        const validationResultPart = await buildValidationResult(file, assetAnalysis);
        
        return {
          id: currentPendingResultId, 
          fileName: file.name,
          fileSize: file.size,
          ...validationResultPart,
        };
      } catch (error) {
        console.error(`Error during validation for ${file.name}:`, error);
        const errorResult: ValidationResult = {
            id: currentPendingResultId,
            fileName: file.name,
            status: 'error',
            issues: [createMockIssue('error', 'An unexpected error occurred during validation process.', (error as Error).message)],
            fileSize: file.size,
            maxFileSize: MOCK_MAX_FILE_SIZE,
            fileStructureOk: false,
            adDimensions: initialPendingResults[index].adDimensions,
            htmlContent: undefined,
        };
        return errorResult;
      }
    });

    const allResults = await Promise.all(resultsPromises);
    setValidationResults(allResults);

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

