
"use client";

import React, { useState, useEffect } from 'react';
import { AppHeader } from '@/components/layout/header';
import { FileUploader } from '@/components/html-validator/file-uploader';
import { ValidationResults } from '@/components/html-validator/validation-results';
import type { ValidationResult, ValidationIssue, ClickTagInfo } from '@/types';
import { useToast } from "@/hooks/use-toast";

const MOCK_MAX_FILE_SIZE = 2.2 * 1024 * 1024; // 2.2MB
// Represents potential ad slot sizes or campaign requirements
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


const mockValidateFile = async (file: File): Promise<Omit<ValidationResult, 'id' | 'fileName' | 'fileSize' | 'htmlContent'>> => {
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

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
    // If dimensions are in filename, assume meta tag is correct and reflects these
    simulatedMetaTagContentString = `width=${fileIntrinsicWidth},height=${fileIntrinsicHeight}`;
    actualMetaWidth = fileIntrinsicWidth;
    actualMetaHeight = fileIntrinsicHeight;
  } else {
    // If no dimensions in filename, simulate various meta tag states for files not matching the pattern
    const metaTagScenario = Math.random();
    if (metaTagScenario < 0.05) { // 5% chance: meta tag missing
      simulatedMetaTagContentString = null;
      issues.push(createMockIssue('error', 'Required ad.size meta tag not found in HTML.', 'Ensure <meta name="ad.size" content="width=XXX,height=XXX"> is present.'));
    } else if (metaTagScenario < 0.15) { // 10% chance: meta tag malformed
      const malformType = Math.random();
      if (malformType < 0.25) simulatedMetaTagContentString = "width=300,height=BAD";
      else if (malformType < 0.50) simulatedMetaTagContentString = "width=300";
      else if (malformType < 0.75) simulatedMetaTagContentString = "height=250";
      else simulatedMetaTagContentString = "size=300x250"; // common error
      issues.push(createMockIssue('error', 'Invalid ad.size meta tag format.', `Meta tag content found: "${simulatedMetaTagContentString}". Expected format: "width=XXX,height=XXX".`));
    } else { // 85% chance: meta tag present and correct (using a fallback dimension)
      const chosenFallbackDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
      simulatedMetaTagContentString = `width=${chosenFallbackDim.width},height=${chosenFallbackDim.height}`;
      const metaMatch = simulatedMetaTagContentString.match(/width=(\d+)[,;]?\s*height=(\d+)/i);
      if (metaMatch && metaMatch[1] && metaMatch[2]) {
        const wVal = parseInt(metaMatch[1], 10);
        const hVal = parseInt(metaMatch[2], 10);
        if (!isNaN(wVal) && !isNaN(hVal)) {
          actualMetaWidth = wVal;
          actualMetaHeight = hVal;
        } else {
          issues.push(createMockIssue('error', 'Invalid numeric values in ad.size meta tag.', `Parsed non-numeric values from: "${simulatedMetaTagContentString}"`));
        }
      } else {
         issues.push(createMockIssue('error', 'Malformed ad.size meta tag content (fallback parsing).', `Content: "${simulatedMetaTagContentString}". Expected "width=XXX,height=YYY".`));
      }
    }
  }


  let expectedDim: { width: number; height: number };
  if (actualMetaWidth !== undefined && actualMetaHeight !== undefined) {
    expectedDim = { width: actualMetaWidth, height: actualMetaHeight };
  } else if (fileIntrinsicWidth !== undefined && fileIntrinsicHeight !== undefined) {
      // Fallback to filename dimensions if meta tag was problematic but filename had good info
      expectedDim = { width: fileIntrinsicWidth, height: fileIntrinsicHeight };
      if (simulatedMetaTagContentString === null || !simulatedMetaTagContentString.includes(`width=${fileIntrinsicWidth}`) || !simulatedMetaTagContentString.includes(`height=${fileIntrinsicHeight}`)) {
         issues.push(createMockIssue('warning', 'Ad dimensions inferred from filename due to missing/invalid ad.size meta tag.'));
      }
  } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0) {
      // Further fallback if neither meta tag nor filename provided clear dimensions
      expectedDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
      issues.push(createMockIssue('warning', 'Ad dimensions are a fallback guess. Verify ad.size meta tag and filename conventions.'));
  } else {
      // Absolute fallback, should ideally not be reached if POSSIBLE_FALLBACK_DIMENSIONS is populated
      expectedDim = { width: 300, height: 250 };
      issues.push(createMockIssue('error', 'Could not determine ad dimensions. Ensure ad.size meta tag or filename convention is used.'));
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

  const clickTagScenario = Math.random();
  if (clickTagScenario > 0.05) { // 95% chance clicktags are found (increased from 90%)
    const ct1IsHttps = Math.random() > 0.1; // 90% chance clickTag1 is HTTPS (was always true)
    const ct1Url = ct1IsHttps ? "https://www.symbravohcp.com" : "http://www.symbravohcp.com";
    const ct1: ClickTagInfo = { name: 'clickTag', url: ct1Url, isHttps: ct1IsHttps };
    detectedClickTags.push(ct1);
    if (!ct1.isHttps) {
      issues.push(createMockIssue('warning', `ClickTag '${ct1.name}' uses non-HTTPS URL.`, `URL: ${ct1.url}`));
    }

    if (Math.random() > 0.3) { // 70% of those also have clickTag2
        const ct2IsHttps = Math.random() > 0.2; // 80% chance clickTag2 is https
        const ct2Url = ct2IsHttps ? "https://www.axsome.com/symbravo-prescribing-information.pdf" : "http://www.axsome.com/symbravo-prescribing-information.pdf";
        const ct2: ClickTagInfo = { name: 'clickTag2', url: ct2Url, isHttps: ct2IsHttps };
        detectedClickTags.push(ct2);
        if (!ct2.isHttps) {
          issues.push(createMockIssue('warning', `ClickTag '${ct2.name}' uses non-HTTPS URL.`, `URL: ${ct2.url}`));
        }
    }
  } else { // 5% chance missing clickTags
    issues.push(createMockIssue('error', 'Missing or invalid clickTag implementation.'));
  }

  const fileStructureOk = true; // Assume true for mock, real check would be complex

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
      } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0) {
        const tempDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
        initialWidth = tempDim.width;
        initialHeight = tempDim.height;
      }

      return {
        id: `${file.name}-${Date.now()}-pending-${Math.random()}`,
        fileName: file.name,
        status: 'validating' as ValidationResult['status'],
        issues: [],
        fileSize: file.size,
        maxFileSize: MOCK_MAX_FILE_SIZE,
        fileStructureOk: true, // Assume true initially
        adDimensions: {
          width: initialWidth,
          height: initialHeight,
          actual: undefined // Actual dimensions will come from mockValidateFile
        },
        htmlContent: undefined, // HTML content is not used for placeholder previews
      };
    });

    const initialResults = await Promise.all(initialResultsPromises);
    setValidationResults(initialResults);

    const resultsPromises = selectedFiles.map(async (file, index) => {
      const mockResultPart = await mockValidateFile(file);
      const finalIssues = [...initialResults[index].issues, ...mockResultPart.issues];

      let finalStatus = mockResultPart.status;
      if (initialResults[index].status === 'error' || finalIssues.some(issue => issue.type === 'error')) {
        finalStatus = 'error';
      } else if (finalStatus !== 'error' && finalIssues.some(issue => issue.type === 'warning')) {
        finalStatus = 'warning';
      }

      return {
        ...initialResults[index], // Keep initial id, fileName, fileSize
        ...mockResultPart, // Get status, issues, adDimensions, etc. from mock
        htmlContent: undefined, // Ensure htmlContent is undefined for placeholder previews
        issues: finalIssues,
        status: finalStatus,
        // Ensure adDimensions from mockValidateFile are used, which now correctly considers filename and meta tag simulation
        adDimensions: mockResultPart.adDimensions
      };
    });

    for (let i = 0; i < resultsPromises.length; i++) {
      try {
        const result = await resultsPromises[i];
        setValidationResults(prevResults =>
          prevResults.map(pr => pr.id === result.id ? result : pr)
        );
      } catch (error) {
        let errorInitialWidth = 0;
        let errorInitialHeight = 0;
        const errorFilenameDimMatch = selectedFiles[i].name.match(/_(\d+)x(\d+)(?:[^/]*)\.zip$/i);
        if (errorFilenameDimMatch && errorFilenameDimMatch[1] && errorFilenameDimMatch[2]) {
            errorInitialWidth = parseInt(errorFilenameDimMatch[1], 10);
            errorInitialHeight = parseInt(errorFilenameDimMatch[2], 10);
        } else if (POSSIBLE_FALLBACK_DIMENSIONS.length > 0) {
            const tempDim = POSSIBLE_FALLBACK_DIMENSIONS[Math.floor(Math.random() * POSSIBLE_FALLBACK_DIMENSIONS.length)];
            errorInitialWidth = tempDim.width;
            errorInitialHeight = tempDim.height;
        }

        const errorResult: ValidationResult = {
          id: `${selectedFiles[i].name}-${Date.now()}-error-${Math.random()}`,
          fileName: selectedFiles[i].name,
          status: 'error',
          issues: [createMockIssue('error', 'An unexpected error occurred during validation process.', (error as Error).message)],
          fileSize: selectedFiles[i].size,
          maxFileSize: MOCK_MAX_FILE_SIZE,
          fileStructureOk: false,
           adDimensions: {
            width: errorInitialWidth,
            height: errorInitialHeight,
            actual: undefined
          },
          htmlContent: undefined,
        };
        setValidationResults(prevResults =>
          prevResults.map(pr => (pr.fileName === selectedFiles[i].name && (pr.status === 'validating' || pr.id.includes('-pending-'))) ? errorResult : pr)
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

