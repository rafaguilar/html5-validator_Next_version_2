
"use client";

import type { ChangeEvent } from 'react';
import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import { HTMLHint, type LintResult, type RuleSet } from 'htmlhint';
import * as csstree from 'csstree';
import { AppHeader } from '@/components/layout/header';
import { FileUploader } from '@/components/html-validator/file-uploader';
import { ValidationResults } from '@/components/html-validator/validation-results';
import type { ValidationResult, ValidationIssue, ClickTagInfo } from '@/types';
import { useToast } from "@/hooks/use-toast";

const MAX_FILE_SIZE = 200 * 1024; // 200KB
const POSSIBLE_FALLBACK_DIMENSIONS = [
  { width: 300, height: 250 }, { width: 728, height: 90 },
  { width: 160, height: 600 }, { width: 300, height: 600 },
  { width: 468, height: 60 },  { width: 120, height: 600 },
  { width: 320, height: 50 },   { width: 300, height: 50 },
  { width: 970, height: 250 }, { width: 336, height: 280 },
];

interface MissingAssetInfo {
  type: 'cssRef' | 'htmlImg' | 'htmlSource' | 'htmlLinkCss' | 'htmlScript';
  path: string; 
  referencedFrom: string; 
  originalSrc: string; 
}

const createIssue = (type: 'error' | 'warning', message: string, details?: string): ValidationIssue => ({
  id: `issue-${Math.random().toString(36).substr(2, 9)}`,
  type,
  message,
  details,
});

const resolveAssetPathInZip = (assetPath: string, baseFilePath: string, zip: JSZip): string | null => {
  if (assetPath.startsWith('data:') || assetPath.startsWith('http:') || assetPath.startsWith('https:') || assetPath.startsWith('//')) {
    return assetPath; 
  }

  let basePathSegments = baseFilePath.includes('/') ? baseFilePath.split('/').slice(0, -1) : [];
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

const findHtmlFileInZip = async (zip: JSZip): Promise<{ path: string, content: string } | null> => {
  const allFiles = Object.keys(zip.files);
  const rootIndexHtmlCandidates = allFiles.filter(path => path.toLowerCase().endsWith('index.html'));
  
  let shortestDepthIndexHtml: string | null = null;
  let minDepth = Infinity;

  for (const path of rootIndexHtmlCandidates) {
      const depth = path.split('/').length - 1; 
      if (!path.startsWith("__MACOSX/") && depth < minDepth) {
          minDepth = depth;
          shortestDepthIndexHtml = path;
      }
  }
  
  if (shortestDepthIndexHtml && zip.file(shortestDepthIndexHtml)) {
      const content = await zip.file(shortestDepthIndexHtml)!.async("string");
      return { path: shortestDepthIndexHtml, content };
  }
  
  const anyIndexHtml = rootIndexHtmlCandidates.find(path => !path.startsWith("__MACOSX/"));
   if (anyIndexHtml && zip.file(anyIndexHtml)) {
      const content = await zip.file(anyIndexHtml)!.async("string");
      return { path: anyIndexHtml, content };
  }

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
      return { path: shortestDepthFirstHtml, content };
  }
  
  return null;
};

const processCssContentAndCollectReferences = async (
  cssContent: string,
  cssFilePath: string,
  zip: JSZip,
  missingAssetsCollector: MissingAssetInfo[],
  referencedAssetPathsCollector: Set<string>
): Promise<void> => {
  const urlPattern = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match;

  while ((match = urlPattern.exec(cssContent)) !== null) {
    const originalUrl = match[0]; 
    const assetUrlFromCss = match[2];

    if (assetUrlFromCss.startsWith('data:') || assetUrlFromCss.startsWith('http:') || assetUrlFromCss.startsWith('https:') || assetUrlFromCss.startsWith('//')) {
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

const lintCssContent = (cssText: string, filePath: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  try {
    csstree.parse(cssText);
  } catch (error: any) {
    if (error.name === 'SyntaxError' && error.message && error.line && error.column) {
      issues.push(createIssue(
        'error',
        `CSS Syntax Error in '${filePath}': ${error.message}`,
        `Line: ${error.line}, Column: ${error.column}`
      ));
    } else {
       issues.push(createIssue(
        'error',
        `CSS Parsing Error in '${filePath}': An unexpected error occurred during CSS parsing.`,
        error.message || 'Unknown error'
      ));
    }
  }
  return issues;
};


const analyzeCreativeAssets = async (file: File): Promise<{
  missingAssets: MissingAssetInfo[],
  unreferencedFiles: string[],
  foundHtmlPath?: string,
  htmlContent?: string,
  cssLintIssues: ValidationIssue[],
}> => {
  const missingAssets: MissingAssetInfo[] = [];
  const referencedAssetPaths = new Set<string>();
  const cssLintIssues: ValidationIssue[] = [];
  let foundHtmlPath: string | undefined;
  let htmlContentForAnalysis: string | undefined;
  let zipBaseDir = '';

  try {
    const zip = await JSZip.loadAsync(file);
    const allZipFiles = Object.keys(zip.files);

    const htmlFile = await findHtmlFileInZip(zip);

    if (!htmlFile) {
      const unreferencedDueToNoHtml: string[] = [];
      allZipFiles.forEach(filePathInZip => {
        if (!zip.files[filePathInZip].dir && !filePathInZip.startsWith('__MACOSX/') && !filePathInZip.endsWith('/.DS_Store') && !filePathInZip.endsWith('.DS_Store')) {
            unreferencedDueToNoHtml.push(filePathInZip);
        }
      });
      return { missingAssets, unreferencedFiles: unreferencedDueToNoHtml, cssLintIssues };
    }
    
    foundHtmlPath = htmlFile.path;
    if (foundHtmlPath.includes('/')) {
        zipBaseDir = foundHtmlPath.substring(0, foundHtmlPath.lastIndexOf('/') + 1);
    }

    referencedAssetPaths.add(foundHtmlPath); 
    htmlContentForAnalysis = htmlFile.content;
    const doc = new DOMParser().parseFromString(htmlContentForAnalysis, 'text/html');
    
    const linkedStylesheets = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
    const processedCssPaths = new Set<string>(); 

    for (const linkTag of linkedStylesheets) {
      const href = linkTag.getAttribute('href');
      if (href && !href.startsWith('http:') && !href.startsWith('https:') && !href.startsWith('data:')) {
        const cssFilePath = resolveAssetPathInZip(href, foundHtmlPath, zip);
        if (cssFilePath && zip.file(cssFilePath)) {
          referencedAssetPaths.add(cssFilePath);
          processedCssPaths.add(cssFilePath);
          const cssContent = await zip.file(cssFilePath)!.async('string');
          cssLintIssues.push(...lintCssContent(cssContent, cssFilePath));
          await processCssContentAndCollectReferences(cssContent, cssFilePath, zip, missingAssets, referencedAssetPaths);
        } else {
          missingAssets.push({ type: 'htmlLinkCss', path: href, referencedFrom: foundHtmlPath, originalSrc: href });
        }
      }
    }

    const commonCssSuffixes = ['style.css', 'css/style.css', 'main.css', 'css/main.css'];
    for (const suffix of commonCssSuffixes) {
      const potentialCssPath = zipBaseDir + suffix;
      if (zip.file(potentialCssPath) && !processedCssPaths.has(potentialCssPath)) {
        referencedAssetPaths.add(potentialCssPath);
        const cssContent = await zip.file(potentialCssPath)!.async('string');
        cssLintIssues.push(...lintCssContent(cssContent, potentialCssPath));
        await processCssContentAndCollectReferences(cssContent, potentialCssPath, zip, missingAssets, referencedAssetPaths);
        processedCssPaths.add(potentialCssPath);
      }
    }
    
    const mediaElements = Array.from(doc.querySelectorAll('img[src], source[src]'));
    for (const el of mediaElements) {
        const srcAttr = el.getAttribute('src');
        if (srcAttr && !srcAttr.startsWith('data:') && !srcAttr.startsWith('http:') && !srcAttr.startsWith('https:') && !srcAttr.startsWith('//')) {
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

    const scriptElements = Array.from(doc.querySelectorAll('script[src]'));
    for (const el of scriptElements) {
        const srcAttr = el.getAttribute('src');
        if (srcAttr && !srcAttr.startsWith('http:') && !srcAttr.startsWith('https:')) { 
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

    const unreferencedFiles: string[] = [];
    allZipFiles.forEach(filePathInZip => {
        if (!zip.files[filePathInZip].dir && 
            !filePathInZip.startsWith('__MACOSX/') && 
            !filePathInZip.endsWith('/.DS_Store') && 
            !filePathInZip.endsWith('.DS_Store') &&
            !referencedAssetPaths.has(filePathInZip)) {
            unreferencedFiles.push(filePathInZip);
        }
    });
    
    return { missingAssets, unreferencedFiles, foundHtmlPath, htmlContent: htmlContentForAnalysis, cssLintIssues };

  } catch (error) {
    console.error(`Error analyzing assets for ${file.name}:`, error);
    return { missingAssets, unreferencedFiles: [], foundHtmlPath, htmlContent: htmlContentForAnalysis, cssLintIssues };
  }
};

const findClickTagsInHtml = (htmlContent: string | null): ClickTagInfo[] => {
  if (!htmlContent) return [];

  const clickTags: ClickTagInfo[] = [];
  // Updated regex to be more inclusive of various declaration patterns within script tags
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

const lintHtmlContent = (htmlString: string): ValidationIssue[] => {
  if (!htmlString) return [];

  // Basic HTMLHint ruleset. This can be expanded.
  // Find more rules at: https://htmlhint.com/docs/user-guide/list-rules
  const ruleset: RuleSet = {
    'tag-pair': true, // Tags must be paired
    'attr-lowercase': true, // Attribute names must be in lowercase
    'attr-value-double-quotes': true, // Attribute values must be in double quotes
    'doctype-first': false, // Doctype must be declared first (often false for HTML fragments/ads)
    'spec-char-escape': true, // Special characters must be escaped
    'id-unique': true, // The id of tags must be unique
    'src-not-empty': true, // The src attribute of tags must be not empty
    'tag-self-close': false, // Empty tags must be self closed
    'img-alt-require': true, // Alt attribute of img tag must be present
    'head-script-disabled': false, // Script tag can not be used in head. (Ads often use scripts in head)
    'style-disabled': false, // Style tag can not be used. (Ads often use inline styles)
  };

  const messages = HTMLHint.verify(htmlString, ruleset);
  return messages.map((msg: LintResult) => {
    let issueType: 'error' | 'warning' = 'warning';
    if (msg.type === 'error') {
      issueType = 'error';
    }
    return createIssue(
      issueType,
      msg.message,
      `Line: ${msg.line}, Col: ${msg.col}, Rule: ${msg.rule.id}`
    );
  });
};

const buildValidationResult = async (
  file: File,
  analysis: { 
    missingAssets: MissingAssetInfo[],
    unreferencedFiles: string[],
    foundHtmlPath?: string, 
    htmlContent?: string,
    cssLintIssues: ValidationIssue[],
  }
): Promise<Omit<ValidationResult, 'id' | 'fileName' | 'fileSize'>> => {
  const issues: ValidationIssue[] = [];
  let status: ValidationResult['status'] = 'success';

  if (file.size > MAX_FILE_SIZE) {
    issues.push(createIssue('error', `File size exceeds limit (${(MAX_FILE_SIZE / 1024).toFixed(0)}KB).`));
  }

  const detectedClickTags = findClickTagsInHtml(analysis.htmlContent || null);

  if (detectedClickTags.length === 0 && analysis.htmlContent) { 
     issues.push(createIssue('error', 'No clickTags found or clickTag implementation is missing/invalid.'));
  } else {
    for (const tag of detectedClickTags) {
      if (!tag.isHttps) {
        issues.push(createIssue('warning', `ClickTag '${tag.name}' uses non-HTTPS URL.`, `URL: ${tag.url}`));
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
    issues.push(createIssue('warning', message, `Original path: ${missing.path}`));
  }

  for (const unreferencedFilePath of analysis.unreferencedFiles) {
    issues.push(createIssue('warning', `Unreferenced file in ZIP: '${unreferencedFilePath}'.`, `Consider removing if not used to reduce file size.`));
  }
  
  issues.push(...analysis.cssLintIssues);

  if (analysis.htmlContent) {
    const lintingIssues = lintHtmlContent(analysis.htmlContent);
    issues.push(...lintingIssues);
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
           issues.push(createIssue('error', 'Invalid numeric values in ad.size meta tag.', `Parsed non-numeric values from: "${adSizeMetaTagContent}"`));
        }
      } else {
         issues.push(createIssue('error', 'Malformed ad.size meta tag content.', `Content: "${adSizeMetaTagContent}". Expected "width=XXX,height=YYY".`));
      }
    } else {
      if (filenameIntrinsicWidth !== undefined && filenameIntrinsicHeight !== undefined) {
        actualMetaWidth = filenameIntrinsicWidth;
        actualMetaHeight = filenameIntrinsicHeight;
        issues.push(createIssue('warning', 'Required ad.size meta tag not found in HTML. Dimensions inferred from filename.', 'Ensure <meta name="ad.size" content="width=XXX,height=YYY"> is present.'));
      } else {
        issues.push(createIssue('error', 'Required ad.size meta tag not found in HTML and no dimensions in filename.', 'Ensure <meta name="ad.size" content="width=XXX,height=YYY"> is present or include dimensions in filename like _WIDTHxHEIGHT.zip.'));
      }
    }
  } else { 
    if (filenameIntrinsicWidth !== undefined && filenameIntrinsicHeight !== undefined) {
      actualMetaWidth = filenameIntrinsicWidth;
      actualMetaHeight = filenameIntrinsicHeight;
      issues.push(createIssue('warning', 'Could not extract HTML. Dimensions inferred from filename.', 'Creative might be structured unusually or ZIP is empty/corrupt. Ad.size meta tag could not be verified.'));
    } else {
      issues.push(createIssue('error', 'Could not extract HTML and no dimensions in filename.', 'Unable to determine dimensions. Ad.size meta tag could not be verified.'));
    }
  }
  
  let expectedDim: { width: number; height: number };
  if (actualMetaWidth !== undefined && actualMetaHeight !== undefined) {
    expectedDim = { width: actualMetaWidth, height: actualMetaHeight };
  } else if (filenameIntrinsicWidth !== undefined && filenameIntrinsicHeight !== undefined) {
      expectedDim = { width: filenameIntrinsicWidth, height: filenameIntrinsicHeight };
      if (!issues.some(iss => iss.message.includes("ad.size meta tag") || iss.message.includes("Could not extract HTML"))) { 
        issues.push(createIssue('warning', 'Ad dimensions inferred from filename due to missing/invalid ad.size meta tag or HTML extraction issues.'));
      }
  } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0 && analysis.htmlContent) { 
      const fallbackDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
      expectedDim = {width: fallbackDim.width, height: fallbackDim.height};
      issues.push(createIssue('error', `Could not determine ad dimensions from meta tag or filename. Defaulted to a fallback guess: ${fallbackDim.width}x${fallbackDim.height}. Verify ad.size meta tag and filename conventions.`));
  } else { 
      expectedDim = { width: 300, height: 250 }; 
      if (analysis.htmlContent || (filenameIntrinsicWidth === undefined && filenameIntrinsicHeight === undefined)) {
         issues.push(createIssue('error', 'Could not determine ad dimensions. Defaulted to 300x250. Ensure ad.size meta tag or filename convention is used.'));
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
    issues.push(createIssue('error', 'Invalid file structure. Primary HTML file could not be extracted.'));
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
    maxFileSize: MAX_FILE_SIZE,
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
            maxFileSize: MAX_FILE_SIZE,
            fileStructureOk: true, 
            adDimensions: { width: initialWidth, height: initialHeight, actual: undefined },
            detectedClickTags: undefined,
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
            issues: [createIssue('error', 'An unexpected error occurred during validation process.', (error as Error).message)],
            fileSize: file.size,
            maxFileSize: MAX_FILE_SIZE,
            fileStructureOk: false,
            adDimensions: initialPendingResults[index].adDimensions,
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
