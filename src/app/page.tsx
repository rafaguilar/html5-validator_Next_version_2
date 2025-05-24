
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


const createMockIssue = (type: 'error' | 'warning', message: string, details?: string): ValidationIssue => ({
  id: `issue-${Math.random().toString(36).substr(2, 9)}`,
  type,
  message,
  details,
});

const extractHtmlContentFromZip = async (file: File): Promise<string | null> => {
  try {
    const zip = await JSZip.loadAsync(file);
    // Prioritize index.html at root
    let htmlFile = zip.file(/^index\.html$/i)?.[0] || zip.file(/^[^/]*index\.html$/i)?.[0];

    if (!htmlFile) {
      // If not found, try any .html file at the root
      const rootHtmlFiles = zip.file(/^[^/]+\.html$/i);
      if (rootHtmlFiles.length > 0) {
        htmlFile = rootHtmlFiles[0];
      }
    }
    
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
  // Regex to find clickTag assignments:
  // Supports var clickTag = "URL"; or var clickTagN = "URL"; or window.clickTag = "URL";
  // Also supports let, const and assignments without var/let/const if at the start of a line or after ; , { (
  // Handles single quotes and case-insensitivity for "clickTag".
  const clickTagRegex = /(?:^|[\s;,\{\(])\s*(?:(?:var|let|const)\s+)?(?:window\.)?([a-zA-Z0-9_]*clickTag[a-zA-Z0-9_]*)\s*=\s*["'](http[^"']+)["']/gmi;
  
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
    const name = match[1]; // Capture group for the clickTag variable name
    const url = match[2];  // Capture group for the URL
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
  // Removed short delay, as actual parsing takes time

  const issues: ValidationIssue[] = [];
  let status: ValidationResult['status'] = 'success';
  
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
  let adSizeMetaTagContent: string | null = null;

  let filenameIntrinsicWidth: number | undefined;
  let filenameIntrinsicHeight: number | undefined;
  const filenameDimMatch = file.name.match(/_(\d+)x(\d+)(?:[^/]*)\.zip$/i);

  if (filenameDimMatch && filenameDimMatch[1] && filenameDimMatch[2]) {
    filenameIntrinsicWidth = parseInt(filenameDimMatch[1], 10);
    filenameIntrinsicHeight = parseInt(filenameDimMatch[2], 10);
  }
  
  if (htmlContent) {
    const metaTagRegex = /<meta\s+name=["']ad\.size["']\s+content=["']([^"']+)["'][^>]*>/i;
    const metaTagMatch = htmlContent.match(metaTagRegex);
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
      // If no meta tag in HTML, but dimensions are in filename, we can use those as "actual" for consistency.
      if (filenameIntrinsicWidth !== undefined && filenameIntrinsicHeight !== undefined) {
        actualMetaWidth = filenameIntrinsicWidth;
        actualMetaHeight = filenameIntrinsicHeight;
        issues.push(createMockIssue('warning', 'Required ad.size meta tag not found in HTML. Dimensions inferred from filename.', 'Ensure <meta name="ad.size" content="width=XXX,height=XXX"> is present.'));
      } else {
        issues.push(createMockIssue('error', 'Required ad.size meta tag not found in HTML and no dimensions in filename.', 'Ensure <meta name="ad.size" content="width=XXX,height=XXX"> is present or include dimensions in filename like _WIDTHxHEIGHT.zip.'));
      }
    }
  } else { // No HTML content extracted
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
      // This case is mostly covered by actualMetaWidth being set from filenameIntrinsicWidth if HTML parsing failed for meta tag
      expectedDim = { width: filenameIntrinsicWidth, height: filenameIntrinsicHeight };
      if (!issues.some(iss => iss.message.includes("ad.size meta tag") || iss.message.includes("Could not extract HTML"))) { 
        issues.push(createMockIssue('warning', 'Ad dimensions inferred from filename due to missing/invalid ad.size meta tag or HTML extraction issues.'));
      }
  } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0) { // Fallback if no meta tag, no filename dimension, and no HTML.
      const fallbackDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
      expectedDim = {width: fallbackDim.width, height: fallbackDim.height};
      issues.push(createMockIssue('error', `Could not determine ad dimensions from meta tag or filename. Defaulted to a fallback guess: ${fallbackDim.width}x${fallbackDim.height}. Verify ad.size meta tag and filename conventions.`));
  } else { // Absolute fallback
      expectedDim = { width: 300, height: 250 }; 
      issues.push(createMockIssue('error', 'Could not determine ad dimensions. Defaulted to 300x250. Ensure ad.size meta tag or filename convention is used.'));
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

  // Simplified file structure check for now, as detailed zip inspection is complex client-side
  const fileStructureOk = htmlContent ? true : false; 
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
    // This might be redundant if actual size check reports error, but fine for mock
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
    htmlContent: htmlContent || undefined,
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
    // Create initial "pending" results
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
            fileStructureOk: true, // Assume true initially
            adDimensions: { width: initialWidth, height: initialHeight, actual: undefined },
            detectedClickTags: undefined,
            htmlContent: undefined,
        };
    });
    setValidationResults(initialPendingResults);


    const resultsPromises = selectedFiles.map(async (file, index) => {
      const currentPendingResultId = initialPendingResults[index].id;
      try {
        const htmlContent = await extractHtmlContentFromZip(file);
        const detectedClickTags = findClickTagsInHtml(htmlContent);
        const validationResultPart = await buildValidationResult(file, htmlContent, detectedClickTags);
        
        return {
          id: currentPendingResultId, // Keep the same ID to update the pending entry
          fileName: file.name,
          fileSize: file.size,
          ...validationResultPart,
        };
      } catch (error) {
        // Handle errors during individual file processing
        const errorResult: ValidationResult = {
            id: currentPendingResultId,
            fileName: file.name,
            status: 'error',
            issues: [createMockIssue('error', 'An unexpected error occurred during validation process.', (error as Error).message)],
            fileSize: file.size,
            maxFileSize: MOCK_MAX_FILE_SIZE,
            fileStructureOk: false,
            adDimensions: initialPendingResults[index].adDimensions, // Keep initial guess
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

