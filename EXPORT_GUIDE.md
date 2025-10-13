
# HTML Validator Export Guide

To replicate the HTML Validator functionality in a new Next.js application, create the following files with the specified content.

---
## 1. Core Validation & UI Components
---

### **`src/lib/client-validator.ts`**
```typescript
import JSZip from 'jszip';
import { HTMLHint, type LintResult, type RuleSet } from 'htmlhint';
import type { ValidationResult, ValidationIssue, ClickTagInfo } from '@/types';

// New tiered file size limits
const SIZE_LIMIT_ERROR = 300 * 1024; // 300KB
const SIZE_LIMIT_WARNING_HIGH = 200 * 1024; // 200KB
const SIZE_LIMIT_WARNING_LOW = 150 * 1024; // 150KB

const createIssue = (type: 'error' | 'warning' | 'info', message: string, details?: string, rule?: string): ValidationIssue => ({
  id: `issue-client-${Math.random().toString(36).substr(2, 9)}`,
  type,
  message,
  details,
  rule: rule || (type === 'error' ? 'client-error' : (type === 'warning' ? 'client-warning' : 'client-info')),
});

const findHtmlFileInZip = async (zip: JSZip): Promise<{ path: string, content: string } | null> => {
  const allFiles = Object.keys(zip.files);
  const htmlFiles = allFiles.filter(path => path.toLowerCase().endsWith('.html') && !path.startsWith("__MACOSX/") && !zip.files[path].dir);
  if (htmlFiles.length === 0) {
    return null;
  }
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
  
  const lines = htmlString.split(/\r?\n/);
  const missingSpaceRegex = /<[^>]+?"class=/g;
  lines.forEach((line, index) => {
    let match;
    missingSpaceRegex.lastIndex = 0;
    while ((match = missingSpaceRegex.exec(line)) !== null) {
      const tagMatch = line.match(/<[^]*"class=[^>]*>/);
      const details = tagMatch
        ? `A space is required between attributes. Problem found in tag: \`${tagMatch[0]}\` on Line ${index + 1}.`
        : `A space is required before the 'class' attribute on Line ${index + 1}.`;
      issues.push(createIssue('error', 'Missing space before class attribute.', details, 'attr-missing-space-before-class'));
    }
  });

  const ruleset: RuleSet = {
    'tag-pair': true,
    'attr-value-double-quotes': true,
    'spec-char-escape': true,
  };

  const lintResults = HTMLHint.verify(htmlString, ruleset);
  lintResults.forEach((msg: LintResult) => {
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
    issues.push(createIssue(issueType, msg.message, detailsText, msg.rule.id));
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
  issues: ValidationIssue[];
  htmlFileCount: number;
  allHtmlFilePathsInZip: string[];
  isAdobeAnimateProject: boolean;
  isCreatopyProject: boolean;
  zip: JSZip;
}

const analyzeCreativeAssets = async (file: File): Promise<CreativeAssetAnalysis> => {
    const issues: ValidationIssue[] = [];
    let foundHtmlPath: string | undefined, htmlContentForAnalysis: string | undefined;
    let isAdobeAnimateProject = false, isCreatopyProject = false;

    const allowedTextExtensions = ['.html', '.css', '.js', '.json', '.txt', '.svg', '.xml'];
    const allowedImageExtensions = ['.gif', '.jpg', '.jpeg', '.png'];
    const allowedFontExtensions = ['.eot', '.otf', '.ttf', '.woff', '.woff2'];
    const allAllowedExtensions = [...allowedTextExtensions, ...allowedImageExtensions, ...allowedFontExtensions];

    const zip = await JSZip.loadAsync(file);
    const allZipFiles = Object.keys(zip.files).filter(path => !zip.files[path].dir && !path.startsWith("__MACOSX/") && !path.endsWith('.DS_Store'));

    allZipFiles.forEach(path => {
        const fileExt = (/\.([^.]+)$/.exec(path) || [''])[0].toLowerCase();
        if (!allAllowedExtensions.includes(fileExt)) {
            const message = `Unsupported file type in ZIP: '${fileExt}'`;
            const details = `File: '${path}'. This file type is not standard and may not work in all ad platforms. Only the following are supported: ${allAllowedExtensions.join(', ')}.`;
            issues.push(createIssue('warning', message, details, 'unsupported-file-type'));
        }
    });

    const allHtmlFilePathsInZip = allZipFiles.filter(path => path.toLowerCase().endsWith('.html'));
    const htmlFileCount = allHtmlFilePathsInZip.length;
    const htmlFileInfo = await findHtmlFileInZip(zip);

    if (htmlFileInfo) {
        foundHtmlPath = htmlFileInfo.path;
        htmlContentForAnalysis = htmlFileInfo.content;
    }
  
    if (htmlContentForAnalysis) {
      if (htmlContentForAnalysis.includes("window.creatopyEmbed")) {
        isCreatopyProject = true;
        issues.push(createIssue('info', 'Creatopy project detected.', 'Specific checks for unquoted HTML attribute values have been adjusted.', 'authoring-tool-creatopy'));
      }
  
      const doc = new DOMParser().parseFromString(htmlContentForAnalysis, 'text/html');
      if (doc.querySelector('meta[name="authoring-tool"][content="Adobe_Animate_CC"]')) {
        isAdobeAnimateProject = true;
      }
    }
  
    return { foundHtmlPath, htmlContent: htmlContentForAnalysis, issues, htmlFileCount, allHtmlFilePathsInZip, isAdobeAnimateProject, isCreatopyProject, zip };
};

export const runClientSideValidation = async (file: File): Promise<Omit<ValidationResult, 'id' | 'fileName' | 'fileSize' | 'preview'>> => {
    const analysis = await analyzeCreativeAssets(file);
    const issues: ValidationIssue[] = [...analysis.issues];

    // Updated file size validation logic
    if (file.size > SIZE_LIMIT_ERROR) {
      const message = `File size exceeds 300KB. This is not allowed.`;
      const details = `Actual size: ${(file.size / 1024).toFixed(2)}KB. You must reduce the file size to be under 300KB.`;
      issues.push(createIssue('error', message, details, 'file-size-error'));
    } else if (file.size > SIZE_LIMIT_WARNING_HIGH) {
      const message = `File size is large (201KB - 300KB).`;
      const details = `Actual size: ${(file.size / 1024).toFixed(2)}KB. While acceptable, this may impact loading performance. Consider optimizing assets.`;
      issues.push(createIssue('warning', message, details, 'file-size-warning-high'));
    } else if (file.size > SIZE_LIMIT_WARNING_LOW) {
      const message = `File size is approaching the limit (150KB - 200KB).`;
      const details = `Actual size: ${(file.size / 1024).toFixed(2)}KB. Consider optimizing assets to stay well under the limit.`;
      issues.push(createIssue('warning', message, details, 'file-size-warning-low'));
    }

    if (analysis.htmlFileCount === 0) {
        const message = 'No HTML file found in ZIP.';
        const details = 'An HTML file is required to serve as the entry point for the creative.';
        issues.push(createIssue('error', message, details, 'no-html-file'));
    } else if (analysis.htmlFileCount > 1) {
        const message = 'Multiple HTML files found in ZIP.';
        const details = `Found: ${analysis.allHtmlFilePathsInZip.join(', ')}. The validator will analyze the most likely primary file: ${analysis.foundHtmlPath}`;
        issues.push(createIssue('warning', message, details, 'multiple-html-files'));
    }

    if (analysis.isAdobeAnimateProject && !analysis.isCreatopyProject) {
        issues.push(createIssue('info', 'Adobe Animate CC project detected.', `Specific checks for Animate structure applied.`, 'authoring-tool-animate-cc'));
    }

    const detectedClickTags = findClickTagsInHtml(analysis.htmlContent || null);
    if (detectedClickTags.length === 0 && analysis.htmlContent) {
        issues.push(createIssue('warning', 'No standard clickTag variable found.', 'A clickTag is required for ad tracking. Example: var clickTag = "https://www.example.com";', 'missing-clicktag'));
    }

    if (analysis.htmlContent) {
        issues.push(...lintHtmlContent(analysis.htmlContent, analysis.isCreatopyProject));
    }

    let actualMetaWidth: number | undefined, actualMetaHeight: number | undefined;
    if (analysis.htmlContent) {
        const metaTagMatch = analysis.htmlContent.match(/<meta\s+name=["']?ad\.size["']?\s+content=["']?width=(\d+)[,;]?\s*height=(\d+)["']?/i);
        if (metaTagMatch) {
            actualMetaWidth = parseInt(metaTagMatch[1], 10);
            actualMetaHeight = parseInt(metaTagMatch[2], 10);
        } else {
            const severity = analysis.isAdobeAnimateProject ? 'warning' : 'error';
            const details = analysis.isAdobeAnimateProject 
              ? 'Adobe Animate units often rely on canvas dimensions. While not a critical error, including this tag is best practice for platform compatibility.'
              : 'The HTML file must contain a meta tag like: <meta name="ad.size" content="width=300,height=250">';
            issues.push(createIssue(severity, 'Required ad.size meta tag not found.', details, 'missing-meta-size'));
        }
    }

    if (analysis.isAdobeAnimateProject && analysis.htmlContent) {
        const doc = new DOMParser().parseFromString(analysis.htmlContent, 'text/html');
        const canvas = doc.querySelector('canvas');
        if (canvas && canvas.width && canvas.height) {
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;

            const jsFiles = Object.values(analysis.zip.files).filter(f => f.name.toLowerCase().endsWith('.js') && !f.dir);
            let propertiesFound = false;

            for (const jsFile of jsFiles) {
                const jsContent = await jsFile.async('string');
                const propsMatch = jsContent.match(/lib\.properties\s*=\s*{\s*[^}]*width:\s*(\d+)\s*,\s*height:\s*(\d+)/);
                if (propsMatch) {
                    propertiesFound = true;
                    const jsWidth = parseInt(propsMatch[1], 10);
                    const jsHeight = parseInt(propsMatch[2], 10);
                    if (canvasWidth !== jsWidth || canvasHeight !== jsHeight) {
                        const message = 'Canvas and JS dimensions do not match.';
                        const details = `The HTML canvas is ${canvasWidth}x${canvasHeight}px, but the lib.properties in '${jsFile.name}' is set to ${jsWidth}x${jsHeight}px. These must be consistent.`;
                        issues.push(createIssue('warning', message, details, 'animate-dimension-mismatch'));
                    }
                    break; 
                }
            }
            if (!propertiesFound) {
                 issues.push(createIssue('info', 'Could not find lib.properties in JS files.', `Could not verify canvas dimensions against a JavaScript properties object for this Animate creative.`, 'animate-props-not-found'));
            }
        } else {
            issues.push(createIssue('warning', 'Canvas element not found or missing dimensions.', `Could not find a <canvas> element with width and height attributes in the HTML file for dimension validation.`, 'animate-canvas-not-found'));
        }
    }

    const adDimensions = { width: actualMetaWidth || 300, height: actualMetaHeight || 250, actual: actualMetaWidth ? { width: actualMetaWidth, height: actualMetaHeight } : undefined };
    const hasErrors = issues.some(i => i.type === 'error');
    const hasWarnings = issues.some(i => i.type === 'warning');
    let status: ValidationResult['status'] = 'success';
    if (hasErrors) {
        status = 'error';
    } else if (hasWarnings) {
        status = 'warning';
    }

    return {
        status,
        issues,
        adDimensions,
        fileStructureOk: !!analysis.foundHtmlPath,
        htmlEntryPoint: analysis.foundHtmlPath,
        htmlContent: analysis.htmlContent,
        detectedClickTags: detectedClickTags.length > 0 ? detectedClickTags : undefined,
        maxFileSize: SIZE_LIMIT_ERROR, // The max size is now 300KB
        hasCorrectTopLevelClickTag: detectedClickTags.some(t => t.name === "clickTag" && t.isHttps)
    };
};
```

---
### **`src/components/html-validator/validator.tsx`**
```typescript
"use client";

import React, { useState, useEffect } from 'react';
import type { ValidationResult, PreviewResult } from '@/types';
import { useToast } from "@/hooks/use-toast";
import { ValidationResults } from './validation-results';
import { FileUploader } from './file-uploader';
import { runClientSideValidation } from '@/lib/client-validator';

export function Validator() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // This effect will run once when the component mounts.
    console.log("[TRACE] Validator.tsx: Component mounted. Adding comprehensive tracing.");
  }, []);


  const handleValidate = async () => {
    console.log("[TRACE] Validator.tsx: handleValidate triggered.");
    if (selectedFiles.length === 0) {
      toast({ title: "No file selected", description: "Please select one or more ZIP files.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    const pendingResults = selectedFiles.map(file => ({
      id: `${file.name}-${file.lastModified}`,
      fileName: file.name,
      status: 'pending' as const,
      issues: [],
      preview: null
    }));
    setValidationResults(pendingResults);
    console.log(`[TRACE] Validator.tsx: Set ${pendingResults.length} files to 'pending' state.`);

    const allResults: ValidationResult[] = [];

    for (const file of selectedFiles) {
      let previewResult: PreviewResult | null = null;
      let finalResult: ValidationResult | null = null;
      try {
        console.log(`[TRACE] Validator.tsx: Starting client-side validation for ${file.name}.`);
        const validationPart = await runClientSideValidation(file);
        console.log(`[TRACE] Validator.tsx: Finished client-side validation for ${file.name}. Issues found: ${validationPart.issues.length}`);
        
        const formData = new FormData();
        formData.append('file', file);
        
        console.log(`[TRACE] Validator.tsx: Starting server-side processing via fetch for ${file.name}.`);
        const response = await fetch('/api/process-file', {
          method: 'POST',
          body: formData,
        });
        console.log(`[TRACE] Validator.tsx: Received response from server for ${file.name}. Status: ${response.status}`);

        const serverOutcome = await response.json();

        if (!response.ok) {
            console.error(`[TRACE] Validator.tsx: Server returned an error for ${file.name}.`, serverOutcome.error);
            throw new Error(serverOutcome.error || 'Unknown error from process-file API');
        }

        // The preview functionality depends on serverOutcome.previewId and serverOutcome.entryPoint
        // It's no longer returning processedHtml directly
        if (serverOutcome.previewId && serverOutcome.entryPoint) {
            // Construct the src for the iframe
            const previewSrc = `/api/preview/${serverOutcome.previewId}/${serverOutcome.entryPoint}`;

            // We need to fetch the HTML content to create the srcDoc,
            // because iframe's src attribute pointing to our API route will be sandboxed
            // and might have issues with relative paths for other assets.
            // A better way is to rebuild the HTML with correct paths.
            // For now, let's create processedHtml on the client from the original file content.
            const tempIframeSrc = `/api/preview/${serverOutcome.previewId}/${serverOutcome.entryPoint}`;
            
            // To properly sandbox and handle relative paths, we'll create the srcDoc on the client
            // using the HTML content we already have from `runClientSideValidation`.
            let processedHtml = validationPart.htmlContent || '';
            if (processedHtml) {
                const headWithBase = `<head><base href="/api/preview/${serverOutcome.previewId}/" />`;
                processedHtml = processedHtml.replace(/<head>/i, headWithBase);
            }
          
            previewResult = {
                id: serverOutcome.previewId,
                fileName: file.name,
                entryPoint: serverOutcome.entryPoint,
                processedHtml: processedHtml,
                securityWarning: serverOutcome.securityWarning || null,
            };
            console.log(`[TRACE] Validator.tsx: Successfully created previewResult object for ${file.name}`);
        } else if (serverOutcome.error) {
           console.warn(`[TRACE] Validator.tsx: Preview generation failed for ${file.name}.`, serverOutcome.error);
           toast({ title: `Preview Error for ${file.name}`, description: serverOutcome.error, variant: "destructive" });
        }

        finalResult = {
          id: `${file.name}-${file.lastModified}`,
          fileName: file.name,
          fileSize: file.size,
          ...validationPart,
          preview: previewResult,
        };
        console.log(`[TRACE] Validator.tsx: Combined client and server results for ${file.name}.`);
        
        allResults.push(finalResult);

      } catch (error) {
        console.error(`[TRACE] Validator.tsx: CRITICAL error processing file ${file.name}.`, error);
        toast({ title: `Validation Error for ${file.name}`, description: error instanceof Error ? error.message : "An unexpected error occurred during processing.", variant: "destructive" });
        
        const errorResult = {
          id: `${file.name}-${file.lastModified}`,
          fileName: file.name,
          fileSize: file.size,
          status: 'error' as const,
          issues: [{
            id: `api-critical-${Date.now()}`,
            type: 'error' as const,
            message: 'File processing failed via API.',
            details: error instanceof Error ? error.message : String(error)
          }],
          preview: null
        };
        // If client-side validation ran, merge its results
        const existingValidationPart = finalResult ? (({ status, issues, ...rest }) => rest)(finalResult) : {};
        allResults.push({ ...errorResult, ...existingValidationPart });
      }
    }
    
    console.log(`[TRACE] Validator.tsx: All files processed. Updating final state with ${allResults.length} results.`);
    setValidationResults(allResults);
    setIsLoading(false);
    
    if (allResults.length > 0) {
      toast({ title: "Analysis Complete", description: `Processed ${allResults.length} file(s). Check the report below.` });
    }
  };

  useEffect(() => {
    if (!selectedFiles || selectedFiles.length === 0) {
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
```

---
### **`src/components/html-validator/file-uploader.tsx`**
```typescript
"use client";

import type { ChangeEvent, DragEvent } from 'react';
import React, { useState, useRef }from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UploadCloud, Archive, XCircle, Loader2, FileCheck2 } from 'lucide-react';
import type { ValidationResult } from '@/types';

interface FileUploaderProps {
  selectedFiles: File[];
  setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>;
  onValidate: () => void;
  isLoading: boolean;
  validationResults?: ValidationResult[];
}

export function FileUploader({ 
  selectedFiles, 
  setSelectedFiles, 
  onValidate, 
  isLoading,
  validationResults = [],
}: FileUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const newFiles = Array.from(event.target.files).filter(file => file.type === 'application/zip' || file.type === 'application/x-zip-compressed');
      setSelectedFiles(prevFiles => {
        const existingFileNames = new Set(prevFiles.map(f => f.name));
        const uniqueNewFiles = newFiles.filter(nf => !existingFileNames.has(nf.name));
        return [...prevFiles, ...uniqueNewFiles];
      });
    }
  };

  const handleRemoveFile = (fileName: string) => {
    setSelectedFiles(prevFiles => prevFiles.filter(file => file.name !== fileName));
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const newFiles = Array.from(e.dataTransfer.files).filter(file => file.type === 'application/zip' || file.type === 'application/x-zip-compressed');
      setSelectedFiles(prevFiles => {
        const existingFileNames = new Set(prevFiles.map(f => f.name));
        const uniqueNewFiles = newFiles.filter(nf => !existingFileNames.has(nf.name));
        return [...prevFiles, ...uniqueNewFiles];
      });
      e.dataTransfer.clearData();
    }
  };

  const isAnalysisComplete = !isLoading && (validationResults || []).length > 0;
  const buttonText = selectedFiles.length > 1 ? 'Validate Files' : 'Validate & Preview';

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl">Upload Creative Assets</CardTitle>
        <CardDescription>Upload one or more ZIP files to validate and preview.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div
          className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg transition-colors cursor-pointer
            ${isDragging ? 'border-primary bg-primary/10' : 'border-input hover:border-primary/70'}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadCloud className={`w-16 h-16 mb-4 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
          <p className={`text-lg font-medium ${isDragging ? 'text-primary' : 'text-foreground'}`}>
            Drag & Drop ZIP files here
          </p>
          <p className="text-sm text-muted-foreground">or click to browse</p>
          <Input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            multiple={true}
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {selectedFiles.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-md font-medium text-foreground">Selected Files ({selectedFiles.length}):</h3>
            <ScrollArea className="h-24 w-full rounded-md border p-3 bg-secondary/30">
              <ul className="space-y-2">
                {selectedFiles.map(file => (
                  <li
                    key={`${file.name}-${file.lastModified}`}
                    className="flex items-center p-2 bg-card rounded-md shadow-sm"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 mr-2 text-muted-foreground hover:text-destructive flex-shrink-0"
                      onClick={() => handleRemoveFile(file.name)}
                      aria-label={`Remove ${file.name}`}
                    >
                      <XCircle className="w-4 h-4" />
                    </Button>
                    <div className="flex items-center space-x-2 overflow-hidden">
                      <Archive className="w-5 h-5 text-primary flex-shrink-0" />
                      <span className="text-sm text-foreground truncate" title={file.name}>{file.name}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        )}

        <Button
          onClick={onValidate}
          disabled={selectedFiles.length === 0 || isLoading}
          className="w-full text-base py-3"
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Analyzing...
            </>
          ) : (
             isAnalysisComplete ? (
              <>
                <FileCheck2 className="mr-2 h-5 w-5" />
                Analysis Complete
              </>
            ) : (
               buttonText
            )
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
```

---
### **`src/components/html-validator/validation-results.tsx`**
```typescript
"use client";

import type { ReactNode } from 'react';
import React, from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import type { ValidationResult, ValidationIssue } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, AlertTriangle, FileText, Image as ImageIconLucide, Archive, LinkIcon, Download, Loader2, Info, MonitorPlay, Code2, Share2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { BannerPreview } from './banner-preview';
import { useToast } from '@/hooks/use-toast';
import { saveReport } from '@/services/report-service';


interface ValidationResultsProps {
  results?: ValidationResult[];
  isLoading: boolean;
}

const StatusIcon = ({ status }: { status: ValidationResult['status'] }) => {
  const commonClass = "w-5 h-5";
  switch (status) {
    case 'success':
      return <CheckCircle2 className={commonClass} />;
    case 'error':
      return <XCircle className={commonClass} />;
    case 'warning':
      return <AlertTriangle className={commonClass} />;
    default:
      return <Loader2 className={`${commonClass} animate-spin`} />; 
  }
};

const IssueIcon = ({ type }: { type: ValidationIssue['type'] }) => {
  switch (type) {
    case 'error':
      return <XCircle className="w-4 h-4 text-destructive mr-2 flex-shrink-0" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-accent mr-2 flex-shrink-0" />;
    case 'info':
      return <Info className="w-4 h-4 text-primary mr-2 flex-shrink-0" />;
    default:
      return <Info className="w-4 h-4 text-muted-foreground mr-2 flex-shrink-0" />;
  }
};

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const SourceCodeViewer = ({ source }: { source: string }) => {
  const lines = source.split('\n');
  return (
    <ScrollArea className="h-[60vh] w-full font-mono text-xs border rounded-md">
        <div className="p-4">
            <div className="flex">
                <div className="text-right text-muted-foreground pr-4 select-none">
                    {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
                </div>
                <pre className="whitespace-pre-wrap break-words">{source}</pre>
            </div>
        </div>
    </ScrollArea>
  );
};


export function ValidationResults({ results = [], isLoading }: ValidationResultsProps) {
  const reportRef = React.useRef<HTMLDivElement>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = React.useState(false);
  const [isSharing, setIsSharing] = React.useState(false);
  const { toast } = useToast();

  const handleDownloadPdf = async () => {
    const container = reportRef.current;
    if (!container || results.length === 0) return;
  
    setIsGeneratingPdf(true);
  
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pdfPageWidth = pdf.internal.pageSize.getWidth();
    const pdfPageHeight = pdf.internal.pageSize.getHeight();
    const margin = 30;
    const contentWidth = pdfPageWidth - margin * 2;
  
    let currentY = margin;
  
    const addCanvasToPdf = (canvas: HTMLCanvasElement) => {
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      const contentHeight = (canvasHeight * contentWidth) / canvasWidth;
  
      if (currentY + contentHeight > pdfPageHeight - margin && currentY > margin) {
        pdf.addPage();
        currentY = margin;
      }
  
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, currentY, contentWidth, contentHeight);
      currentY += contentHeight + 20;
    };
  
    const reportCards = Array.from(container.querySelectorAll('[data-report-card="true"]')) as HTMLElement[];
  
    for (const card of reportCards) {
      const elementsToHide = Array.from(card.querySelectorAll('[data-exclude-from-pdf="true"]')) as HTMLElement[];
      const issueArea = card.querySelector('[data-issues-scroll-area="true"]') as HTMLElement | null;
      
      elementsToHide.forEach(el => el.style.display = 'none');
      if (issueArea) {
        issueArea.classList.remove('max-h-[400px]');
      }
      
      try {
        const canvas = await html2canvas(card, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: null,
        });
        addCanvasToPdf(canvas);
      } catch (err) {
        console.error("Error generating canvas for a report card:", err);
      }
  
      elementsToHide.forEach(el => el.style.display = '');
      if (issueArea) {
        issueArea.classList.add('max-h-[400px]');
      }
    }
  
    pdf.save('validation-report.pdf');
    setIsGeneratingPdf(false);
  };
  
  const handleShare = async () => {
    if (results.length === 0) return;
    setIsSharing(true);
    try {
      const reportId = await saveReport(results);
      const url = `${window.location.origin}/report/${reportId}`;
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link Copied!",
        description: "A shareable link to the report has been copied to your clipboard.",
      });
    } catch (error) {
      console.error("[TRACE] Full error creating share link:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? `Could not create a shareable link: ${error.message}` : "Could not create a shareable link. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSharing(false);
    }
  };

  if (isLoading && results.length === 0) {
    return null;
  }

  if (!isLoading && results.length === 0) {
    return (
      <Card className="mt-8 shadow-md">
        <CardContent className="p-6 text-center">
          <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-lg font-medium text-foreground">No Validation Results Yet</p>
          <p className="text-sm text-muted-foreground">Upload a ZIP file and click "Validate & Preview" to see the report here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="flex justify-between items-center" id="report-header-to-exclude">
        <h2 className="text-2xl font-semibold text-foreground">Validation Report</h2>
        {results.length > 0 && !results.some(r => r.status === 'pending' || r.status === 'validating') && (
          <div className="flex gap-2">
            <Button onClick={handleShare} disabled={isSharing} variant="outline" size="sm">
              {isSharing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sharing...</>
              ) : (
                <><Share2 className="mr-2 h-4 w-4" /> Share</>
              )}
            </Button>
            <Button onClick={handleDownloadPdf} disabled={isGeneratingPdf} variant="outline" size="sm">
              {isGeneratingPdf ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating PDF...</>
              ) : (
                <><Download className="mr-2 h-4 w-4" /> Download Report</>
              )}
            </Button>
          </div>
        )}
      </div>
      <div ref={reportRef}>
        {(results || []).map(result => {
          
          let headerBgClass = 'bg-muted/30';
          let headerTextClass = 'text-foreground';
          let badgeTextClass = 'text-foreground';

          if (result.status === 'success') {
            headerBgClass = 'bg-success'; headerTextClass = 'text-success-foreground'; badgeTextClass = 'text-success-foreground';
          } else if (result.status === 'error') {
            headerBgClass = 'bg-destructive'; headerTextClass = 'text-destructive-foreground'; badgeTextClass = 'text-destructive-foreground';
          } else if (result.status === 'warning') {
            headerBgClass = 'bg-accent'; headerTextClass = 'text-accent-foreground'; badgeTextClass = 'text-accent-foreground';
          }

          const sortedIssues = [...(result.issues || [])].sort((a, b) => {
            const order = { error: 0, warning: 1, info: 2 };
            return order[a.type] - order[b.type];
          });
          
          const defaultExpandedIssues = sortedIssues.map(issue => issue.id);

          let dimensionExplanation: React.ReactNode = null;
          if (result.adDimensions && !result.adDimensions.actual) {
            const errorDimensionRuleIds = ['meta-size-invalid-values', 'meta-size-malformed-content', 'meta-size-missing-no-filename', 'meta-size-no-html-no-filename', 'meta-size-fallback-guess', 'meta-size-defaulted'];
            const warningDimensionRuleIds = ['meta-size-missing-inferred-filename', 'meta-size-no-html-inferred-filename'];
            const hasErrorIssue = (result.issues || []).find(issue => issue.type === 'error' && issue.rule && errorDimensionRuleIds.includes(issue.rule));
            const hasWarningIssue = (result.issues || []).find(issue => issue.type === 'warning' && issue.rule && warningDimensionRuleIds.includes(issue.rule));
            if (hasErrorIssue) {
              dimensionExplanation = (<p className="text-xs text-destructive flex items-center mt-1"><XCircle className="w-3 h-3 mr-1 flex-shrink-0" />Effective dimensions from fallback/filename due to meta tag error.</p>);
            } else if (hasWarningIssue) {
              dimensionExplanation = (<p className="text-xs text-accent flex items-center mt-1"><AlertTriangle className="w-3 h-3 mr-1 flex-shrink-0" />Effective dimensions inferred from filename as meta tag was missing.</p>);
            }
          }

          const nonInfoIssuesCount = (result.issues || []).filter(issue => issue.type === 'error' || issue.type === 'warning').length;
          const onlyInfoIssuesExist = (result.issues || []).length > 0 && nonInfoIssuesCount === 0;

          return (
            <Card key={result.id} className="shadow-lg overflow-hidden mb-8" data-report-card="true">
              <CardHeader className={`flex flex-row items-center justify-between space-y-0 p-4 ${headerBgClass} ${headerTextClass}`}>
                <div className="min-w-0">
                  <CardTitle className={`text-lg font-semibold truncate ${headerTextClass}`} title={result.fileName}>{result.fileName}</CardTitle>
                  <CardDescription className={`text-xs ${headerTextClass} opacity-80`}>Validation Status</CardDescription>
                </div>
                <div className="flex items-center gap-2" data-exclude-from-pdf="true">
                    {result.preview?.processedHtml && (
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="secondary" size="sm" className="h-8">
                                    <MonitorPlay className="w-4 h-4 mr-2" /> Preview
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
                                <DialogHeader className="p-4 border-b">
                                    <DialogTitle>Live Preview: {result.fileName}</DialogTitle>
                                    <DialogDescription className="text-left">
                                        This is a sandboxed preview. Some functionality may differ from the final environment.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="flex-grow overflow-auto">
                                   <BannerPreview result={result.preview} onRefresh={() => {}} />
                                </div>
                            </DialogContent>
                        </Dialog>
                    )}
                    {result.htmlContent && (
                       <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="outline" size="sm" className="h-8 text-foreground">
                                    <Code2 className="w-4 h-4 mr-2" /> View Source
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                                <DialogHeader>
                                    <DialogTitle>Source: {result.htmlEntryPoint}</DialogTitle>
                                     <DialogDescription>
                                        This is the original HTML content from your file.
                                    </DialogDescription>
                                </DialogHeader>
                                <SourceCodeViewer source={result.htmlContent} />
                            </DialogContent>
                        </Dialog>
                    )}
                    <div className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${badgeTextClass}`}>
                      <StatusIcon status={result.status} /><span className="ml-2 capitalize">{result.status}</span>
                    </div>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  {result.adDimensions && (
                    <div className="flex items-start p-3 bg-secondary/30 rounded-md">
                      <ImageIconLucide className="w-5 h-5 text-primary mr-3 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">Ad Dimensions</p>
                        {result.adDimensions.actual ? (<p className="text-muted-foreground">Meta Tag: {result.adDimensions.actual.width}x{result.adDimensions.actual.height}px</p>) : (<p className="text-muted-foreground">Meta Tag: Not found or invalid</p>)}
                        <p className="text-muted-foreground">Effective: {result.adDimensions.width}x{result.adDimensions.height}px</p>
                        {dimensionExplanation}
                      </div>
                    </div>
                  )}
                  {typeof result.fileStructureOk === 'boolean' && (
                    <div className="flex items-start p-3 bg-secondary/30 rounded-md">
                      {result.fileStructureOk ? <CheckCircle2 className="w-5 h-5 text-green-500 mr-3 mt-0.5 flex-shrink-0" /> : <XCircle className="w-5 h-5 text-destructive mr-3 mt-0.5 flex-shrink-0" />}
                      <div>
                        <p className="font-medium text-foreground">File Structure</p>
                        <p className="text-muted-foreground">{result.fileStructureOk ? `Valid (Using ${result.htmlEntryPoint})` : 'Invalid (HTML not found)'}</p>
                      </div>
                    </div>
                  )}
                  {result.fileSize && (
                     <div className="flex items-start p-3 bg-secondary/30 rounded-md">
                      <Archive className="w-5 h-5 text-primary mr-3 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">File Size</p>
                        <p className="text-muted-foreground">{formatBytes(result.fileSize)}{result.maxFileSize && ` (Max: ${formatBytes(result.maxFileSize)})`}</p>
                      </div>
                    </div>
                  )}
                </div>

                {result.detectedClickTags && result.detectedClickTags.length > 0 && (
                  <div>
                    <h4 className="text-md font-medium text-foreground mb-2 flex items-center"><LinkIcon className="w-4 h-4 mr-2 text-primary" />Detected ClickTags:</h4>
                    <ul className="list-disc list-inside pl-4 space-y-1 text-sm bg-secondary/30 p-3 rounded-md">
                      {result.detectedClickTags.map(ct => (<li key={ct.name} className="text-muted-foreground"><span className="font-medium text-foreground">{ct.name}:</span> {ct.url}{!ct.isHttps && <Badge variant="outline" className="ml-2 border-accent text-accent">Non-HTTPS</Badge>}</li>))}
                    </ul>
                  </div>
                )}

                {result.hasCorrectTopLevelClickTag && nonInfoIssuesCount === 0 && (
                  <div className="mt-2 text-sm text-green-600 flex items-center p-3 bg-green-500/10 rounded-md"><CheckCircle2 className="w-5 h-5 mr-2 flex-shrink-0 text-green-500" />Correct top-level clickTag found.</div>
                )}

                {(sortedIssues || []).length > 0 && (
                  <div>
                    <h4 className="text-md font-medium text-foreground mb-2">Issues Found ({sortedIssues.length}):</h4>
                    <ScrollArea className="max-h-[400px] w-full rounded-md border" data-issues-scroll-area="true">
                      <Accordion type="multiple" defaultValue={defaultExpandedIssues} className="w-full bg-card">
                        {sortedIssues.map(issue => (
                          <AccordionItem value={issue.id} key={issue.id}>
                            <AccordionTrigger className="px-4 py-3 text-sm hover:bg-muted/50 transition-colors">
                              <div className="flex items-center"><IssueIcon type={issue.type} /><span className="font-medium capitalize mr-2">{issue.type}:</span><span className="text-foreground text-left">{issue.message}</span></div>
                            </AccordionTrigger>
                            <AccordionContent className="px-4 pb-3 pt-1 text-sm text-muted-foreground bg-secondary/20">{issue.details || 'No additional details.'}</AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </ScrollArea>
                  </div>
                )}
                
                {nonInfoIssuesCount === 0 && result.status !== 'pending' && result.status !== 'validating' && (
                  result.hasCorrectTopLevelClickTag ? (
                    <div className="text-sm text-green-600 flex items-center p-3 bg-green-500/10 rounded-md mt-2"><CheckCircle2 className="w-5 h-5 mr-2 flex-shrink-0 text-green-500"/>{onlyInfoIssuesExist ? "No errors or warnings. ClickTag OK. See info messages." : "Creative meets requirements. ClickTag OK."}</div>
                  ) : (
                    <div className="text-sm text-accent flex items-center p-3 bg-accent/10 rounded-md mt-2"><AlertTriangle className="w-5 h-5 mr-2 flex-shrink-0 text-accent"/>{onlyInfoIssuesExist ? "No errors or warnings. Standard clickTag not found. See info." : "No errors or warnings. Standard clickTag not found."}</div>
                  )
                )}

              </CardContent>
              {result.status === 'pending' && (<CardFooter className="p-4 bg-muted/30"><p className="text-sm text-muted-foreground">Awaiting validation...</p></CardFooter>)}
              {result.status === 'validating' && (<CardFooter className="p-4 bg-primary/10"><div className="flex items-center text-sm text-primary"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Currently validating...</div></CardFooter>)}
            </Card>
          )
        })}
      </div>
      {results.length > 0 && !results.some(r => r.status === 'pending' || r.status !== 'validating') && (
        <div className="mt-8 pt-6 border-t border-border text-muted-foreground text-xs">
          <h5 className="font-semibold text-sm mb-2 text-foreground">ClickTag Identification Limitations:</h5>
          <p className="mb-1">Identification of clickTags from inline HTML scripts may fail for:</p>
          <ul className="list-disc list-inside pl-4 space-y-0.5">
            <li>Minified or obfuscated JavaScript.</li>
            <li>ClickTag URLs constructed dynamically.</li>
            <li>ClickTags defined in external .js files.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
```

---
### **`src/components/html-validator/banner-preview.tsx`**
```typescript
"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import type { PreviewResult } from '@/types';

interface BannerPreviewProps {
  result: PreviewResult;
  onRefresh: () => void;
}

export function BannerPreview({ result, onRefresh }: BannerPreviewProps) {
  
  return (
    <Card className="shadow-none border-0 h-full flex flex-col">
      <CardHeader className="flex-shrink-0">
        <div className="flex justify-between items-start">
            <div>
                <CardTitle className="text-xl flex items-center gap-2">
                    Live Preview
                </CardTitle>
                <CardDescription>
                    A sandboxed preview of your creative.
                </CardDescription>
            </div>
            <Button variant="outline" size="icon" onClick={onRefresh} title="Refresh Preview">
                <RefreshCw className="h-4 w-4" />
            </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-grow flex flex-col gap-4">
        {result.securityWarning && (
          <div className="flex-shrink-0 flex items-center gap-3 p-3 text-sm text-amber-800 dark:text-amber-200 border border-amber-500/50 bg-amber-500/10 rounded-md">
            <ShieldAlert className="h-5 w-5 flex-shrink-0" />
            <div>
              <span className="font-semibold">AI Security Note:</span>
              <p className="opacity-90">{result.securityWarning}</p>
            </div>
          </div>
        )}
        <div className="relative w-full flex-grow bg-muted/30 rounded-lg overflow-hidden border">
           <iframe
              key={result.id}
              srcDoc={result.processedHtml}
              sandbox="allow-scripts allow-same-origin"
              className="w-full h-full border-0"
              title={`Preview of ${result.fileName}`}
            />
        </div>
      </CardContent>
    </Card>
  );
}
```

---
### **`src/types/index.ts`**
```typescript
export interface ValidationIssue {
  id: string;
  type: 'error' | 'warning' | 'info';
  message: string;
  details?: string;
  rule?: string;
}

export interface ClickTagInfo {
  name: string;
  url: string;
  isHttps: boolean;
}

export interface ValidationResult {
  id: string;
  fileName: string;
  status: 'pending' | 'validating' | 'success' | 'error' | 'warning';
  issues: ValidationIssue[];
  adDimensions?: { width: number; height: number; actual?: {width: number; height: number} };
  fileStructureOk?: boolean;
  htmlEntryPoint?: string;
  htmlContent?: string;
  detectedClickTags?: ClickTagInfo[];
  fileSize?: number;
  maxFileSize?: number;
  hasCorrectTopLevelClickTag?: boolean;
  preview: PreviewResult | null;
}

export interface PreviewResult {
  id: string;
  fileName: string;
  entryPoint: string;
  processedHtml: string;
  securityWarning: string | null;
}
```

---
## 2. Server-Side API Endpoints
---

### **`src/app/api/process-file/route.ts`**
```typescript
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';
import fs from 'fs/promises';
import path from 'path';
import { findHtmlFile } from '@/lib/utils';
import { detectMaliciousArchive } from '@/ai/flows/detect-malicious-archive';

const TEMP_DIR = '/tmp/html-validator-previews';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function cleanup(id: string): Promise<void> {
  const previewDir = path.join(TEMP_DIR, id);
  try {
    const stats = await fs.stat(previewDir);
    if (stats.isDirectory()) {
      await fs.rm(previewDir, { recursive: true, force: true });
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') { // Ignore error if directory doesn't exist
      console.error(`Failed to cleanup preview directory ${id}:`, error);
    }
  }
}

function scheduleCleanup(id: string) {
    setTimeout(() => {
      cleanup(id).catch(err => console.error(`[Scheduler] Failed to cleanup ${id}:`, err));
    }, CACHE_TTL_MS);
}
  
export async function POST(request: NextRequest) {
  console.log('[TRACE] /api/process-file: Received request.');
  const formData = await request.formData();
  const file = formData.get('file') as File;

  if (!file) {
    console.error('[TRACE] /api/process-file: No file found in form data.');
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }

  const previewId = uuidv4();
  console.log(`[TRACE] /api/process-file: Generated previewId: ${previewId}`);
  
  const previewDir = path.join(TEMP_DIR, previewId);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    console.log('[TRACE] /api/process-file: Reading file into buffer.');
    const zip = await JSZip.loadAsync(buffer);
    console.log('[TRACE] /api/process-file: Loaded ZIP file into JSZip.');
    
    const filePaths: string[] = [];
    const textFileContents: { name: string; content: string }[] = [];
    const textFileExtensions = ['.html', '.css', '.js', '.json', '.txt', '.svg', '.xml'];

    const fileEntries = Object.values(zip.files);
    
    // Ensure the preview directory exists before writing files
    await fs.mkdir(previewDir, { recursive: true });
    
    const writePromises = fileEntries.map(async (entry) => {
        if (entry.dir || entry.name.startsWith('__MACOSX/')) {
          return;
        }

        filePaths.push(entry.name);
        const fileBuffer = await entry.async('nodebuffer');
        
        const fullPath = path.join(previewDir, entry.name);
        const dirName = path.dirname(fullPath);
        await fs.mkdir(dirName, { recursive: true });
        await fs.writeFile(fullPath, fileBuffer);

        const fileExt = (/\.([^.]+)$/.exec(entry.name) || [''])[0].toLowerCase();
        if (textFileExtensions.includes(fileExt)) {
            try {
                textFileContents.push({
                    name: entry.name,
                    content: fileBuffer.toString('utf-8')
                });
            } catch (e) {
                console.warn(`[TRACE] /api/process-file: Could not read file ${entry.name} as text for AI analysis.`);
            }
        }
    });

    console.log(`[TRACE] /api/process-file: Starting to write ${writePromises.length} files to disk.`);
    await Promise.all(writePromises);
    console.log('[TRACE] /api/process-file: Completed all file writes.');

    const timestampPath = path.join(previewDir, '.timestamp');
    await fs.writeFile(timestampPath, Date.now().toString());

    scheduleCleanup(previewId);

    const entryPoint = findHtmlFile(filePaths);
    if (!entryPoint) {
      console.error('[TRACE] /api/process-file: No HTML entry point found.');
      return NextResponse.json({ error: 'No HTML file found in the ZIP archive.' }, { status: 400 });
    }
    console.log(`[TRACE] /api/process-file: Found HTML entry point: ${entryPoint}`);
    
    let securityWarning: string | null = null;
    try {
        console.log('[TRACE] /api/process-file: Starting AI security analysis.');
        securityWarning = await detectMaliciousArchive(textFileContents);
        console.log(`[TRACE] /api/process-file: AI security analysis complete. Warning: ${securityWarning || 'None'}`);
    } catch (aiError) {
        console.warn(`[TRACE] /api/process-file: AI security analysis failed, but continuing. Error:`, aiError);
        securityWarning = 'AI security analysis could not be performed.';
    }


    const result = { previewId, entryPoint, securityWarning };
    console.log('[TRACE] /api/process-file: Successfully prepared result. Sending response.', result);
    return NextResponse.json(result, { status: 200 });

  } catch (error: any) {
    console.error(`[TRACE] /api/process-file: CRITICAL error during processing. Cleaning up cache for ${previewId}.`, error);
    await cleanup(previewId); // Cleanup disk cache on error
    return NextResponse.json({ error: `Failed to process ZIP file. ${error.message}` }, { status: 500 });
  }
}
```

---
### **`src/app/api/preview/[...slug]/route.ts`**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import mime from 'mime-types';

const TEMP_DIR = '/tmp/html-validator-previews';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedFile {
  buffer: Buffer;
  contentType: string;
}

async function getFile(id: string, filePath: string): Promise<CachedFile | undefined> {
  const previewDir = path.join(TEMP_DIR, id);
  const fullPath = path.join(previewDir, filePath);

  try {
    const timestampPath = path.join(previewDir, '.timestamp');
    const timestampContent = await fs.readFile(timestampPath, 'utf-8');
    const timestamp = parseInt(timestampContent, 10);

    if (Date.now() - timestamp > CACHE_TTL_MS) {
      // Don't cleanup here, let the periodic cleanup handle it
      return undefined; // Expired
    }
  
    // Add retry logic for file system propagation delay
    for (let i = 0; i < 3; i++) {
        try {
            const buffer = await fs.readFile(fullPath);
            const contentType = mime.lookup(filePath) || 'application/octet-stream';
            return { buffer, contentType };
        } catch (e: any) {
            if (e.code === 'ENOENT' && i < 2) {
                // File not found, wait and retry
                await new Promise(resolve => setTimeout(resolve, 150)); // Wait 150ms
            } else if (e.code !== 'ENOENT') {
                 // Log non-ENOENT errors but don't re-throw to avoid crashing the function
                 console.error(`[preview.get] Error reading file (attempt ${i+1}):`, e);
                 return undefined;
            }
        }
    }
    return undefined; // Return undefined after all retries fail
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
        console.error(`[preview.get] Critical error for preview ${id}/${filePath}:`, error);
    }
    return undefined;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string[] } }
) {
  const [previewId, ...filePathParts] = params.slug;
  const relativePath = filePathParts.join('/');

  if (!previewId || !relativePath) {
    return new NextResponse('Invalid request', { status: 400 });
  }
  
  const fileData = await getFile(previewId, relativePath);

  if (!fileData) {
    // Return a plain text response for 404 to avoid browser MIME type errors
    return new NextResponse(`Preview asset not found or expired: /${relativePath}`, { 
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
    });
  }
  
  return new NextResponse(fileData.buffer, {
    status: 200,
    headers: {
      'Content-Type': fileData.contentType,
      'Content-Length': fileData.buffer.length.toString(),
    },
  });
}
```

---
### **`src/ai/flows/detect-malicious-archive.ts`**
```typescript
'use server';
/**
 * @fileOverview An AI agent to detect potentially malicious code in website files.
 *
 * - detectMaliciousArchive - A function that analyzes file contents for security risks.
 * - MaliciousArchiveInput - The input type for the function.
 * - MaliciousArchiveOutput - The return type for the function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const MaliciousArchiveInputSchema = z.array(z.object({
    name: z.string().describe('The name of the file.'),
    content: z.string().describe('The text content of the file.')
})).describe('An array of file objects from the archive.');

export type MaliciousArchiveInput = z.infer<typeof MaliciousArchiveInputSchema>;

const MaliciousArchiveOutputSchema = z.object({
  isMalicious: z.boolean().describe('Whether a potential security risk was detected.'),
  reason: z.string().optional().describe('A brief, user-friendly explanation of the potential risk.'),
});

export type MaliciousArchiveOutput = z.infer<typeof MaliciousArchiveOutputSchema>;


const maliciousCodePrompt = ai.definePrompt({
    name: 'maliciousCodePrompt',
    input: { schema: MaliciousArchiveInputSchema },
    output: { schema: MaliciousArchiveOutputSchema },
    prompt: `You are a security expert responsible for analyzing website files (HTML, JS, CSS) for potential security risks. Analyze the following files.

Your task is to identify any of the following security risks:
- Obfuscated JavaScript that might hide malicious behavior.
- Use of 'eval()' or 'new Function()' with dynamic, untrusted data.
- Scripts that load external resources from suspicious or non-standard domains (common CDNs like Google, Cloudflare, jsDelivr, unpkg are acceptable).
- Code that appears to perform crypto-mining.
- Code that attempts to access sensitive browser information or APIs without clear user benefit (e.g., extensive fingerprinting).
- Hidden forms or clickjacking techniques.

For each file, I will provide the filename and its content.

Here are the files:
{{#each input}}
---
File: {{{name}}}
Content:
\`\`\`
{{{content}}}
\`\`\`
---
{{/each}}

Based on your analysis, determine if a potential security risk exists. If a risk is found, set isMalicious to true and provide a concise, one-sentence, non-technical reason for the user. Focus on the most significant risk. If no risks are found, set isMalicious to false.`,
});


export async function detectMaliciousArchive(input: MaliciousArchiveInput): Promise<string | null> {
    const { output } = await maliciousCodePrompt(input);
    if (output?.isMalicious) {
        return output.reason || 'AI analysis detected a potential security risk in the uploaded files.';
    }
    return null;
}
```

---
## 3. Report Sharing Functionality (Firebase)
---

### **`src/services/report-service.ts`**
```typescript
'use server';

import { db } from '@/lib/firebase';
import { collection, addDoc, getDoc, doc } from 'firebase/firestore';
import type { ValidationResult } from '@/types';

// We need a version of ValidationResult that is serializable for Firestore.
// The 'preview' object contains non-serializable data in some cases.
type SerializableValidationResult = Omit<ValidationResult, 'preview'> & {
    preview: {
        id: string;
        fileName: string;
        entryPoint: string;
        // processedHtml is fine, securityWarning is fine
        processedHtml: string | null;
        securityWarning: string | null;
    } | null;
};


/**
 * Saves a validation report to Firestore.
 * @param reportData The array of validation results.
 * @returns The unique ID of the saved report document.
 */
export async function saveReport(reportData: ValidationResult[]): Promise<string> {
  try {
    // Sanitize the data to ensure it's serializable
    const serializableReportData = reportData.map(result => {
        const { preview, ...rest } = result;
        return {
            ...rest,
            preview: preview ? {
                id: preview.id,
                fileName: preview.fileName,
                entryPoint: preview.entryPoint,
                processedHtml: preview.processedHtml || null,
                securityWarning: preview.securityWarning || null,
            } : null,
        };
    });

    const docRef = await addDoc(collection(db, 'reports'), {
      createdAt: new Date(),
      results: serializableReportData,
    });
    return docRef.id;
  } catch (error) {
    console.error("[TRACE] Full error saving report to Firestore:", error);
    if (error instanceof Error) {
        throw new Error(`Could not save the report: ${error.message}`);
    }
    throw new Error("Could not save the report due to an unknown error.");
  }
}

/**
 * Retrieves a validation report from Firestore.
 * @param id The unique ID of the report document.
 * @returns The validation report data.
 */
export async function getReport(id: string): Promise<ValidationResult[] | null> {
    try {
        const docRef = doc(db, 'reports', id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            // Firestore timestamps need to be converted
            const report = {
                ...data,
                createdAt: data.createdAt.toDate(),
            };
            return report.results as ValidationResult[];
        } else {
            console.log("No such document!");
            return null;
        }
    } catch (error) {
        console.error("Error fetching report from Firestore:", error);
        return null;
    }
}
```

---
### **`src/lib/firebase.ts`**
```typescript
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  // Replace with your new app's Firebase config
  projectId: "html-validator-38nwr",
  appId: "1:155850881830:web:dc859c7244ce6d9829dfe7",
  storageBucket: "html-validator-38nwr.firebasestorage.app",
  apiKey: "AIzaSyByDVvSbQOZ1Xix_sqq9jNkvQbbd5Gc9PI",
  authDomain: "html-validator-38nwr.firebaseapp.com",
  measurementId: "",
  messagingSenderId: "155850881830"
};

// This function ensures Firebase is initialized, either on the server or the client.
const getFirebaseApp = () => {
    if (!getApps().length) {
        return initializeApp(firebaseConfig);
    }
    return getApp();
};

const app = getFirebaseApp();
const db = getFirestore(app);

export { db, app };
```

---
### **`src/components/firebase/firebase-provider.tsx`**
```typescript
'use client';

import { createContext, useContext } from 'react';
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';

// Your web app's Firebase configuration
const firebaseConfig = {
  // Replace with your new app's Firebase config
  projectId: "html-validator-38nwr",
  appId: "1:155850881830:web:dc859c7244ce6d9829dfe7",
  storageBucket: "html-validator-38nwr.firebasestorage.app",
  apiKey: "AIzaSyByDVvSbQOZ1Xix_sqq9jNkvQbbd5Gc9PI",
  authDomain: "html-validator-38nwr.firebaseapp.com",
  measurementId: "",
  messagingSenderId: "155850881830"
};

// Initialize Firebase
let firebaseApp: FirebaseApp;
if (!getApps().length) {
  firebaseApp = initializeApp(firebaseConfig);
} else {
  firebaseApp = getApps()[0];
}

const FirebaseContext = createContext<FirebaseApp | null>(null);

export const useFirebase = () => {
  return useContext(FirebaseContext);
};

export const FirebaseProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <FirebaseContext.Provider value={firebaseApp}>
      {children}
    </FirebaseContext.Provider>
  );
};
```

---
### **`src/app/report/[reportId]/page.tsx`**
```typescript
'use client';

import { useEffect, useState } from 'react';
import { getReport } from '@/services/report-service';
import type { ValidationResult } from '@/types';
import { AppHeader } from '@/components/layout/header';
import { ValidationResults } from '@/components/html-validator/validation-results';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, FileX2 } from 'lucide-react';

export default function ReportPage({ params }: { params: { reportId: string } }) {
  const [reportData, setReportData] = useState<ValidationResult[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.reportId) {
      const fetchReport = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const data = await getReport(params.reportId);
          if (data) {
            setReportData(data);
          } else {
            setError('Report not found. The link may have expired or is invalid.');
          }
        } catch (err) {
          console.error('Failed to fetch report:', err);
          setError(err instanceof Error ? err.message : 'An unexpected error occurred while fetching the report.');
        } finally {
          setIsLoading(false);
        }
      };
      fetchReport();
    }
  }, [params.reportId]);

  return (
    <div className="min-h-screen flex flex-col bg-muted/20">
      <AppHeader />
      <main className="flex-grow container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto space-y-8">
          {isLoading && (
            <Card className="shadow-md">
              <CardContent className="p-10 text-center">
                <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
                <p className="text-lg font-medium text-foreground">Loading Report...</p>
                <p className="text-sm text-muted-foreground">Please wait while we fetch the validation results.</p>
              </CardContent>
            </Card>
          )}
          {error && !isLoading && (
             <Card className="shadow-md border-destructive">
                <CardContent className="p-10 text-center">
                    <FileX2 className="w-12 h-12 mx-auto text-destructive mb-4" />
                    <p className="text-lg font-medium text-destructive">Error Loading Report</p>
                    <p className="text-sm text-muted-foreground">{error}</p>
                </CardContent>
            </Card>
          )}
          {reportData && !isLoading && (
            <>
                <div className="p-4 bg-card rounded-lg border">
                    <h1 className="text-2xl font-semibold text-foreground">Validation Report</h1>
                    <p className="text-sm text-muted-foreground">This is a shared, read-only view of a validation report. Report ID: {params.reportId}</p>
                </div>
                <ValidationResults results={reportData} isLoading={false} />
            </>
          )}
        </div>
      </main>
       <footer className="py-6 text-center text-sm text-muted-foreground border-t bg-card">
        © {new Date().getFullYear()} HTML Validator. All rights reserved.
      </footer>
    </div>
  );
}
```

---
### **`firestore.rules`**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /reports/{reportId} {
      // Allow anyone to create a new report
      allow create: if true;
      
      // Allow anyone to read a report
      allow read: if true;
      
      // Deny updates and deletes
      allow update, delete: if false;
    }
  }
}
```
