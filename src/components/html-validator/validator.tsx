
"use client";

import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { HTMLHint, type LintResult, type RuleSet } from 'htmlhint';
import type { ValidationResult, ValidationIssue, ClickTagInfo, PreviewResult } from '@/types';
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileUploader } from './file-uploader';
import { ValidationResults } from './validation-results';
import { BannerPreview } from './banner-preview';
import { processAndCacheFile } from '@/actions/preview-actions';

const MAX_FILE_SIZE = 200 * 1024; // 200KB
const POSSIBLE_FALLBACK_DIMENSIONS = [
  { width: 300, height: 250 }, { width: 728, height: 90 }, { width: 160, height: 600 },
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
  isCreatopyProject: boolean;
}

const createIssuePageClient = (type: 'error' | 'warning' | 'info', message: string, details?: string, rule?: string): ValidationIssue => ({
  id: `issue-page-client-${Math.random().toString(36).substr(2, 9)}`,
  type,
  message,
  details,
  rule: rule || (type === 'error' ? 'client-error' : (type === 'warning' ? 'client-warning' : 'client-info')),
});

const stripQueryString = (path: string): string => path.split('?')[0];

const resolveAssetPathInZip = (assetPath: string, baseFilePath: string, zip: JSZip): string | null => {
  const cleanedAssetPath = stripQueryString(assetPath);
  if (cleanedAssetPath.startsWith('data:') || cleanedAssetPath.startsWith('http:') || cleanedAssetPath.startsWith('https:') || cleanedAssetPath.startsWith('//')) {
    return cleanedAssetPath;
  }
  let basePathSegments = baseFilePath.includes('/') ? baseFilePath.split('/').slice(0, -1) : [];
  const resolvedPathRelative = [...basePathSegments, ...cleanedAssetPath.split('/')].join('/');
  if (zip.file(resolvedPathRelative)) return resolvedPathRelative;
  if (zip.file(cleanedAssetPath)) return cleanedAssetPath;
  return null;
};

const findHtmlFileInZip = async (zip: JSZip): Promise<{ path: string, content: string } | null> => {
  const allFiles = Object.keys(zip.files);
  const htmlFiles = allFiles.filter(path => path.toLowerCase().endsWith('.html') && !path.startsWith("__MACOSX/") && !zip.files[path].dir);
  if (htmlFiles.length === 0) return null;
  const sorted = htmlFiles.sort((a, b) => (a.split('/').length - b.split('/').length));
  const mainHtmlPath = sorted.find(p => p.toLowerCase().endsWith('index.html')) || sorted[0];
  const htmlFileObject = zip.file(mainHtmlPath);
  if (htmlFileObject) {
    const content = await htmlFileObject.async("string");
    return { path: htmlFileObject.name, content };
  }
  return null;
};

async function lintCssContentViaAPI(cssText: string, filePath: string): Promise<ValidationIssue[]> {
  // Bypassed for now
  return [];
}

const processCssContentAndCollectReferences = async (
  cssContent: string, cssFilePath: string, zip: JSZip,
  missingAssetsCollector: MissingAssetInfo[], referencedAssetPathsCollector: Set<string>,
  cssIssuesCollector: ValidationIssue[], formatIssuesCollector: ValidationIssue[]
): Promise<void> => {
  const urlPattern = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match;
  while ((match = urlPattern.exec(cssContent)) !== null) {
    const assetUrlFromCss = match[2];
    const cleanedAssetUrl = stripQueryString(assetUrlFromCss);
    if (cleanedAssetUrl.startsWith('data:') || cleanedAssetUrl.startsWith('http:') || cleanedAssetUrl.startsWith('https:') || cleanedAssetUrl.startsWith('//')) continue;
    
    const resolvedAssetZipPath = resolveAssetPathInZip(cleanedAssetUrl, cssFilePath, zip);
    const zipFileObject = resolvedAssetZipPath ? zip.file(resolvedAssetZipPath) : null;

    if (zipFileObject) {
      referencedAssetPathsCollector.add(zipFileObject.name);
    } else {
      missingAssetsCollector.push({ type: 'cssRef', path: cleanedAssetUrl, referencedFrom: cssFilePath, originalSrc: match[0] });
    }
  }
};

const parseAnimateManifest = async (
  jsContent: string, jsFilePath: string, htmlFilePath: string, zip: JSZip,
  missingAssetsCollector: MissingAssetInfo[], referencedAssetPathsCollector: Set<string>
): Promise<void> => {
  const manifestRegex = /manifest\s*:\s*(\[[\s\S]*?\])/;
  const manifestMatch = jsContent.match(manifestRegex);
  if (manifestMatch && manifestMatch[1]) {
    const srcRegex = /\bsrc\s*:\s*"([^"]+)"/g;
    let srcMatch;
    while ((srcMatch = srcRegex.exec(manifestMatch[1])) !== null) {
      const originalSrcPath = srcMatch[1];
      const cleanedManifestAssetPath = stripQueryString(originalSrcPath);
      if (cleanedManifestAssetPath.startsWith('data:') || cleanedManifestAssetPath.startsWith('http:') || cleanedManifestAssetPath.startsWith('https:') || cleanedManifestAssetPath.startsWith('//')) continue;

      const resolvedAssetZipPath = resolveAssetPathInZip(cleanedManifestAssetPath, htmlFilePath, zip);
      const zipFileObject = resolvedAssetZipPath ? zip.file(resolvedAssetZipPath) : null;
      if (zipFileObject) {
        referencedAssetPathsCollector.add(zipFileObject.name);
      } else {
        missingAssetsCollector.push({ type: 'jsManifestImg', path: cleanedManifestAssetPath, referencedFrom: jsFilePath, originalSrc: originalSrcPath });
      }
    }
  }
};

const analyzeCreativeAssets = async (file: File): Promise<CreativeAssetAnalysis> => {
  const missingAssets: MissingAssetInfo[] = [];
  const referencedAssetPaths = new Set<string>();
  const cssLintIssues: ValidationIssue[] = [];
  const formatIssues: ValidationIssue[] = [];
  let foundHtmlPath: string | undefined, htmlContentForAnalysis: string | undefined;
  let hasNonCdnExternalScripts = false, isAdobeAnimateProject = false, isCreatopyProject = false;

  const zip = await JSZip.loadAsync(file);
  const allZipFiles = Object.keys(zip.files).filter(path => !zip.files[path].dir && !path.startsWith("__MACOSX/") && !path.endsWith('.DS_Store'));
  const allHtmlFilePathsInZip = allZipFiles.filter(path => path.toLowerCase().endsWith('.html'));
  const htmlFileCount = allHtmlFilePathsInZip.length;
  const htmlFileInfo = await findHtmlFileInZip(zip);

  if (!htmlFileInfo) {
    return { missingAssets, unreferencedFiles: allZipFiles, cssLintIssues, formatIssues, hasNonCdnExternalScripts, htmlFileCount, allHtmlFilePathsInZip, isAdobeAnimateProject, isCreatopyProject };
  }
  
  foundHtmlPath = htmlFileInfo.path;
  referencedAssetPaths.add(foundHtmlPath);
  htmlContentForAnalysis = htmlFileInfo.content;
  const doc = new DOMParser().parseFromString(htmlContentForAnalysis, 'text/html');

  if (htmlContentForAnalysis.includes("window.creatopyEmbed")) {
    isCreatopyProject = true;
    formatIssues.push(createIssuePageClient('info', 'Creatopy project detected.', 'This creative appears to be authored with Creatopy, which can have particularities like unquoted HTML attribute values.', 'authoring-tool-creatopy'));
  }
  if (doc.querySelector('meta[name="authoring-tool"][content="Adobe_Animate_CC"]')) {
    isAdobeAnimateProject = true;
  }
  
  // Simplified asset discovery logic
  const elementsWithSrc = Array.from(doc.querySelectorAll<HTMLElement>('link[href], script[src], img[src], source[src]'));
  let mainAnimateJsContent: string | undefined, mainAnimateJsPath: string | undefined;

  for (const el of elementsWithSrc) {
      const srcAttr = el.getAttribute('href') || el.getAttribute('src');
      if (!srcAttr) continue;
      
      const cleanedSrc = stripQueryString(srcAttr);
      if (cleanedSrc.startsWith('http:') || cleanedSrc.startsWith('https:') || cleanedSrc.startsWith('data:')) {
          // Check for non-CDN external scripts
          if (el.tagName === 'SCRIPT' && !/2mdn\.net|googlesyndication\.com|cloudflare\.com|googleapis\.com/.test(cleanedSrc)) {
              hasNonCdnExternalScripts = true;
          }
          continue;
      }

      const resolvedAssetPath = resolveAssetPathInZip(cleanedSrc, foundHtmlPath, zip);
      const assetFileObject = resolvedAssetPath ? zip.file(resolvedAssetPath) : null;
      
      if (assetFileObject) {
          referencedAssetPaths.add(assetFileObject.name);
          if (isAdobeAnimateProject && assetFileObject.name.toLowerCase().endsWith('.js')) {
              mainAnimateJsContent = await assetFileObject.async('string');
              mainAnimateJsPath = assetFileObject.name;
          }
      } else {
          const typeMap = {'LINK': 'htmlLinkCss', 'SCRIPT': 'htmlScript', 'IMG': 'htmlImg', 'SOURCE': 'htmlSource'};
          missingAssets.push({type: typeMap[el.tagName as keyof typeof typeMap] || 'htmlScript', path: cleanedSrc, referencedFrom: foundHtmlPath, originalSrc: srcAttr});
      }
  }

  if (isAdobeAnimateProject && mainAnimateJsContent && mainAnimateJsPath) {
    await parseAnimateManifest(mainAnimateJsContent, mainAnimateJsPath, foundHtmlPath, zip, missingAssets, referencedAssetPaths);
  }

  // Simplified unreferenced file check
  const unreferencedFiles = allZipFiles.filter(filePath => !referencedAssetPaths.has(filePath));

  return { missingAssets, unreferencedFiles, foundHtmlPath, htmlContent: htmlContentForAnalysis, cssLintIssues, formatIssues, hasNonCdnExternalScripts, htmlFileCount, allHtmlFilePathsInZip, isAdobeAnimateProject, isCreatopyProject };
};

const findClickTagsInHtml = (htmlContent: string | null): ClickTagInfo[] => {
  if (!htmlContent) return [];
  const clickTags: ClickTagInfo[] = [];
  const clickTagRegex = /(?:var|let|const)\s+(?:window\.)?([a-zA-Z0-9_]*clickTag[a-zA-Z0-9_]*)\s*=\s*["'](https?:\/\/[^"']+)["']/g;
  let match;
  while ((match = clickTagRegex.exec(htmlContent)) !== null) {
    clickTags.push({ name: match[1], url: match[2], isHttps: match[2].startsWith('https://') });
  }
  return clickTags;
};

const lintHtmlContent = (htmlString: string, isCreatopyProject?: boolean): ValidationIssue[] => {
  if (!htmlString) return [];
  const ruleset: RuleSet = { 'tag-pair': true, 'attr-value-double-quotes': 'warning' };
  return HTMLHint.verify(htmlString, ruleset).map((msg: LintResult) => {
    let issueType: 'error' | 'warning' | 'info' = msg.type === 'error' ? 'error' : 'warning';
    let detailsText = `Line: ${msg.line}, Col: ${msg.col}, Rule: ${msg.rule.id}`;

    if (msg.rule.id === 'attr-value-double-quotes') {
      if (isCreatopyProject) {
        issueType = 'info';
        detailsText += `. Creatopy often uses unquoted attributes. While HTML5 allows this, double quotes are best practice.`;
      } else {
        issueType = 'warning';
        detailsText += `. Using single quotes or no quotes is not recommended. Double quotes are best practice.`;
      }
    }
    return createIssuePageClient(issueType, msg.message, detailsText, msg.rule.id);
  });
};

const buildValidationResult = async (file: File, analysis: CreativeAssetAnalysis): Promise<Omit<ValidationResult, 'id' | 'fileName' | 'fileSize'>> => {
  const issues: ValidationIssue[] = [];
  let status: ValidationResult['status'] = 'success';
  if (file.size > MAX_FILE_SIZE) issues.push(createIssuePageClient('error', `File size exceeds limit (${(MAX_FILE_SIZE / 1024).toFixed(0)}KB).`));
  if (analysis.htmlFileCount > 1) issues.push(createIssuePageClient('error', 'Multiple HTML files found in ZIP.', `Found: ${analysis.allHtmlFilePathsInZip.join(', ')}.`));
  
  if (analysis.isAdobeAnimateProject && !analysis.isCreatopyProject) {
      issues.push(createIssuePageClient('info', 'Adobe Animate CC project detected.', `Specific checks for Animate structure applied.`, 'authoring-tool-animate-cc'));
  }

  const detectedClickTags = findClickTagsInHtml(analysis.htmlContent || null);
  if (detectedClickTags.length === 0) issues.push(createIssuePageClient('error', 'No clickTags found.'));
  
  analysis.missingAssets.forEach(m => issues.push(createIssuePageClient('warning', `Asset '${m.originalSrc}' in '${m.referencedFrom}' not found.`)));
  analysis.unreferencedFiles.forEach(u => issues.push(createIssuePageClient('warning', `Unreferenced file in ZIP: '${u}'.`)));
  issues.push(...analysis.cssLintIssues, ...analysis.formatIssues);
  if (analysis.htmlContent) issues.push(...lintHtmlContent(analysis.htmlContent, analysis.isCreatopyProject));

  let actualMetaWidth: number | undefined, actualMetaHeight: number | undefined;
  if (analysis.htmlContent) {
    const metaTagMatch = analysis.htmlContent.match(/<meta\s+name=(?:["']?ad\.size["']?)\s+content=(?:["']?width=(\d+)[,;]?\s*height=(\d+)["']?)[^>]*>/i);
    if (metaTagMatch) {
      actualMetaWidth = parseInt(metaTagMatch[1], 10);
      actualMetaHeight = parseInt(metaTagMatch[2], 10);
    } else {
      issues.push(createIssuePageClient('error', 'Required ad.size meta tag not found in HTML.'));
    }
  }

  const adDimensions = { width: actualMetaWidth || 300, height: actualMetaHeight || 250, actual: actualMetaWidth ? { width: actualMetaWidth, height: actualMetaHeight } : undefined };
  const hasErrors = issues.some(i => i.type === 'error');
  const hasWarnings = issues.some(i => i.type === 'warning');
  if (hasErrors) status = 'error'; else if (hasWarnings) status = 'warning';

  return { status, issues, adDimensions, fileStructureOk: !!analysis.foundHtmlPath, detectedClickTags: detectedClickTags.length > 0 ? detectedClickTags : undefined, maxFileSize: MAX_FILE_SIZE, hasCorrectTopLevelClickTag: detectedClickTags.some(t => t.name === "clickTag" && t.isHttps) };
};

export function Validator() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('validator');

  const handleFileSelectAndValidate = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      setSelectedFiles([file]);
      await handleValidate([file]);
    }
  };

  const handleValidate = async (filesToProcess: File[]) => {
    if (filesToProcess.length === 0) {
      toast({ title: "No file selected", description: "Please select a ZIP file.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    setValidationResults([]);
    setPreviewResult(null);
    setActiveTab('validator');

    const file = filesToProcess[0];
    const formData = new FormData();
    formData.append('file', file);
    
    // Fork validation and preview processing
    const validationPromise = (async () => {
        const analysis = await analyzeCreativeAssets(file);
        const result = await buildValidationResult(file, analysis);
        return { id: `${file.name}-${Date.now()}`, fileName: file.name, fileSize: file.size, ...result };
    })();

    const previewPromise = processAndCacheFile(formData);

    const [validationOutcome, previewOutcome] = await Promise.allSettled([validationPromise, previewPromise]);

    if (validationOutcome.status === 'fulfilled') {
        setValidationResults([validationOutcome.value]);
    } else {
        console.error("Validation failed:", validationOutcome.reason);
        toast({ title: "Validation Error", description: "An unexpected error occurred during validation.", variant: "destructive" });
    }

    if (previewOutcome.status === 'fulfilled') {
        if ('error' in previewOutcome.value) {
            toast({ title: "Preview Error", description: previewOutcome.value.error, variant: "destructive" });
            setPreviewResult(null);
        } else {
            setPreviewResult({
                id: previewOutcome.value.previewId,
                fileName: file.name,
                entryPoint: previewOutcome.value.entryPoint,
                securityWarning: previewOutcome.value.securityWarning
            });
            // Switch to preview tab if successful
            if (!('error' in previewOutcome.value)) {
                setActiveTab('preview');
            }
        }
    } else {
        console.error("Preview processing failed:", previewOutcome.reason);
        toast({ title: "Preview Error", description: "Could not process file for preview.", variant: "destructive" });
    }

    setIsLoading(false);
    toast({ title: "Analysis Complete", description: "Check the tabs for results." });
  };
  
  useEffect(() => {
    if (selectedFiles.length === 0) {
        setValidationResults([]);
        setPreviewResult(null);
    }
  }, [selectedFiles]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <div className="flex justify-between items-center">
        <TabsList>
          <TabsTrigger value="validator">Validator Report</TabsTrigger>
          <TabsTrigger value="preview" disabled={!previewResult}>Live Preview</TabsTrigger>
        </TabsList>
      </div>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
        <div className="md:col-span-1">
          <FileUploader
            selectedFiles={selectedFiles}
            setSelectedFiles={setSelectedFiles}
            onValidate={() => handleValidate(selectedFiles)}
            isLoading={isLoading}
            validationResults={validationResults}
            previewResult={previewResult}
          />
        </div>
        <div className="md:col-span-2">
            <TabsContent value="validator">
                <ValidationResults results={validationResults} isLoading={isLoading} />
            </TabsContent>
            <TabsContent value="preview">
                {previewResult && <BannerPreview result={previewResult} />}
            </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
