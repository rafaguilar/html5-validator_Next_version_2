
"use client";

import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import { HTMLHint, type LintResult, type RuleSet } from 'htmlhint';
import type { ValidationResult, ValidationIssue, ClickTagInfo, PreviewResult } from '@/types';
import { useToast } from "@/hooks/use-toast";
import { ValidationResults } from './validation-results';
import { FileUploader } from './file-uploader';
import { processAndCacheFile } from '@/actions/preview-actions';

const MAX_FILE_SIZE = 200 * 1024; // 200KB

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

const lintHtmlContent = (htmlString: string, isCreatopyProject?: boolean): ValidationIssue[] => {
  if (!htmlString) return [];
  const issues: ValidationIssue[] = [];

  // 1. Custom check for missing space between attributes
  const lines = htmlString.split(/\r?\n/);
  const missingSpaceRegex = /"(\s*class|id|src|href|alt|style|onclick|onmouseover|onmouseout)=/i;

  lines.forEach((line, index) => {
    // Regex to find an attribute starting with a letter, immediately after a closing quote.
    // e.g., id="some-id"class="another-class"
    const missingSpaceRegex = /"([a-zA-Z]+=)/g;
    if (missingSpaceRegex.test(line.trim())) {
      issues.push(createIssuePageClient(
        'error',
        'Missing space between HTML attributes.',
        `Syntax error found on Line ${index + 1}. A space is required between attributes. Problematic line: \n\`${line.trim()}\`\n\nSuggestion: Add a space before the attribute that follows the closing double quote.`,
        'attr-missing-space'
      ));
    }
  });

  // 2. Standard HTMLHint checks
  const ruleset: RuleSet = { 
    'tag-pair': true, 
    'attr-value-double-quotes': true,
    'spec-char-escape': true,
  };

  HTMLHint.verify(htmlString, ruleset).forEach((msg: LintResult) => {
    let issueType: 'error' | 'warning' | 'info' = msg.type === 'error' ? 'error' : 'warning';
    let detailsText = `Line: ${msg.line}, Col: ${msg.col}, Rule: ${msg.rule.id}`;

    if (msg.rule.id === 'attr-value-double-quotes') {
      if (isCreatopyProject) {
        issueType = 'info';
        detailsText = `Line: ${msg.line}, Col: ${msg.col}. Creatopy often uses unquoted attributes. While HTML5 allows this for some attributes, double quotes are best practice for consistency and to avoid parsing issues.`;
      } else {
        issueType = 'warning';
        detailsText += `. Using single quotes or no quotes is not recommended. Double quotes are the standard and prevent parsing errors.`;
      }
    }
    issues.push(createIssuePageClient(issueType, msg.message, detailsText, msg.rule.id));
  });

  return issues;
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

interface CreativeAssetAnalysis {
  foundHtmlPath?: string;
  htmlContent?: string;
  formatIssues: ValidationIssue[];
  htmlFileCount: number;
  allHtmlFilePathsInZip: string[];
  isAdobeAnimateProject: boolean;
  isCreatopyProject: boolean;
}

const analyzeCreativeAssets = async (file: File): Promise<CreativeAssetAnalysis> => {
  const formatIssues: ValidationIssue[] = [];
  let foundHtmlPath: string | undefined, htmlContentForAnalysis: string | undefined;
  let isAdobeAnimateProject = false, isCreatopyProject = false;

  const zip = await JSZip.loadAsync(file);
  const allZipFiles = Object.keys(zip.files).filter(path => !zip.files[path].dir && !path.startsWith("__MACOSX/") && !path.endsWith('.DS_Store'));
  const allHtmlFilePathsInZip = allZipFiles.filter(path => path.toLowerCase().endsWith('.html'));
  const htmlFileCount = allHtmlFilePathsInZip.length;
  const htmlFileInfo = await findHtmlFileInZip(zip);

  if (!htmlFileInfo) {
    return { formatIssues, htmlFileCount, allHtmlFilePathsInZip, isAdobeAnimateProject, isCreatopyProject };
  }
  
  foundHtmlPath = htmlFileInfo.path;
  htmlContentForAnalysis = htmlFileInfo.content;
  
  if (htmlContentForAnalysis.includes("window.creatopyEmbed")) {
    isCreatopyProject = true;
    formatIssues.push(createIssuePageClient('info', 'Creatopy project detected.', 'This creative appears to be authored with Creatopy. Specific checks for unquoted HTML attribute values have been adjusted.', 'authoring-tool-creatopy'));
  }
  
  const doc = new DOMParser().parseFromString(htmlContentForAnalysis, 'text/html');
  if (doc.querySelector('meta[name="authoring-tool"][content="Adobe_Animate_CC"]')) {
    isAdobeAnimateProject = true;
  }
  
  return { foundHtmlPath, htmlContent: htmlContentForAnalysis, formatIssues, htmlFileCount, allHtmlFilePathsInZip, isAdobeAnimateProject, isCreatopyProject };
};

const buildValidationResult = async (file: File, analysis: CreativeAssetAnalysis): Promise<Omit<ValidationResult, 'id' | 'fileName' | 'fileSize'>> => {
  const issues: ValidationIssue[] = [];
  let status: ValidationResult['status'] = 'success';
  if (file.size > MAX_FILE_SIZE) issues.push(createIssuePageClient('error', `File size exceeds limit (${(MAX_FILE_SIZE / 1024).toFixed(0)}KB).`));
  if (analysis.htmlFileCount > 1) issues.push(createIssuePageClient('warning', 'Multiple HTML files found in ZIP.', `Found: ${analysis.allHtmlFilePathsInZip.join(', ')}. The validator will analyze the most likely primary file: ${analysis.foundHtmlPath}`));
  
  if (analysis.isAdobeAnimateProject && !analysis.isCreatopyProject) {
      issues.push(createIssuePageClient('info', 'Adobe Animate CC project detected.', `Specific checks for Animate structure applied.`, 'authoring-tool-animate-cc'));
  }
  issues.push(...analysis.formatIssues);

  const detectedClickTags = findClickTagsInHtml(analysis.htmlContent || null);
  if (detectedClickTags.length === 0 && analysis.htmlContent) issues.push(createIssuePageClient('warning', 'No standard clickTag variable found in the HTML file.', 'A clickTag is required for ad tracking. Example: var clickTag = "https://www.example.com";'));
  
  if (analysis.htmlContent) issues.push(...lintHtmlContent(analysis.htmlContent, analysis.isCreatopyProject));

  let actualMetaWidth: number | undefined, actualMetaHeight: number | undefined;
  if (analysis.htmlContent) {
    const metaTagMatch = analysis.htmlContent.match(/<meta\s+name=["']?ad\.size["']?\s+content=["']?width=(\d+)[,;]?\s*height=(\d+)["']?/i);
    if (metaTagMatch) {
      actualMetaWidth = parseInt(metaTagMatch[1], 10);
      actualMetaHeight = parseInt(metaTagMatch[2], 10);
    } else {
      issues.push(createIssuePageClient('error', 'Required ad.size meta tag not found.', 'The HTML file must contain a meta tag like: <meta name="ad.size" content="width=300,height=250">'));
    }
  }

  const adDimensions = { width: actualMetaWidth || 300, height: actualMetaHeight || 250, actual: actualMetaWidth ? { width: actualMetaWidth, height: actualMetaHeight } : undefined };
  const hasErrors = issues.some(i => i.type === 'error');
  const hasWarnings = issues.some(i => i.type === 'warning');
  if (hasErrors) status = 'error'; else if (hasWarnings) status = 'warning';

  return { status, issues, adDimensions, fileStructureOk: !!analysis.foundHtmlPath, detectedClickTags: detectedClickTags.length > 0 ? detectedClickTags : undefined, maxFileSize: MAX_FILE_SIZE, hasCorrectTopLevelClickTag: detectedClickTags.some(t => t.name === "clickTag" && t.isHttps), preview: null };
};

export function Validator() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleValidate = async () => {
    if (selectedFiles.length === 0) {
      toast({ title: "No file selected", description: "Please select one or more ZIP files.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    setValidationResults([]);
    
    const resultsPromises = selectedFiles.map(async (file) => {
      try {
        const formData = new FormData();
        formData.append('file', file);
        const [analysis, previewOutcome] = await Promise.all([
          analyzeCreativeAssets(file),
          processAndCacheFile(formData)
        ]);
        
        const validationPart = await buildValidationResult(file, analysis);
        
        let previewResult: PreviewResult | null = null;
        if (previewOutcome && !('error' in previewOutcome)) {
            previewResult = {
                id: previewOutcome.previewId,
                fileName: file.name,
                entryPoint: previewOutcome.entryPoint,
                securityWarning: previewOutcome.securityWarning
            };
        } else if (previewOutcome && 'error' in previewOutcome) {
            toast({ title: `Preview Error for ${file.name}`, description: previewOutcome.error, variant: "destructive" });
        }

        return { 
            id: `${file.name}-${Date.now()}`, 
            fileName: file.name, 
            fileSize: file.size, 
            ...validationPart,
            preview: previewResult
        };
      } catch (error) {
        console.error(`Validation failed for ${file.name}:`, error);
        toast({ title: `Validation Error for ${file.name}`, description: "An unexpected error occurred during processing.", variant: "destructive" });
        return {
          id: `${file.name}-${Date.now()}`,
          fileName: file.name,
          fileSize: file.size,
          status: 'error' as 'error',
          issues: [createIssuePageClient('error', 'File processing failed', 'An unexpected error occurred.')],
          preview: null
        }
      }
    });

    const settledResults = await Promise.allSettled(resultsPromises);
    
    const finalResults = settledResults.map(res => {
        if (res.status === 'fulfilled') {
            return res.value;
        } else {
            console.error("A validation promise was rejected:", res.reason);
            // We return a placeholder error object. The specific file name is lost here,
            // so we rely on the toast message fired from the catch block above.
            return null;
        }
    }).filter((r): r is ValidationResult => r !== null);


    setValidationResults(finalResults);
    setIsLoading(false);
    if (finalResults.length > 0) {
      toast({ title: "Analysis Complete", description: `Processed ${finalResults.length} file(s). Check the report below.` });
    }
  };
  
  useEffect(() => {
    if (selectedFiles.length === 0) {
        setValidationResults([]);
    }
  }, [selectedFiles]);

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
        <div className="md:col-span-1">
          <FileUploader
            selectedFiles={selectedFiles}
            setSelectedFiles={setSelectedFiles}
            onValidate={handleValidate}
            isLoading={isLoading}
            validationResults={validationResults}
          />
        </div>
        <div className="md:col-span-2">
            <ValidationResults results={validationResults} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
}
