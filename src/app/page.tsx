
"use client";

import type { ChangeEvent } from 'react';
import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import { HTMLHint, type LintResult, type RuleSet } from 'htmlhint';
// CSS Tree import removed as per previous step to resolve module not found, stylelint via API is used instead.
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

const createIssuePageClient = (type: 'error' | 'warning', message: string, details?: string, rule?: string): ValidationIssue => ({
  id: `issue-page-client-${Math.random().toString(36).substr(2, 9)}`,
  type,
  message,
  details,
  rule: rule || (type === 'error' ? 'client-error' : 'client-warning'),
});

const resolveAssetPathInZip = (assetPath: string, baseFilePath: string, zip: JSZip): string | null => {
  if (assetPath.startsWith('data:') || assetPath.startsWith('http:') || assetPath.startsWith('https:') || assetPath.startsWith('//')) {
    return assetPath; // Absolute or data URI, no resolution needed
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
  }
  // Fallback: If baseFilePath was deep, try resolving assetPath as if it's from ZIP root (if it doesn't contain '/')
  // This helps with paths like "image.png" referenced from "folder/index.html" where "image.png" is at ZIP root.
  if (!assetPath.includes('/') && zip.file(assetPath)) {
    return assetPath;
  }
  // console.warn(`[resolveAssetPathInZip] Could not resolve asset path "${assetPath}" from base "${baseFilePath}". Tried "${resolvedPath}".`);
  return null;
};


const findHtmlFileInZip = async (zip: JSZip): Promise<{ path: string, content: string } | null> => {
  const allFiles = Object.keys(zip.files);
  // Prioritize index.html at the shallowest depth not in __MACOSX
  const rootIndexHtmlCandidates = allFiles.filter(path => 
    path.toLowerCase().endsWith('index.html') && !path.startsWith("__MACOSX/")
  );

  let shortestDepthIndexHtml: string | null = null;
  let minDepth = Infinity;

  for (const path of rootIndexHtmlCandidates) {
      const depth = path.split('/').length - 1; // number of slashes
      if (depth < minDepth) {
          minDepth = depth;
          shortestDepthIndexHtml = path;
      }
  }
  
  if (shortestDepthIndexHtml && zip.file(shortestDepthIndexHtml)) {
      const content = await zip.file(shortestDepthIndexHtml)!.async("string");
      return { path: shortestDepthIndexHtml, content };
  }

  // Fallback: any .html file at the shallowest depth not in __MACOSX
  const anyHtmlCandidates = allFiles.filter(path => 
    path.toLowerCase().endsWith('.html') && !path.startsWith("__MACOSX/")
  );

  let shortestDepthAnyHtml: string | null = null;
  minDepth = Infinity;

  for (const path of anyHtmlCandidates) {
    const depth = path.split('/').length - 1;
    if (depth < minDepth) {
        minDepth = depth;
        shortestDepthAnyHtml = path;
    }
  }

  if (shortestDepthAnyHtml && zip.file(shortestDepthAnyHtml)) {
      const content = await zip.file(shortestDepthAnyHtml)!.async("string");
      return { path: shortestDepthAnyHtml, content };
  }
  
  // console.warn("[findHtmlFileInZip] No suitable HTML file found.");
  return null;
};

async function lintCssContentViaAPI(cssText: string, filePath: string): Promise<ValidationIssue[]> {
  try {
    const response = await fetch('/api/lint-css', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: cssText, codeFilename: filePath }),
    });

    if (!response.ok) {
      let errorDetails = `Server responded with status ${response.status} (${response.statusText || 'No status text'}).`;
      let responseBodyText = '';
      try {
        responseBodyText = await response.text(); // Attempt to get raw body first
        const errorData = JSON.parse(responseBodyText); // Then try to parse it as JSON

        // Check if the parsed data matches our expected error structure from the API
        if (errorData.issues && errorData.issues.length > 0 && errorData.issues[0].message) {
           errorDetails = errorData.issues[0].message;
           if(errorData.issues[0].details) errorDetails += ` Details: ${errorData.issues[0].details}`;
        } else if (errorData.error) { // For other simple JSON error responses
          errorDetails = errorData.error;
        } else if (responseBodyText) { // If not our structure, but body has text, use it
           errorDetails = responseBodyText;
        }
      } catch (e) {
        // JSON parsing failed or .text() failed. Use responseBodyText if available, otherwise the status line.
        if (responseBodyText) {
            errorDetails = responseBodyText;
        }
      }
      
      console.error(`CSS linting API error for ${filePath}. Status: ${response.status}. Details/Body: ${errorDetails}`);
      return [
        createIssuePageClient(
          'error',
          `CSS linting service request failed for ${filePath}.`,
          errorDetails.substring(0, 500) // Limit details length to avoid overly long messages
        ),
      ];
    }

    // If response.ok, try to parse JSON as success
    const data = await response.json();
    if (data.issues && Array.isArray(data.issues)) {
      // Map API issues to ValidationIssue, ensuring all fields are present
      return data.issues.map((issue: any) => createIssuePageClient(
        issue.type as ('error' | 'warning'),
        issue.message || 'Unknown linting issue',
        issue.details || `Line: ${issue.line}, Col: ${issue.column}, Rule: ${issue.rule || 'unknown'}`,
        issue.rule || 'unknown'
      ));
    }
    return [createIssuePageClient('warning', `CSS linting returned no issues for ${filePath}, or an unexpected response format.`)];
  } catch (error: any) { // Network errors or other client-side fetch issues
    console.error(`Client-side error calling CSS linting API for ${filePath}:`, error);
    return [createIssuePageClient('error', `Failed to call CSS linting service for ${filePath}.`, error.message)];
  }
}


const processCssContentAndCollectReferences = async (
  cssContent: string,
  cssFilePath: string,
  zip: JSZip,
  missingAssetsCollector: MissingAssetInfo[],
  referencedAssetPathsCollector: Set<string>,
  cssIssuesCollector: ValidationIssue[]
): Promise<void> => {
  // First, lint the CSS content
  const lintingIssues = await lintCssContentViaAPI(cssContent, cssFilePath);
  cssIssuesCollector.push(...lintingIssues);

  // Then, process for URL references (only if linting didn't return critical parse errors,
  // though url() extraction might still work on somewhat malformed CSS)
  const urlPattern = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match;

  while ((match = urlPattern.exec(cssContent)) !== null) {
    const originalUrl = match[0]; // e.g., url('../img/image.png')
    const assetUrlFromCss = match[2]; // e.g., ../img/image.png

    if (assetUrlFromCss.startsWith('data:') || assetUrlFromCss.startsWith('http:') || assetUrlFromCss.startsWith('https:') || assetUrlFromCss.startsWith('//')) {
      continue; // Skip data URIs and absolute URLs
    }

    const resolvedAssetPath = resolveAssetPathInZip(assetUrlFromCss, cssFilePath, zip);

    if (resolvedAssetPath && zip.file(resolvedAssetPath)) {
      referencedAssetPathsCollector.add(resolvedAssetPath);
    } else {
      missingAssetsCollector.push({
        type: 'cssRef',
        path: assetUrlFromCss, // The path as written in CSS
        referencedFrom: cssFilePath,
        originalSrc: originalUrl // The full url(...) pattern
      });
    }
  }
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
  let zipBaseDir = ''; // To help resolve paths like 'css/style.css' if HTML is in root

  try {
    const zip = await JSZip.loadAsync(file);
    const allZipFiles = Object.keys(zip.files).filter(path => !zip.files[path].dir && !path.startsWith("__MACOSX/") && !path.endsWith('.DS_Store'));

    const htmlFile = await findHtmlFileInZip(zip);

    if (!htmlFile) {
      // console.warn(`[analyzeCreativeAssets] No HTML file found in ${file.name}. All files will be marked as unreferenced.`);
      return { missingAssets, unreferencedFiles: allZipFiles, foundHtmlPath, htmlContent: htmlContentForAnalysis, cssLintIssues };
    }

    foundHtmlPath = htmlFile.path;
    if (foundHtmlPath.includes('/')) {
        zipBaseDir = foundHtmlPath.substring(0, foundHtmlPath.lastIndexOf('/') + 1);
    }
    referencedAssetPaths.add(foundHtmlPath); // The HTML file itself is referenced
    htmlContentForAnalysis = htmlFile.content;
    const doc = new DOMParser().parseFromString(htmlContentForAnalysis, 'text/html');

    // Process linked stylesheets
    const linkedStylesheets = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
    const processedCssPaths = new Set<string>(); // To avoid processing same CSS file multiple times

    for (const linkTag of linkedStylesheets) {
      const href = linkTag.getAttribute('href');
      if (href && !href.startsWith('http:') && !href.startsWith('https:') && !href.startsWith('data:')) {
        const cssFilePath = resolveAssetPathInZip(href, foundHtmlPath, zip);
        if (cssFilePath && zip.file(cssFilePath) && !processedCssPaths.has(cssFilePath)) {
          referencedAssetPaths.add(cssFilePath);
          processedCssPaths.add(cssFilePath);
          const cssContent = await zip.file(cssFilePath)!.async('string');
          await processCssContentAndCollectReferences(cssContent, cssFilePath, zip, missingAssets, referencedAssetPaths, cssLintIssues);
        } else if (!cssFilePath || !zip.file(cssFilePath)) {
          missingAssets.push({ type: 'htmlLinkCss', path: href, referencedFrom: foundHtmlPath, originalSrc: href });
        }
      }
    }
    
    // Proactively check for common CSS file paths if not already processed
    const commonCssSuffixes = ['style.css', 'css/style.css', 'main.css', 'css/main.css'];
    for (const suffix of commonCssSuffixes) {
        const potentialCssPath = zipBaseDir + suffix; // Relative to HTML's dir or ZIP root
        if (zip.file(potentialCssPath) && !processedCssPaths.has(potentialCssPath)) {
            // console.log(`[analyzeCreativeAssets] Proactively checking CSS: ${potentialCssPath}`);
            referencedAssetPaths.add(potentialCssPath);
            processedCssPaths.add(potentialCssPath);
            const cssContent = await zip.file(potentialCssPath)!.async('string');
            await processCssContentAndCollectReferences(cssContent, potentialCssPath, zip, missingAssets, referencedAssetPaths, cssLintIssues);
        } else {
            // Check from absolute ZIP root if not found relative to HTML dir
            const potentialAbsoluteCssPath = suffix;
             if (zipBaseDir !== '' && zip.file(potentialAbsoluteCssPath) && !processedCssPaths.has(potentialAbsoluteCssPath)) {
                // console.log(`[analyzeCreativeAssets] Proactively checking absolute CSS: ${potentialAbsoluteCssPath}`);
                referencedAssetPaths.add(potentialAbsoluteCssPath);
                processedCssPaths.add(potentialAbsoluteCssPath);
                const cssContent = await zip.file(potentialAbsoluteCssPath)!.async('string');
                await processCssContentAndCollectReferences(cssContent, potentialAbsoluteCssPath, zip, missingAssets, referencedAssetPaths, cssLintIssues);
            }
        }
    }


    // Process media elements (img, source)
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

    // Process script elements
    const scriptElements = Array.from(doc.querySelectorAll('script[src]'));
    for (const el of scriptElements) {
        const srcAttr = el.getAttribute('src');
        // Allow absolute URLs for CDNs like GSAP
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
        } else if (srcAttr && (srcAttr.startsWith('http:') || srcAttr.startsWith('https:'))) {
            // Assume external scripts are "referenced" for completeness, though we don't check their existence
            // Or, decide not to add them to referencedAssetPaths if we only care about local assets
        }
    }
    
    const unreferencedFiles: string[] = [];
    allZipFiles.forEach(filePathInZip => {
        if (!referencedAssetPaths.has(filePathInZip)) {
            unreferencedFiles.push(filePathInZip);
        }
    });

    return { missingAssets, unreferencedFiles, foundHtmlPath, htmlContent: htmlContentForAnalysis, cssLintIssues };

  } catch (error: any) {
    // console.error(`Error analyzing assets for ${file.name}:`, error);
    // In case of critical error (e.g. corrupt ZIP), mark all files as unreferenced or add a global error
    cssLintIssues.push(createIssuePageClient('error', `Critical error analyzing ZIP file ${file.name}.`, error.message, 'zip-analysis-error'));
    return { missingAssets, unreferencedFiles: [], foundHtmlPath, htmlContent: htmlContentForAnalysis, cssLintIssues };
  }
};

const findClickTagsInHtml = (htmlContent: string | null): ClickTagInfo[] => {
  if (!htmlContent) return [];

  const clickTags: ClickTagInfo[] = [];
  const clickTagRegex = /(?:^|[\s;,\{\(])\s*(?:(?:var|let|const)\s+)?(?:window\.)?([a-zA-Z0-9_]*clickTag[a-zA-Z0-9_]*)\s*=\s*["'](http[^"']+)["']/gmi;
  
  let scriptContent = "";
  const scriptTagRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  while((scriptMatch = scriptTagRegex.exec(htmlContent)) !== null) {
    scriptContent += scriptMatch[1] + "\n";
  }

  let match;
  while ((match = clickTagRegex.exec(scriptContent)) !== null) {
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

  const ruleset: RuleSet = {
    'tag-pair': true,
    'attr-lowercase': true,
    'attr-value-double-quotes': true,
    'doctype-first': false, 
    'spec-char-escape': true,
    'id-unique': true,
    'src-not-empty': true,
    'tag-self-close': false, 
    'img-alt-require': true,
    'head-script-disabled': false, 
    'style-disabled': false, 
  };

  const messages = HTMLHint.verify(htmlString, ruleset);
  return messages.map((msg: LintResult) => {
    let issueType: 'error' | 'warning' = 'warning'; 
    if (msg.type === 'error') { 
      issueType = 'error';
    }
    return createIssuePageClient(
      issueType,
      msg.message,
      `Line: ${msg.line}, Col: ${msg.col}, Rule: ${msg.rule.id}`,
      msg.rule.id
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
    issues.push(createIssuePageClient('error', `File size exceeds limit (${(MAX_FILE_SIZE / 1024).toFixed(0)}KB).`));
  }

  const detectedClickTagsForReport = findClickTagsInHtml(analysis.htmlContent || null);

  if (detectedClickTagsForReport.length === 0 && analysis.htmlContent) {
    let detailsForClickTagError: string | undefined = undefined;
    const enablerScriptRegex = /<script[^>]*src\s*=\s*['"][^'"]*enabler\.js[^'"]*['"][^>]*>/i;

    if (analysis.htmlContent && enablerScriptRegex.test(analysis.htmlContent)) {
      detailsForClickTagError = "This creative might be designed for Google Ad Manager (formerly DoubleClick Studio/DCS) as 'Enabler.js' is present. This validator is not intended for creatives relying on Enabler.js for clickTag functionality, as they handle clickTags differently.";
    }
    issues.push(createIssuePageClient('error', 'No clickTags found or clickTag implementation is missing/invalid.', detailsForClickTagError));
  } else {
    for (const tag of detectedClickTagsForReport) {
      if (!tag.isHttps) {
        issues.push(createIssuePageClient('warning', `ClickTag '${tag.name}' uses non-HTTPS URL.`, `URL: ${tag.url}`));
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
    issues.push(createIssuePageClient('warning', message, `Original path: ${missing.path}`));
  }

  for (const unreferencedFilePath of analysis.unreferencedFiles) {
    issues.push(createIssuePageClient('warning', `Unreferenced file in ZIP: '${unreferencedFilePath}'.`, `Consider removing if not used to reduce file size.`));
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
           issues.push(createIssuePageClient('error', 'Invalid numeric values in ad.size meta tag.', `Parsed non-numeric values from: "${adSizeMetaTagContent}"`));
        }
      } else {
         issues.push(createIssuePageClient('error', 'Malformed ad.size meta tag content.', `Content: "${adSizeMetaTagContent}". Expected "width=XXX,height=YYY".`));
      }
    } else {
      if (filenameIntrinsicWidth !== undefined && filenameIntrinsicHeight !== undefined) {
        actualMetaWidth = filenameIntrinsicWidth;
        actualMetaHeight = filenameIntrinsicHeight;
        issues.push(createIssuePageClient('warning', 'Required ad.size meta tag not found in HTML. Dimensions inferred from filename.', 'Ensure <meta name="ad.size" content="width=XXX,height=YYY"> is present.'));
      } else {
        issues.push(createIssuePageClient('error', 'Required ad.size meta tag not found in HTML and no dimensions in filename.', 'Ensure <meta name="ad.size" content="width=XXX,height=YYY"> is present or include dimensions in filename like _WIDTHxHEIGHT.zip.'));
      }
    }
  } else {
    if (filenameIntrinsicWidth !== undefined && filenameIntrinsicHeight !== undefined) {
      actualMetaWidth = filenameIntrinsicWidth;
      actualMetaHeight = filenameIntrinsicHeight;
      issues.push(createIssuePageClient('warning', 'Could not extract HTML. Dimensions inferred from filename.', 'Creative might be structured unusually or ZIP is empty/corrupt. Ad.size meta tag could not be verified.'));
    } else {
      issues.push(createIssuePageClient('error', 'Could not extract HTML and no dimensions in filename.', 'Unable to determine dimensions. Ad.size meta tag could not be verified.'));
    }
  }
  
  let expectedDim: { width: number; height: number };
  if (actualMetaWidth !== undefined && actualMetaHeight !== undefined) {
    expectedDim = { width: actualMetaWidth, height: actualMetaHeight };
  } else if (filenameIntrinsicWidth !== undefined && filenameIntrinsicHeight !== undefined) {
      expectedDim = { width: filenameIntrinsicWidth, height: filenameIntrinsicHeight };
      if (!issues.some(iss => iss.message.includes("ad.size meta tag") || iss.message.includes("Could not extract HTML"))) {
        issues.push(createIssuePageClient('warning', 'Ad dimensions inferred from filename due to missing/invalid ad.size meta tag or HTML extraction issues.'));
      }
  } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0 && analysis.htmlContent) {
      const fallbackDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
      expectedDim = {width: fallbackDim.width, height: fallbackDim.height};
      issues.push(createIssuePageClient('error', `Could not determine ad dimensions from meta tag or filename. Defaulted to a fallback guess: ${fallbackDim.width}x${fallbackDim.height}. Verify ad.size meta tag and filename conventions.`));
  } else {
      // Fallback if no dimensions could be determined from any source
      expectedDim = { width: 300, height: 250 }; // A common default
      if (analysis.htmlContent || (filenameIntrinsicWidth === undefined && filenameIntrinsicHeight === undefined)) {
         // Only add this error if we actually had HTML to parse or no filename dimensions
         issues.push(createIssuePageClient('error', 'Could not determine ad dimensions. Defaulted to 300x250. Ensure ad.size meta tag or filename convention is used.'));
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
    issues.push(createIssuePageClient('error', 'Invalid file structure. Primary HTML file could not be extracted.'));
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
    detectedClickTags: detectedClickTagsForReport.length > 0 ? detectedClickTagsForReport : undefined,
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
        } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0) { // Fallback to a random common dimension if not in filename
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
            fileStructureOk: true, // Assume true initially
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
        // console.error(`Error during validation for ${file.name}:`, error);
        const errorResult: ValidationResult = {
            id: currentPendingResultId, 
            fileName: file.name,
            status: 'error',
            issues: [createIssuePageClient('error', 'An unexpected error occurred during validation process.', (error as Error).message)],
            fileSize: file.size,
            maxFileSize: MAX_FILE_SIZE,
            fileStructureOk: false, // Assume false on critical error
            adDimensions: initialPendingResults[index].adDimensions, // Use initial pending dimensions
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
    // Clear results if selected files are cleared
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

    