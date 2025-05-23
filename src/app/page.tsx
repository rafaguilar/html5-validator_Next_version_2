
"use client";

import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import { AppHeader } from '@/components/layout/header';
import { FileUploader } from '@/components/html-validator/file-uploader';
import { ValidationResults } from '@/components/html-validator/validation-results';
import type { ValidationResult, ValidationIssue, ClickTagInfo } from '@/types';
import { useToast } from "@/hooks/use-toast";

const MOCK_MAX_FILE_SIZE = 2.2 * 1024 * 1024; // 2.2MB
const MOCK_EXPECTED_DIMENSIONS_FALLBACK = [{width: 300, height: 250}, {width: 728, height: 90}, {width: 160, height: 600}]; // Fallback if no dimensions from filename or meta

// Simulate a wider range of possible actual dimensions that could be in a meta tag if filename doesn't specify
const POSSIBLE_ACTUAL_DIMENSIONS_FROM_META_FALLBACK = [
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

const mockValidateFile = async (file: File): Promise<Omit<ValidationResult, 'id' | 'fileName' | 'fileSize' | 'htmlContent'>> => {
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500)); // Simulate network delay

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
    // If filename provides dimensions, assume the ad.size meta tag is present and correctly reflects these dimensions.
    actualMetaWidth = fileIntrinsicWidth;
    actualMetaHeight = fileIntrinsicHeight;
    simulatedMetaTagContentString = `width=${fileIntrinsicWidth},height=${fileIntrinsicHeight}`;
  } else {
    // Filename does NOT provide dimensions. Simulate random meta tag scenarios.
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
      const chosenFallbackDim = POSSIBLE_ACTUAL_DIMENSIONS_FROM_META_FALLBACK[Math.floor(Math.random() * POSSIBLE_ACTUAL_DIMENSIONS_FROM_META_FALLBACK.length)];
      simulatedMetaTagContentString = `width=${chosenFallbackDim.width},height=${chosenFallbackDim.height}`;
      
      const match = simulatedMetaTagContentString.match(/width=(\d+)[,;]?\s*height=(\d+)/i);
      if (match && match[1] && match[2]) {
        const wVal = parseInt(match[1], 10);
        const hVal = parseInt(match[2], 10);
        if (!isNaN(wVal) && !isNaN(hVal)) {
          actualMetaWidth = wVal;
          actualMetaHeight = hVal;
        } else {
          issues.push(createMockIssue('error', 'Invalid numeric values in ad.size meta tag.', `Parsed non-numeric values from: "${simulatedMetaTagContentString}"`));
        }
      } else {
         issues.push(createMockIssue('error', 'Malformed ad.size meta tag content.', `Content: "${simulatedMetaTagContentString}". Expected "width=XXX,height=YYY".`));
      }
    }
  }

  let expectedDim: { width: number; height: number };
  if (actualMetaWidth !== undefined && actualMetaHeight !== undefined) {
    expectedDim = { width: actualMetaWidth, height: actualMetaHeight };
  } else {
    if (fileIntrinsicWidth !== undefined && fileIntrinsicHeight !== undefined) {
        expectedDim = { width: fileIntrinsicWidth, height: fileIntrinsicHeight };
    } else if (MOCK_EXPECTED_DIMENSIONS_FALLBACK.length > 0) {
        // Fallback to the first item in MOCK_EXPECTED_DIMENSIONS_FALLBACK or a default
        expectedDim = MOCK_EXPECTED_DIMENSIONS_FALLBACK[0];
    } else {
        expectedDim = { width: 300, height: 250 }; // Absolute fallback
    }
  }
  
  const adDimensions: ValidationResult['adDimensions'] = {
    width: expectedDim.width, 
    height: expectedDim.height, 
    actual: (actualMetaWidth !== undefined && actualMetaHeight !== undefined)
            ? { width: actualMetaWidth, height: actualMetaHeight }
            : undefined,
  };

  // File Size Check
  const isTooLarge = file.size > MOCK_MAX_FILE_SIZE;
  if (isTooLarge) {
    issues.push(createMockIssue('error', `File size exceeds limit (${(MOCK_MAX_FILE_SIZE / (1024*1024)).toFixed(1)}MB).`));
  }

  // ClickTag Simulation (90% chance to find specific clickTags)
  const clickTagScenario = Math.random();
  if (clickTagScenario > 0.1) {
    const ct1 = { name: 'clickTag', url: "https://www.symbravohcp.com", isHttps: true };
    const ct2 = { name: 'clickTag2', url: "http://www.axsome.com/symbravo-prescribing-information.pdf", isHttps: false };
    detectedClickTags.push(ct1, ct2);

    if (!ct2.isHttps) {
      issues.push(createMockIssue('warning', `ClickTag '${ct2.name}' uses non-HTTPS URL.`, `URL: ${ct2.url}`));
    }
  } else { // 10% chance no clickTags are found
    issues.push(createMockIssue('error', 'Missing or invalid clickTag implementation.'));
  }
  
  const fileStructureOk = true; // Assume valid for mock

  // Random warning if no other issues (and not too large, as that might be a warning itself)
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

  const extractHtmlFromZip = async (file: File): Promise<string | undefined> => {
    try {
      const zip = await JSZip.loadAsync(file);
      let htmlFile = zip.file("index.html");
      if (!htmlFile) {
        const htmlFiles = zip.file(/\.html?$/i);
        if (htmlFiles.length > 0) {
          // Prefer HTML files at the root
          const rootHtmlFiles = htmlFiles.filter(f => !f.name.includes('/'));
          htmlFile = rootHtmlFiles.length > 0 ? rootHtmlFiles[0] : htmlFiles[0];
        }
      }
      if (htmlFile) {
        return await htmlFile.async("string");
      }
      return undefined;
    } catch (error) {
      console.error("Error unzipping file or reading HTML:", file.name, error);
      return undefined;
    }
  };


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
      } else if (MOCK_EXPECTED_DIMENSIONS_FALLBACK.length > 0) {
        const tempDim = MOCK_EXPECTED_DIMENSIONS_FALLBACK[0];
        initialWidth = tempDim.width;
        initialHeight = tempDim.height;
      }

      return {
        id: `${file.name}-${Date.now()}-pending`,
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
        htmlContent: undefined, // Will be populated later
      };
    });

    const initialResults = await Promise.all(initialResultsPromises);
    setValidationResults(initialResults);
    
    const resultsPromises = selectedFiles.map(async (file, index) => {
      let htmlContent: string | undefined;
      try {
        htmlContent = await extractHtmlFromZip(file);
      } catch (e) {
        console.error(`Failed to extract HTML for ${file.name}`, e);
        // Potentially add an issue here if HTML extraction is critical
      }

      const mockResultPart = await mockValidateFile(file);
      
      return {
        ...initialResults[index], // Preserve ID and initial file info
        ...mockResultPart, // Get status, issues, etc. from mock
        htmlContent, // Add the extracted HTML content
        // Ensure id, fileName, fileSize are correctly from initialResults if not in mockResultPart
        id: initialResults[index].id,
        fileName: file.name,
        fileSize: file.size,
      };
    });
    
    for (let i = 0; i < resultsPromises.length; i++) {
      try {
        const result = await resultsPromises[i];
        setValidationResults(prevResults => 
          prevResults.map(pr => pr.id === result.id ? result : pr)
        );
      } catch (error) {
        console.error("Validation error for file:", selectedFiles[i].name, error);
        
        let errorInitialWidth = 0;
        let errorInitialHeight = 0;
        const errorFilenameDimMatch = selectedFiles[i].name.match(/_(\d+)x(\d+)(?:[^/]*)\.zip$/i);
        if (errorFilenameDimMatch && errorFilenameDimMatch[1] && errorFilenameDimMatch[2]) {
            errorInitialWidth = parseInt(errorFilenameDimMatch[1], 10);
            errorInitialHeight = parseInt(errorFilenameDimMatch[2], 10);
        } else if (MOCK_EXPECTED_DIMENSIONS_FALLBACK.length > 0) {
            const tempDim = MOCK_EXPECTED_DIMENSIONS_FALLBACK[0];
            errorInitialWidth = tempDim.width;
            errorInitialHeight = tempDim.height;
        }

        const errorResult: ValidationResult = {
          id: `${selectedFiles[i].name}-${Date.now()}-error`,
          fileName: selectedFiles[i].name,
          status: 'error',
          issues: [createMockIssue('error', 'An unexpected error occurred during validation.')],
          fileSize: selectedFiles[i].size,
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
