
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

const ALLOWED_IMAGE_EXTENSIONS = ['.gif', '.jpg', '.jpeg', '.png', '.svg'];

interface MissingAssetInfo {
  type: 'cssRef' | 'htmlImg' | 'htmlSource' | 'htmlLinkCss' | 'htmlScript' | 'jsManifestImg';
  path: string;
  referencedFrom: string;
  originalSrc: string;
}

interface CreativeAssetAnalysis {
  missingAssets: MissingAssetInfo[];
  unreferencedFiles: string[];
  foundHtmlPath?: string;
  htmlContent?: string;
  cssLintIssues: ValidationIssue[];
  formatIssues: ValidationIssue[];
  hasNonCdnExternalScripts: boolean;
  htmlFileCount: number;
  allHtmlFilePathsInZip: string[];
  isAdobeAnimateProject: boolean;
}


const createIssuePageClient = (type: 'error' | 'warning' | 'info', message: string, details?: string, rule?: string): ValidationIssue => ({
  id: `issue-page-client-${Math.random().toString(36).substr(2, 9)}`,
  type,
  message,
  details,
  rule: rule || (type === 'error' ? 'client-error' : (type === 'warning' ? 'client-warning' : 'client-info')),
});

const stripQueryString = (path: string): string => {
  return path.split('?')[0];
};

const resolveAssetPathInZip = (assetPath: string, baseFilePath: string, zip: JSZip): string | null => {
  const cleanedAssetPath = stripQueryString(assetPath); 

  if (cleanedAssetPath.startsWith('data:') || cleanedAssetPath.startsWith('http:') || cleanedAssetPath.startsWith('https:') || cleanedAssetPath.startsWith('//')) {
    return cleanedAssetPath; 
  }

  let basePathSegments = baseFilePath.includes('/') ? baseFilePath.split('/').slice(0, -1) : [];
  const assetPathSegments = cleanedAssetPath.split('/');
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
  const zipFileObject = zip.file(resolvedPath);
  if (zipFileObject) {
    return zipFileObject.name; // Return canonical name
  }
  
  // Fallback for assets directly in root if assetPath has no slashes and previous attempt failed
  const zipFileObjectRoot = zip.file(cleanedAssetPath);
  if (!cleanedAssetPath.includes('/') && zipFileObjectRoot) { 
    return zipFileObjectRoot.name; // Return canonical name
  }
  return null;
};


const findHtmlFileInZip = async (zip: JSZip): Promise<{ path: string, content: string } | null> => {
  const allFiles = Object.keys(zip.files);
  const rootIndexHtmlCandidates = allFiles.filter(path => 
    path.toLowerCase().endsWith('index.html') && !path.startsWith("__MACOSX/")
  );

  let shortestDepthIndexHtml: string | null = null;
  let minDepth = Infinity;

  for (const path of rootIndexHtmlCandidates) {
      const depth = path.split('/').length - 1; 
      if (depth < minDepth) {
          minDepth = depth;
          shortestDepthIndexHtml = path;
      }
  }
  
  if (shortestDepthIndexHtml) {
      const htmlFileObject = zip.file(shortestDepthIndexHtml);
      if (htmlFileObject) {
        const content = await htmlFileObject.async("string");
        return { path: htmlFileObject.name, content }; 
      }
  }

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

  if (shortestDepthAnyHtml) {
      const htmlFileObject = zip.file(shortestDepthAnyHtml);
      if (htmlFileObject) {
        const content = await htmlFileObject.async("string");
        return { path: htmlFileObject.name, content }; 
      }
  }
  
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
        responseBodyText = await response.text(); 
        const errorData = JSON.parse(responseBodyText); 

        if (errorData.issues && errorData.issues.length > 0 && errorData.issues[0].message) {
           errorDetails = errorData.issues[0].message;
           if(errorData.issues[0].details) errorDetails += ` Details: ${errorData.issues[0].details}`;
        } else if (errorData.error) { 
          errorDetails = errorData.error;
        } else if (responseBodyText) { 
           errorDetails = responseBodyText;
        }
      } catch (e) {
        if (responseBodyText) {
            errorDetails = responseBodyText;
        }
      }
      
      console.error(`CSS linting API error for ${filePath}. Status: ${response.status}. Details/Body: ${errorDetails}`);
      return [
        createIssuePageClient(
          'error',
          `CSS linting service request failed for ${filePath}.`,
          errorDetails.substring(0, 500) 
        ),
      ];
    }

    const data = await response.json();
    if (data.issues && Array.isArray(data.issues)) {
      return data.issues.map((issue: any) => createIssuePageClient(
        issue.type as ('error' | 'warning' | 'info'), 
        issue.message || 'Unknown linting issue',
        issue.details || `Line: ${issue.line}, Col: ${issue.column}, Rule: ${issue.rule || 'unknown'}`,
        issue.rule || 'unknown'
      ));
    }
    return [createIssuePageClient('warning', `CSS linting returned no issues for ${filePath}, or an unexpected response format.`)];
  } catch (error: any) { 
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
  cssIssuesCollector: ValidationIssue[],
  formatIssuesCollector: ValidationIssue[]
): Promise<void> => {
  const lintingIssues = await lintCssContentViaAPI(cssContent, cssFilePath);
  cssIssuesCollector.push(...lintingIssues);

  const urlPattern = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match;

  while ((match = urlPattern.exec(cssContent)) !== null) {
    const originalUrl = match[0]; 
    const assetUrlFromCss = match[2];
    const cleanedAssetUrl = stripQueryString(assetUrlFromCss);


    if (cleanedAssetUrl.startsWith('data:') || cleanedAssetUrl.startsWith('http:') || cleanedAssetUrl.startsWith('https:') || cleanedAssetUrl.startsWith('//')) {
      continue; 
    }

    const resolvedAssetPath = resolveAssetPathInZip(cleanedAssetUrl, cssFilePath, zip);

    if (resolvedAssetPath) {
      const zipFileObject = zip.file(resolvedAssetPath);
      if (zipFileObject) {
        referencedAssetPathsCollector.add(zipFileObject.name); 
        const extension = zipFileObject.name.substring(zipFileObject.name.lastIndexOf('.')).toLowerCase();
        if (extension && !ALLOWED_IMAGE_EXTENSIONS.includes(extension)) {
          formatIssuesCollector.push(createIssuePageClient(
            'error', 
            `Unsupported image format used: '${zipFileObject.name.split('/').pop()}' in CSS context ('${cssFilePath}').`,
            `Allowed formats are: ${ALLOWED_IMAGE_EXTENSIONS.join(', ')}. Path: ${zipFileObject.name}`,
            'unsupported-css-image-format'
          ));
        }
      } else {
         missingAssetsCollector.push({
          type: 'cssRef',
          path: cleanedAssetUrl, 
          referencedFrom: cssFilePath,
          originalSrc: originalUrl 
        });
      }
    } else {
      missingAssetsCollector.push({
        type: 'cssRef',
        path: cleanedAssetUrl, 
        referencedFrom: cssFilePath,
        originalSrc: originalUrl 
      });
    }
  }
};

const checkDynamicImageLoader = (
    jsContent: string, 
    sourceDescription: string, 
    formatIssuesCollector: ValidationIssue[],
    ruleId: string
) => {
    const querySelectorPattern = /querySelectorAllforEach\s*\(\s*["']\[id\*=_svg\],\s*\[id\*=_jpg\],\s*\[id\*=_png\],\s*\[id\*=_gif\]["']\s*,/;
    const idReplaceLogicPattern = /const\s+fn\s*=\s*item\.getAttribute\s*\(\s*["']id["']\s*\)\s*\.replaceAll\s*\(\s*["']_["']\s*,\s*["']\.["']\s*\)/;
    const imgSrcUsesFnPattern = /img\.src\s*=[^;]*(\b|\$\{)fn(\b|\}|"|\')\s*[^;]*;/; 

    if (querySelectorPattern.test(jsContent) && idReplaceLogicPattern.test(jsContent) && imgSrcUsesFnPattern.test(jsContent)) {
        formatIssuesCollector.push(createIssuePageClient(
            'info',
            `Potential dynamic image loading script detected in: ${sourceDescription}.`,
            'The script appears to use a pattern (e.g., "Autoload Sequence" using "querySelectorAllforEach" and "item.getAttribute(\'id\').replaceAll") to load images based on element IDs. Images loaded this way (e.g., using a variable like "fn" in img.src) might not be fully trackable by static analysis. If a global path like "window.PATH" is used, ensure it\'s correctly defined. Verify all dynamically loaded assets are present in the ZIP.',
            ruleId
        ));
    }
};

const parseAnimateManifest = (
  jsContent: string,
  jsFilePath: string, 
  htmlFilePath: string, 
  zip: JSZip,
  missingAssetsCollector: MissingAssetInfo[],
  referencedAssetPathsCollector: Set<string>,
  formatIssuesCollector: ValidationIssue[]
): void => {
  const manifestRegex = /manifest\s*:\s*(\[[\s\S]*?\])/;
  const manifestMatch = jsContent.match(manifestRegex);

  if (manifestMatch && manifestMatch[1]) {
    const manifestArrayString = manifestMatch[1];
    const srcRegex = /\bsrc\s*:\s*"([^"]+)"/g;
    let srcMatch;
    while ((srcMatch = srcRegex.exec(manifestArrayString)) !== null) {
      const originalSrcPath = srcMatch[1]; 
      const cleanedManifestAssetPath = stripQueryString(originalSrcPath); 

      if (cleanedManifestAssetPath.startsWith('data:') || cleanedManifestAssetPath.startsWith('http:') || cleanedManifestAssetPath.startsWith('https:') || cleanedManifestAssetPath.startsWith('//')) {
        continue;
      }
      
      const resolvedAssetPath = resolveAssetPathInZip(cleanedManifestAssetPath, htmlFilePath, zip);

      if (resolvedAssetPath) {
        const zipFileObject = zip.file(resolvedAssetPath); 
        if (zipFileObject) {
          referencedAssetPathsCollector.add(zipFileObject.name); 
          const extension = zipFileObject.name.substring(zipFileObject.name.lastIndexOf('.')).toLowerCase();
          if (extension && !ALLOWED_IMAGE_EXTENSIONS.includes(extension)) {
            formatIssuesCollector.push(createIssuePageClient(
              'error',
              `Unsupported image format '${zipFileObject.name.split('/').pop()}' from JS manifest ('${jsFilePath}').`,
              `Allowed formats: ${ALLOWED_IMAGE_EXTENSIONS.join(', ')}. Path: ${zipFileObject.name}`,
              'unsupported-js-manifest-image-format'
            ));
          }
        } else {
           missingAssetsCollector.push({
            type: 'jsManifestImg',
            path: cleanedManifestAssetPath, 
            referencedFrom: jsFilePath,
            originalSrc: originalSrcPath 
          });
        }
      } else {
        missingAssetsCollector.push({
          type: 'jsManifestImg',
          path: cleanedManifestAssetPath,
          referencedFrom: jsFilePath,
          originalSrc: originalSrcPath
        });
      }
    }
  }
};


const analyzeCreativeAssets = async (file: File): Promise<CreativeAssetAnalysis> => {
  const missingAssets: MissingAssetInfo[] = [];
  const referencedAssetPaths = new Set<string>();
  const cssLintIssues: ValidationIssue[] = [];
  const formatIssues: ValidationIssue[] = [];
  let foundHtmlPath: string | undefined;
  let htmlContentForAnalysis: string | undefined;
  let zipBaseDir = ''; 
  let hasNonCdnExternalScripts = false;
  let htmlFileCount = 0;
  let allHtmlFilePathsInZip: string[] = [];
  let isAdobeAnimateProject = false;
  let mainAnimateJsContent: string | undefined;
  let mainAnimateJsPath: string | undefined;


  try {
    const zip = await JSZip.loadAsync(file);
    const allZipFiles = Object.keys(zip.files).filter(path => !zip.files[path].dir && !path.startsWith("__MACOSX/") && !path.endsWith('.DS_Store'));
    
    allHtmlFilePathsInZip = allZipFiles.filter(path => path.toLowerCase().endsWith('.html'));
    htmlFileCount = allHtmlFilePathsInZip.length;

    const htmlFile = await findHtmlFileInZip(zip);

    if (!htmlFile) {
      return { missingAssets, unreferencedFiles: allZipFiles, foundHtmlPath, htmlContent: htmlContentForAnalysis, cssLintIssues, formatIssues, hasNonCdnExternalScripts, htmlFileCount, allHtmlFilePathsInZip, isAdobeAnimateProject };
    }

    foundHtmlPath = htmlFile.path;
    if (foundHtmlPath.includes('/')) {
        zipBaseDir = foundHtmlPath.substring(0, foundHtmlPath.lastIndexOf('/') + 1);
    }
    referencedAssetPaths.add(foundHtmlPath); 
    htmlContentForAnalysis = htmlFile.content;
    const doc = new DOMParser().parseFromString(htmlContentForAnalysis, 'text/html');

    const animateMeta = doc.querySelector('meta[name="authoring-tool"][content="Adobe_Animate_CC"]');
    if (animateMeta) {
      isAdobeAnimateProject = true;
      formatIssues.push(createIssuePageClient(
        'info',
        'Adobe Animate CC project detected.',
        'This creative appears to be authored with Adobe Animate CC.',
        'authoring-tool-animate-cc'
      ));
    }

    const linkedStylesheets = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
    const processedCssPaths = new Set<string>(); 

    for (const linkTag of linkedStylesheets) {
      const href = linkTag.getAttribute('href');
      if (href) {
        const cleanedHref = stripQueryString(href);
        if (!cleanedHref.startsWith('http:') && !cleanedHref.startsWith('https:') && !cleanedHref.startsWith('data:')) {
            const cssFilePathResolved = resolveAssetPathInZip(cleanedHref, foundHtmlPath, zip);
            if (cssFilePathResolved) {
                const cssFileObject = zip.file(cssFilePathResolved);
                if (cssFileObject && !processedCssPaths.has(cssFileObject.name)) {
                    referencedAssetPaths.add(cssFileObject.name); 
                    processedCssPaths.add(cssFileObject.name);
                    const cssContent = await cssFileObject.async('string');
                    await processCssContentAndCollectReferences(cssContent, cssFileObject.name, zip, missingAssets, referencedAssetPaths, cssLintIssues, formatIssues);
                } else if (!cssFileObject) {
                     missingAssets.push({ type: 'htmlLinkCss', path: cleanedHref, referencedFrom: foundHtmlPath, originalSrc: href });
                }
            } else {
                 missingAssets.push({ type: 'htmlLinkCss', path: cleanedHref, referencedFrom: foundHtmlPath, originalSrc: href });
            }
        }
      }
    }
    
    const commonCssSuffixes = ['style.css', 'css/style.css', 'main.css', 'css/main.css'];
    for (const suffix of commonCssSuffixes) {
        const potentialCssPath = zipBaseDir + suffix; 
        const resolvedCommonCssPath = resolveAssetPathInZip(potentialCssPath, foundHtmlPath, zip);
        if (resolvedCommonCssPath) {
            const cssFileObject = zip.file(resolvedCommonCssPath);
            if (cssFileObject && !processedCssPaths.has(cssFileObject.name)) {
                referencedAssetPaths.add(cssFileObject.name); 
                processedCssPaths.add(cssFileObject.name);
                const cssContent = await cssFileObject.async('string');
                await processCssContentAndCollectReferences(cssContent, cssFileObject.name, zip, missingAssets, referencedAssetPaths, cssLintIssues, formatIssues);
            }
        } else { 
            const potentialAbsoluteCssPath = suffix;
            const resolvedAbsoluteCssPath = resolveAssetPathInZip(potentialAbsoluteCssPath, foundHtmlPath, zip);
            if (zipBaseDir !== '' && resolvedAbsoluteCssPath) {
                const cssFileObject = zip.file(resolvedAbsoluteCssPath);
                if (cssFileObject && !processedCssPaths.has(cssFileObject.name)) {
                    referencedAssetPaths.add(cssFileObject.name); 
                    processedCssPaths.add(cssFileObject.name);
                    const cssContent = await cssFileObject.async('string');
                    await processCssContentAndCollectReferences(cssContent, cssFileObject.name, zip, missingAssets, referencedAssetPaths, cssLintIssues, formatIssues);
                }
            }
        }
    }

    const styleTags = Array.from(doc.querySelectorAll('style'));
    for (const styleTag of styleTags) {
        const inlineCssContent = styleTag.textContent || '';
        if (inlineCssContent.trim()) {
            await processCssContentAndCollectReferences(inlineCssContent, foundHtmlPath, zip, missingAssets, referencedAssetPaths, cssLintIssues, formatIssues);
        }
    }


    const mediaElements = Array.from(doc.querySelectorAll('img[src], source[src]'));
    for (const el of mediaElements) {
        const srcAttr = el.getAttribute('src');
        if (srcAttr) {
            const cleanedSrcAttr = stripQueryString(srcAttr);
            if (!cleanedSrcAttr.startsWith('data:') && !cleanedSrcAttr.startsWith('http:') && !cleanedSrcAttr.startsWith('https:') && !cleanedSrcAttr.startsWith('//')) {
                const assetPathResolved = resolveAssetPathInZip(cleanedSrcAttr, foundHtmlPath, zip);
                if (assetPathResolved) {
                    const assetFileObject = zip.file(assetPathResolved);
                    if (assetFileObject) {
                        referencedAssetPaths.add(assetFileObject.name); 
                        const extension = assetFileObject.name.substring(assetFileObject.name.lastIndexOf('.')).toLowerCase();
                        if (extension && !ALLOWED_IMAGE_EXTENSIONS.includes(extension)) {
                            formatIssues.push(createIssuePageClient(
                                'error', 
                                `Unsupported image format used: '${assetFileObject.name.split('/').pop()}' in HTML.`,
                                `Allowed formats are: ${ALLOWED_IMAGE_EXTENSIONS.join(', ')}. Path: ${assetFileObject.name}`,
                                'unsupported-html-image-format'
                            ));
                        }
                    } else {
                         missingAssets.push({
                            type: el.tagName.toLowerCase() === 'img' ? 'htmlImg' : 'htmlSource',
                            path: cleanedSrcAttr,
                            referencedFrom: foundHtmlPath,
                            originalSrc: srcAttr
                        });
                    }
                } else {
                    missingAssets.push({
                        type: el.tagName.toLowerCase() === 'img' ? 'htmlImg' : 'htmlSource',
                        path: cleanedSrcAttr,
                        referencedFrom: foundHtmlPath,
                        originalSrc: srcAttr
                    });
                }
            }
        }
    }

    const scriptElements = Array.from(doc.querySelectorAll('script[src]'));
    for (const el of scriptElements) {
        const srcAttr = el.getAttribute('src');
        if (srcAttr) {
            const cleanedSrcAttr = stripQueryString(srcAttr);
            const isExternalUrl = cleanedSrcAttr.startsWith('http:') || cleanedSrcAttr.startsWith('https:') || cleanedSrcAttr.startsWith('//');
            const isDataUri = cleanedSrcAttr.startsWith('data:');

            if (!isExternalUrl && !isDataUri) { 
                const resolvedScriptPath = resolveAssetPathInZip(cleanedSrcAttr, foundHtmlPath, zip);
                if (resolvedScriptPath) {
                    const jsFileObject = zip.file(resolvedScriptPath);
                    if (jsFileObject) {
                        referencedAssetPaths.add(jsFileObject.name); 
                        const htmlFileNameWithoutExt = foundHtmlPath.substring(foundHtmlPath.lastIndexOf('/') + 1).replace(/\.html?$/i, '');
                        const scriptFileNameWithoutExt = jsFileObject.name.substring(jsFileObject.name.lastIndexOf('/') + 1).replace(/\.js$/i, '');

                        if (isAdobeAnimateProject && jsFileObject.name.toLowerCase().endsWith('.js')) {
                           if (!mainAnimateJsPath || scriptFileNameWithoutExt === htmlFileNameWithoutExt || jsFileObject.name.includes(htmlFileNameWithoutExt)) { // Broader match for Animate JS
                                mainAnimateJsContent = await jsFileObject.async('string');
                                mainAnimateJsPath = jsFileObject.name; 
                            }
                        }
                    } else {
                         missingAssets.push({
                            type: 'htmlScript',
                            path: cleanedSrcAttr,
                            referencedFrom: foundHtmlPath, 
                            originalSrc: srcAttr
                        });
                    }
                } else { 
                     missingAssets.push({
                        type: 'htmlScript',
                        path: cleanedSrcAttr,
                        referencedFrom: foundHtmlPath, 
                        originalSrc: srcAttr
                    });
                }
            } else if (isExternalUrl) {
                 const cdnPatterns = [
                    /^(https?:)?\/\/s0\.2mdn\.net\//, 
                    /^(https?:)?\/\/tpc\.googlesyndication\.com\//,
                    /^(https?:)?\/\/secure-\w+\.adnxs\.com\//, 
                    /^(https?:)?\/\/ads\.yahoo\.com\//,
                    /^(https?:)?\/\/cdn\.ampproject\.org\//,
                    /^(https?:)?\/\/cdnjs\.cloudflare\.com\//,
                    /^(https?:)?\/\/ajax\.googleapis\.com\//,
                    /^(https?:)?\/\/code\.jquery\.com\//,
                    /^(https?:)?\/\/maxcdn\.bootstrapcdn\.com\//,
                    /^(https?:)?\/\/cdn\.jsdelivr\.net\//,
                    /^(https?:)?\/\/unpkg\.com\//,
                 ];
                 const isCdnHosted = cdnPatterns.some(pattern => pattern.test(cleanedSrcAttr));
                 if (!isCdnHosted) {
                   hasNonCdnExternalScripts = true;
                 }
            }
        }
    }

    if (isAdobeAnimateProject && mainAnimateJsContent && mainAnimateJsPath && foundHtmlPath) {
        parseAnimateManifest(mainAnimateJsContent, mainAnimateJsPath, foundHtmlPath, zip, missingAssets, referencedAssetPaths, formatIssues);
    }
    
    const inlineScriptTags = Array.from(doc.querySelectorAll('script:not([src])'));
    let allInlineJsContent = '';
    inlineScriptTags.forEach(tag => {
        allInlineJsContent += (tag.textContent || '') + '\n';
    });

    if (allInlineJsContent.trim()) {
        checkDynamicImageLoader(
            allInlineJsContent,
            `inline script in ${foundHtmlPath}`,
            formatIssues,
            'dynamic-image-loader-script-inline'
        );
    }

    const allJsFilePathsInZipScan = allZipFiles.filter(path => path.toLowerCase().endsWith('.js'));
    for (const jsFilePath of allJsFilePathsInZipScan) {
      if (jsFilePath === mainAnimateJsPath) continue; 
        const jsFileObject = zip.file(jsFilePath);
        if (jsFileObject) {
            const jsContent = await jsFileObject.async('string');
            checkDynamicImageLoader(
                jsContent,
                jsFileObject.name, 
                formatIssues,
                'dynamic-image-loader-script-external'
            );
        }
    }
    
    const htmlImageIdElements = Array.from(doc.querySelectorAll('[id$="_svg"], [id$="_jpg"], [id$="_png"], [id$="_gif"]'));
    const expectedImagesFromHtml = new Map<string, { id: string, referencedFromHtml: string }>();
    htmlImageIdElements.forEach(el => {
        const id = el.getAttribute('id');
        if (id) {
            const suffixMatch = id.match(/(_(?:svg|jpg|png|gif))$/i);
            if (suffixMatch) {
                const baseName = id.substring(0, id.length - suffixMatch[1].length);
                const extension = suffixMatch[1].substring(1).toLowerCase();
                const expectedFileName = `${baseName}.${extension}`;
                if (foundHtmlPath) {
                    expectedImagesFromHtml.set(expectedFileName.toLowerCase(), { id, referencedFromHtml: foundHtmlPath });
                }
            }
        }
    });

    const imagesFolderName = 'images';
    const imagesFolderPath = (zipBaseDir + imagesFolderName + '/').replace(/^\/+/, ''); 
    const actualFilesInImagesFolder = new Map<string, string>(); 
    let imagesFolderExists = false;
    
    allZipFiles.forEach(zipFilePath => {
      const lowerZipFilePath = zipFilePath.toLowerCase();
      const lowerImagesFolderPath = imagesFolderPath.toLowerCase();
        if (lowerZipFilePath.startsWith(lowerImagesFolderPath) && zipFilePath.length > imagesFolderPath.length) {
            imagesFolderExists = true;
            const fileNameInFolder = zipFilePath.substring(imagesFolderPath.length);
            if (fileNameInFolder.includes('/')) return; 

            const extensionMatch = fileNameInFolder.match(/\.([^.]+)$/);
            if (extensionMatch && ALLOWED_IMAGE_EXTENSIONS.includes(`.${extensionMatch[1].toLowerCase()}`)) {
                 actualFilesInImagesFolder.set(fileNameInFolder.toLowerCase(), zipFilePath); 
            }
        }
    });
    
    if (expectedImagesFromHtml.size > 0) {
        if (!imagesFolderExists && htmlImageIdElements.length > 0) {
            const firstExpectedId = htmlImageIdElements[0].getAttribute('id') || 'example_id_suffix';
             formatIssues.push(createIssuePageClient(
                'error',
                `HTML declares image IDs (e.g., '${firstExpectedId}') implying an '${imagesFolderName}/' folder, but this folder ('${imagesFolderPath}') was not found in the ZIP.`,
                `Ensure an '${imagesFolderName}/' folder exists at the expected location relative to the HTML file, containing the required images.`,
                'html-id-images-folder-missing'
            ));
        } else if (imagesFolderExists) {
            expectedImagesFromHtml.forEach(({ id, referencedFromHtml }, normalizedExpectedFilename) => {
                const actualZipPath = actualFilesInImagesFolder.get(normalizedExpectedFilename);
                if (!actualZipPath || !zip.file(actualZipPath) ) { 
                    formatIssues.push(createIssuePageClient(
                        'error',
                        `Image for ID '${id}' in HTML ('${referencedFromHtml}') not found in '${imagesFolderPath}'.`,
                        `Expected file: '${normalizedExpectedFilename}' in folder '${imagesFolderPath}'. Please ensure the file exists and names match (case-insensitive check for map lookup, but file system is key).`,
                        'html-id-image-missing-in-folder'
                    ));
                } else {
                    const zipFileObject = zip.file(actualZipPath); 
                    if (zipFileObject) {
                       referencedAssetPaths.add(zipFileObject.name); 
                    }
                }
            });
        }
    }

    if (imagesFolderExists) {
        actualFilesInImagesFolder.forEach((zipFilePath, normalizedActualFilename) => {
            const expectedByHtmlId = expectedImagesFromHtml.has(normalizedActualFilename);
            const alreadyReferenced = referencedAssetPaths.has(zipFilePath); 

            if (!expectedByHtmlId && !alreadyReferenced) {
                 const suggestedIdBase = normalizedActualFilename.substring(0, normalizedActualFilename.lastIndexOf('.'));
                 const suggestedIdSuffix = normalizedActualFilename.substring(normalizedActualFilename.lastIndexOf('.') + 1);
                 const suggestedId = `${suggestedIdBase}_${suggestedIdSuffix}`;
                formatIssues.push(createIssuePageClient(
                    'warning',
                    `Unreferenced image file '${zipFilePath}' in '${imagesFolderPath}'.`,
                    `This file is in the '${imagesFolderName}/' folder but is not directly used by an <img src="...">, CSS url(), or an HTML element ID like '<div id="${suggestedId}"></div>'. Consider removing if not needed.`,
                    'images-folder-unreferenced-image'
                ));
            }
        });
    }


    const unreferencedFiles: string[] = [];
    allZipFiles.forEach(filePathInZip => {
        if (!referencedAssetPaths.has(filePathInZip) && filePathInZip !== foundHtmlPath) { 
            if (htmlFileCount > 1 && allHtmlFilePathsInZip.includes(filePathInZip)) {
                // This case is handled by the multiple HTML files error
            } else {
                 unreferencedFiles.push(filePathInZip);
            }
        }
    });

    return { missingAssets, unreferencedFiles, foundHtmlPath, htmlContent: htmlContentForAnalysis, cssLintIssues, formatIssues, hasNonCdnExternalScripts, htmlFileCount, allHtmlFilePathsInZip, isAdobeAnimateProject };

  } catch (error: any) {
    cssLintIssues.push(createIssuePageClient('error', `Critical error analyzing ZIP file ${file.name}.`, error.message, 'zip-analysis-error'));
    return { missingAssets, unreferencedFiles: [], foundHtmlPath, htmlContent: htmlContentForAnalysis, cssLintIssues, formatIssues, hasNonCdnExternalScripts, htmlFileCount, allHtmlFilePathsInZip, isAdobeAnimateProject };
  }
};

const findClickTagsInHtml = (htmlContent: string | null): ClickTagInfo[] => {
  if (!htmlContent) return [];

  const clickTags: ClickTagInfo[] = [];
  const clickTagRegex = /(?:^|[\s;,\{\(\[])\s*(?:(?:var|let|const)\s+)?(?:window\.)?([a-zA-Z0-9_]*clickTag[a-zA-Z0-9_]*)\s*=\s*(["'])((?:https?:\/\/)(?:(?!\2).)*?)\2/gmi;


  let scriptContent = "";
  const scriptTagRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  while((scriptMatch = scriptTagRegex.exec(htmlContent)) !== null) {
    scriptContent += scriptMatch[1] + "\n"; 
  }

  let match;
  while ((match = clickTagRegex.exec(scriptContent)) !== null) {
    const name = match[1]; 
    const url = match[3]; 
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
    'attr-value-double-quotes': 'warning', 
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
    let issueType: 'error' | 'warning' | 'info' = 'warning'; 
    if (msg.type === 'error') { 
      issueType = 'error';
    } else if (msg.type === 'warning') {
      issueType = 'warning';
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
  analysis: CreativeAssetAnalysis
): Promise<Omit<ValidationResult, 'id' | 'fileName' | 'fileSize'>> => {
  const issues: ValidationIssue[] = [];
  let status: ValidationResult['status'] = 'success';
  let hasCorrectTopLevelClickTag = false;

  if (file.size > MAX_FILE_SIZE) {
    issues.push(createIssuePageClient('error', `File size exceeds limit (${(MAX_FILE_SIZE / 1024).toFixed(0)}KB).`));
  }

  if (analysis.htmlFileCount > 1) {
    issues.push(createIssuePageClient(
      'error',
      'Multiple HTML files found in ZIP.',
      `The ZIP file should contain only one primary HTML file. Found ${analysis.htmlFileCount} HTML files: ${analysis.allHtmlFilePathsInZip.join(', ')}.`,
      'multiple-html-files'
    ));
  }

  const detectedClickTags = findClickTagsInHtml(analysis.htmlContent || null);

  if (detectedClickTags.length === 0 && analysis.htmlContent) { 
    let detailsForClickTagError: string | undefined = undefined;
    const enablerScriptRegex = /<script[^>]*src\s*=\s*['"][^'"]*enabler\.js[^'"]*['"][^>]*>/i;

    if (analysis.isAdobeAnimateProject) {
        detailsForClickTagError = "For Adobe Animate projects, ensure clickTags are implemented correctly within the Animate environment, typically on a button symbol or via `this.buttonName.addEventListener('click', function() { window.open(clickTag); });` or similar in the Actions panel. The clickTag variable itself should be declared globally in an HTML script tag.";
    } else if (analysis.htmlContent && enablerScriptRegex.test(analysis.htmlContent)) {
      detailsForClickTagError = "This creative might be designed for Google Ad Manager (formerly DoubleClick Studio/DCS) as 'Enabler.js' is present. This validator is not intended for creatives relying on Enabler.js for clickTag functionality, as they handle clickTags differently.";
    }
     issues.push(createIssuePageClient('error', 'No clickTags found or clickTag implementation is missing/invalid.', detailsForClickTagError));

    if (analysis.hasNonCdnExternalScripts) { 
        issues.push(createIssuePageClient(
            'warning',
            'clickTag declaration recommended in inline HTML script.',
            'The clickTag declaration was not found in inline <script> tags. If it\'s defined in an external JS file, consider moving it. Best practice is to place the clickTag variable (e.g., var clickTag = "URL";) within an inline <script> tag, preferably in the HTML <head>.',
            'clicktag-inline-script-preferred'
        ));
    }

  } else {
    for (const tag of detectedClickTags) {
      if (tag.name === "clickTag" && tag.isHttps) {
        hasCorrectTopLevelClickTag = true;
      }
      if (!tag.isHttps) {
        issues.push(createIssuePageClient('warning', `ClickTag '${tag.name}' uses non-HTTPS URL.`, `URL: ${tag.url}`));
      }
    }
  }

  for (const missing of analysis.missingAssets) {
    let message = "";
    if (missing.type === 'cssRef') {
      message = `Asset '${missing.originalSrc}' referenced in CSS ('${missing.referencedFrom}') not found in ZIP.`;
    } else if (missing.type === 'htmlImg') {
      message = `Image '${missing.originalSrc}' referenced in HTML ('${missing.referencedFrom}') not found in ZIP.`;
    } else if (missing.type === 'htmlSource') {
      message = `Media source '${missing.originalSrc}' referenced in HTML ('${missing.referencedFrom}') not found in ZIP.`;
    } else if (missing.type === 'htmlLinkCss') {
      message = `CSS file '${missing.originalSrc}' linked in HTML ('${missing.referencedFrom}') not found in ZIP.`;
    } else if (missing.type === 'htmlScript') {
      message = `JavaScript file '${missing.originalSrc}' linked in HTML ('${missing.referencedFrom}') not found in ZIP.`;
    } else if (missing.type === 'jsManifestImg') {
      message = `Image '${missing.originalSrc}' from JS manifest ('${missing.referencedFrom}') not found in ZIP.`;
    }
    issues.push(createIssuePageClient('warning', message, `Attempted path: ${missing.path}`));
  }

  for (const unreferencedFilePath of analysis.unreferencedFiles) {
    issues.push(createIssuePageClient('warning', `Unreferenced file in ZIP: '${unreferencedFilePath}'.`, `Consider removing if not used to reduce file size.`));
  }
  
  issues.push(...analysis.cssLintIssues);
  issues.push(...analysis.formatIssues); 


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
      const metaDimRegex = /width=([^,;\s"]+)[,;]?\s*height=([^,;\s"]+)/i; 
      const metaDimValMatch = adSizeMetaTagContent.match(metaDimRegex);

      if (metaDimValMatch && metaDimValMatch[1] && metaDimValMatch[2]) {
        const widthStr = metaDimValMatch[1];
        const heightStr = metaDimValMatch[2];

        const parsedWidth = parseInt(widthStr, 10);
        const parsedHeight = parseInt(heightStr, 10);

        const isWidthValid = !isNaN(parsedWidth) && parsedWidth.toString() === widthStr;
        const isHeightValid = !isNaN(parsedHeight) && parsedHeight.toString() === heightStr;

        if (isWidthValid && isHeightValid) {
          actualMetaWidth = parsedWidth;
          actualMetaHeight = parsedHeight;
        } else {
           issues.push(createIssuePageClient(
               'error', 
               'Invalid numeric values in ad.size meta tag.', 
               `Content: "${adSizeMetaTagContent}". Width and height must be whole numbers. Found: width='${widthStr}', height='${heightStr}'.`,
               'meta-size-invalid-values'
            ));
        }
      } else {
         issues.push(createIssuePageClient(
             'error', 
             'Malformed ad.size meta tag content.', 
             `Content: "${adSizeMetaTagContent}". Expected "width=XXX,height=YYY".`,
             'meta-size-malformed-content'
        ));
      }
    } else {
      if (filenameIntrinsicWidth !== undefined && filenameIntrinsicHeight !== undefined) {
        actualMetaWidth = filenameIntrinsicWidth;
        actualMetaHeight = filenameIntrinsicHeight;
        issues.push(createIssuePageClient('warning', 'Required ad.size meta tag not found in HTML. Dimensions inferred from filename.', 'Ensure <meta name="ad.size" content="width=XXX,height=YYY"> is present.', 'meta-size-missing-inferred-filename'));
      } else {
        issues.push(createIssuePageClient('error', 'Required ad.size meta tag not found in HTML and no dimensions in filename.', 'Ensure <meta name="ad.size" content="width=XXX,height=YYY"> is present or include dimensions in filename like _WIDTHxHEIGHT.zip.', 'meta-size-missing-no-filename'));
      }
    }
  } else {
    if (filenameIntrinsicWidth !== undefined && filenameIntrinsicHeight !== undefined) {
      actualMetaWidth = filenameIntrinsicWidth;
      actualMetaHeight = filenameIntrinsicHeight;
      issues.push(createIssuePageClient('warning', 'Could not extract HTML. Dimensions inferred from filename.', 'Creative might be structured unusually or ZIP is empty/corrupt. Ad.size meta tag could not be verified.', 'meta-size-no-html-inferred-filename'));
    } else {
      issues.push(createIssuePageClient('error', 'Could not extract HTML and no dimensions in filename.', 'Unable to determine dimensions. Ad.size meta tag could not be verified.', 'meta-size-no-html-no-filename'));
    }
  }
  
  let expectedDim: { width: number; height: number };
  if (actualMetaWidth !== undefined && actualMetaHeight !== undefined) {
    expectedDim = { width: actualMetaWidth, height: actualMetaHeight };
  } else if (filenameIntrinsicWidth !== undefined && filenameIntrinsicHeight !== undefined) {
      expectedDim = { width: filenameIntrinsicWidth, height: filenameIntrinsicHeight };
  } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0 && analysis.htmlContent) {
      const fallbackDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
      expectedDim = {width: fallbackDim.width, height: fallbackDim.height};
      issues.push(createIssuePageClient('error', `Could not determine ad dimensions from meta tag or filename. Defaulted to a fallback guess: ${fallbackDim.width}x${fallbackDim.height}. Verify ad.size meta tag and filename conventions.`, undefined, 'meta-size-fallback-guess'));
  } else {
      expectedDim = { width: 300, height: 250 }; 
      if (analysis.htmlContent || (filenameIntrinsicWidth === undefined && filenameIntrinsicHeight === undefined)) {
         issues.push(createIssuePageClient('error', 'Could not determine ad dimensions. Defaulted to 300x250. Ensure ad.size meta tag or filename convention is used.', undefined, 'meta-size-defaulted'));
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
  } else { // No errors or warnings, can be success even with info issues
    status = 'success';
  }


  return {
    status,
    issues,
    adDimensions,
    fileStructureOk,
    detectedClickTags: detectedClickTags.length > 0 ? detectedClickTags : undefined,
    maxFileSize: MAX_FILE_SIZE,
    hasCorrectTopLevelClickTag,
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
            hasCorrectTopLevelClickTag: false,
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
        const errorResult: ValidationResult = {
            id: currentPendingResultId, 
            fileName: file.name,
            status: 'error',
            issues: [createIssuePageClient('error', 'An unexpected error occurred during validation process.', (error as Error).message)],
            fileSize: file.size,
            maxFileSize: MAX_FILE_SIZE,
            fileStructureOk: false, 
            adDimensions: initialPendingResults[index].adDimensions, 
            hasCorrectTopLevelClickTag: false,
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
