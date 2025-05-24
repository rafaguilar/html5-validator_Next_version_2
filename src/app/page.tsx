
"use client";

import type { ChangeEvent } from 'react';
import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import { AppHeader } from '@/components/layout/header';
import { FileUploader } from '@/components/html-validator/file-uploader';
import { ValidationResults } from '@/components/html-validator/validation-results';
import type { ValidationResult, ValidationIssue, ClickTagInfo } from '@/types';
import { useToast } from "@/hooks/use-toast";

const MOCK_MAX_FILE_SIZE = 200 * 1024; // 200KB
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
    // console.log(`[resolveAssetPathInZip] Skipping absolute or data URI: ${assetPath}`);
    return assetPath; // Absolute URL or data URI, not in ZIP, or already processed
  }

  // console.log(`[resolveAssetPathInZip] Resolving assetPath: "${assetPath}" from baseFilePath: "${baseFilePath}"`);

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
  // console.log(`[resolveAssetPathInZip] Trying resolved path: "${resolvedPath}"`);
  
  if (zip.file(resolvedPath)) {
    // console.log(`[resolveAssetPathInZip] SUCCESS: Found asset at "${resolvedPath}"`);
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
  const rootIndexHtmlCandidates = allFiles.filter(path => path.toLowerCase().endsWith('index.html'));
  
  // Prefer index.html at the "true" root of the creative (e.g., "creative_folder/index.html" not "creative_folder/subfolder/index.html")
  let shortestDepthIndexHtml: string | null = null;
  let minDepth = Infinity;

  for (const path of rootIndexHtmlCandidates) {
      const depth = path.split('/').length - 1; // Number of parent directories
      // Check if it's inside a folder that isn't __MACOSX or similar junk
      if (!path.startsWith("__MACOSX/") && depth < minDepth) {
          minDepth = depth;
          shortestDepthIndexHtml = path;
      }
  }
  
  if (shortestDepthIndexHtml && zip.file(shortestDepthIndexHtml)) {
      const content = await zip.file(shortestDepthIndexHtml)!.async("string");
      // console.log(`[findHtmlFileInZip] Found shortest depth index.html: ${shortestDepthIndexHtml}`);
      return { path: shortestDepthIndexHtml, content };
  }
  
  // Fallback: any index.html not in __MACOSX
  const anyIndexHtml = rootIndexHtmlCandidates.find(path => !path.startsWith("__MACOSX/"));
   if (anyIndexHtml && zip.file(anyIndexHtml)) {
      const content = await zip.file(anyIndexHtml)!.async("string");
      // console.log(`[findHtmlFileInZip] Found any index.html (fallback): ${anyIndexHtml}`);
      return { path: anyIndexHtml, content };
  }

  // Fallback: first .html file at the root of any non-MACOSX directory structure
  const firstRootHtmlCandidates = allFiles.filter(path => path.toLowerCase().endsWith('.html') && !path.startsWith("__MACOSX/"));
  let shortestDepthFirstHtml: string | null = null;
  minDepth = Infinity;
  for (const path of firstRootHtmlCandidates) {
    const depth = path.split('/').length - 1;
    if (depth < minDepth) {
        minDepth = depth;
        shortestDepthFirstHtml = path;
    }
  }
  if (shortestDepthFirstHtml && zip.file(shortestDepthFirstHtml)) {
      const content = await zip.file(shortestDepthFirstHtml)!.async("string");
      // console.log(`[findHtmlFileInZip] Found shortest depth .html (fallback): ${shortestDepthFirstHtml}`);
      return { path: shortestDepthFirstHtml, content };
  }
  
  // console.warn(`[findHtmlFileInZip] No suitable HTML file found.`);
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
  // console.log(`[processCssContentAndCollectReferences] Processing CSS: ${cssFilePath}`);
  const urlPattern = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match;

  while ((match = urlPattern.exec(cssContent)) !== null) {
    const originalUrl = match[0]; 
    const assetUrlFromCss = match[2];
    // console.log(`[processCssContentAndCollectReferences] Found URL in CSS: ${originalUrl} -> ${assetUrlFromCss}`);

    if (assetUrlFromCss.startsWith('data:') || assetUrlFromCss.startsWith('http:') || assetUrlFromCss.startsWith('https://') || assetUrlFromCss.startsWith('//')) {
      // console.log(`[processCssContentAndCollectReferences] Skipping data/absolute URL: ${assetUrlFromCss}`);
      continue; 
    }

    const resolvedAssetPath = resolveAssetPathInZip(assetUrlFromCss, cssFilePath, zip);

    if (resolvedAssetPath && zip.file(resolvedAssetPath)) {
      // console.log(`[processCssContentAndCollectReferences] Successfully resolved and found CSS asset: ${resolvedAssetPath}`);
      referencedAssetPathsCollector.add(resolvedAssetPath);
    } else {
      // console.warn(`[processCssContentAndCollectReferences] Missing asset referenced in CSS: Original: ${assetUrlFromCss}, Resolved to: ${resolvedAssetPath || 'null'}, From CSS: ${cssFilePath}`);
      missingAssetsCollector.push({
        type: 'cssRef',
        path: assetUrlFromCss, // Report the path as written in CSS
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
  let zipBaseDir = ''; // e.g., "hcp_now_approved_300x250/"

  try {
    const zip = await JSZip.loadAsync(file);
    const allZipFiles = Object.keys(zip.files);
    // console.log(`[analyzeCreativeAssets] ZIP file entries for ${file.name}:`, allZipFiles);

    const htmlFile = await findHtmlFileInZip(zip);

    if (!htmlFile) {
      // console.warn(`[analyzeCreativeAssets] No HTML file found in ${file.name}`);
      const unreferencedDueToNoHtml: string[] = [];
      allZipFiles.forEach(filePathInZip => {
        if (!zip.files[filePathInZip].dir && !filePathInZip.startsWith('__MACOSX/') && !filePathInZip.endsWith('/.DS_Store') && !filePathInZip.endsWith('.DS_Store')) {
            unreferencedDueToNoHtml.push(filePathInZip);
        }
      });
      return { missingAssets, unreferencedFiles: unreferencedDueToNoHtml };
    }
    
    foundHtmlPath = htmlFile.path;
    if (foundHtmlPath.includes('/')) {
        zipBaseDir = foundHtmlPath.substring(0, foundHtmlPath.lastIndexOf('/') + 1);
    }
    // console.log(`[analyzeCreativeAssets] Determined base directory in ZIP: '${zipBaseDir}' from HTML path: '${foundHtmlPath}'`);

    referencedAssetPaths.add(foundHtmlPath); 
    htmlContentForAnalysis = htmlFile.content;
    const doc = new DOMParser().parseFromString(htmlContentForAnalysis, 'text/html');
    
    // 1. Check linked stylesheets in HTML
    const linkedStylesheets = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
    const processedCssPaths = new Set<string>(); 
    // console.log(`[analyzeCreativeAssets] Found ${linkedStylesheets.length} <link rel="stylesheet"> tags.`);

    for (const linkTag of linkedStylesheets) {
      const href = linkTag.getAttribute('href');
      if (href && !href.startsWith('http:') && !href.startsWith('https://') && !href.startsWith('data:')) {
        const cssFilePath = resolveAssetPathInZip(href, foundHtmlPath, zip);
        if (cssFilePath && zip.file(cssFilePath)) {
          // console.log(`[analyzeCreativeAssets] Linked CSS file found: ${cssFilePath}`);
          referencedAssetPaths.add(cssFilePath);
          processedCssPaths.add(cssFilePath);
          const cssContent = await zip.file(cssFilePath)!.async('string');
          await processCssContentAndCollectReferences(cssContent, cssFilePath, zip, missingAssets, referencedAssetPaths);
        } else {
          // console.warn(`[analyzeCreativeAssets] Linked CSS file NOT found: ${href}, resolved to: ${cssFilePath || 'null'}`);
          missingAssets.push({ type: 'htmlLinkCss', path: href, referencedFrom: foundHtmlPath, originalSrc: href });
        }
      }
    }

    // 2. Proactively check common CSS paths
    // console.log(`[analyzeCreativeAssets] Starting proactive CSS inlining. Base dir in ZIP: '${zipBaseDir}'.`);
    const commonCssSuffixes = ['style.css', 'css/style.css', 'main.css', 'css/main.css'];
    for (const suffix of commonCssSuffixes) {
      const potentialCssPath = zipBaseDir + suffix;
      // console.log(`[analyzeCreativeAssets] Proactively checking for CSS: ${potentialCssPath}`);
      if (zip.file(potentialCssPath) && !processedCssPaths.has(potentialCssPath)) {
        // console.log(`[analyzeCreativeAssets] Proactively found and processing CSS: ${potentialCssPath}`);
        referencedAssetPaths.add(potentialCssPath);
        const cssContent = await zip.file(potentialCssPath)!.async('string');
        await processCssContentAndCollectReferences(cssContent, potentialCssPath, zip, missingAssets, referencedAssetPaths);
        processedCssPaths.add(potentialCssPath);
      }
    }
    
    // 3. Check images and sources in HTML
    const mediaElements = Array.from(doc.querySelectorAll('img[src], source[src]'));
    // console.log(`[analyzeCreativeAssets] Found ${mediaElements.length} <img/source src="..."> tags.`);
    for (const el of mediaElements) {
        const srcAttr = el.getAttribute('src');
        if (srcAttr && !srcAttr.startsWith('data:') && !srcAttr.startsWith('http:') && !srcAttr.startsWith('https://') && !srcAttr.startsWith('//')) {
            const assetPath = resolveAssetPathInZip(srcAttr, foundHtmlPath, zip);
            if (assetPath && zip.file(assetPath)) {
                // console.log(`[analyzeCreativeAssets] HTML media asset found: ${assetPath}`);
                referencedAssetPaths.add(assetPath);
            } else {
                // console.warn(`[analyzeCreativeAssets] HTML media asset NOT found: ${srcAttr}, resolved to: ${assetPath || 'null'}`);
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
    // console.log(`[analyzeCreativeAssets] Found ${scriptElements.length} <script src="..."> tags.`);
    for (const el of scriptElements) {
        const srcAttr = el.getAttribute('src');
        if (srcAttr && !srcAttr.startsWith('http:') && !srcAttr.startsWith('https://')) { 
            const assetPath = resolveAssetPathInZip(srcAttr, foundHtmlPath, zip);
            if (assetPath && zip.file(assetPath)) {
                // console.log(`[analyzeCreativeAssets] HTML script asset found: ${assetPath}`);
                referencedAssetPaths.add(assetPath);
            } else {
                 // console.warn(`[analyzeCreativeAssets] HTML script asset NOT found: ${srcAttr}, resolved to: ${assetPath || 'null'}`);
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
    allZipFiles.forEach(filePathInZip => {
        if (!zip.files[filePathInZip].dir && 
            !filePathInZip.startsWith('__MACOSX/') && 
            !filePathInZip.endsWith('/.DS_Store') && 
            !filePathInZip.endsWith('.DS_Store') &&
            !referencedAssetPaths.has(filePathInZip)) {
            // console.log(`[analyzeCreativeAssets] Unreferenced file found: ${filePathInZip}`);
            unreferencedFiles.push(filePathInZip);
        }
    });
    // console.log(`[analyzeCreativeAssets] Total referenced assets: ${referencedAssetPaths.size}. Found ${missingAssets.length} missing assets and ${unreferencedFiles.length} unreferenced files.`);
    
    return { missingAssets, unreferencedFiles, foundHtmlPath, htmlContent: htmlContentForAnalysis };

  } catch (error) {
    console.error(`Error analyzing assets for ${file.name}:`, error);
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
  // console.log(`[findClickTagsInHtml] Found ${clickTags.length} clickTags:`, clickTags);
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

  const isTooLarge = file.size > MOCK_MAX_FILE_SIZE;
  if (isTooLarge) {
    issues.push(createMockIssue('error', `File size exceeds limit (${(MOCK_MAX_FILE_SIZE / 1024).toFixed(0)}KB).`));
  }

  const detectedClickTags = findClickTagsInHtml(analysis.htmlContent || null);

  if (detectedClickTags.length === 0 && analysis.htmlContent) { 
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
  } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0 && analysis.htmlContent) { 
      const fallbackDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
      expectedDim = {width: fallbackDim.width, height: fallbackDim.height};
      issues.push(createMockIssue('error', `Could not determine ad dimensions from meta tag or filename. Defaulted to a fallback guess: ${fallbackDim.width}x${fallbackDim.height}. Verify ad.size meta tag and filename conventions.`));
  } else { 
      expectedDim = { width: 300, height: 250 }; 
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
  
  return {
    status,
    issues,
    adDimensions,
    fileStructureOk,
    detectedClickTags: detectedClickTags.length > 0 ? detectedClickTags : undefined,
    maxFileSize: MOCK_MAX_FILE_SIZE,
    htmlContent: analysis.htmlContent, // No longer trying to inline assets here for preview
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
            htmlContent: undefined, 
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

    