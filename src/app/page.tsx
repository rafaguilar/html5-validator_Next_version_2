
"use client";

import React, { useState, useEffect } from 'react';
import { AppHeader } from '@/components/layout/header';
import { FileUploader } from '@/components/html-validator/file-uploader';
import { ValidationResults } from '@/components/html-validator/validation-results';
import type { ValidationResult, ValidationIssue } from '@/types';
import { useToast } from "@/hooks/use-toast";

// Mock data and functions
const MOCK_MAX_FILE_SIZE = 2.2 * 1024 * 1024; // 2.2MB
const MOCK_EXPECTED_DIMENSIONS = [{width: 300, height: 250}, {width: 728, height: 90}];

const createMockIssue = (type: 'error' | 'warning', message: string, details?: string): ValidationIssue => ({
  id: `issue-${Math.random().toString(36).substr(2, 9)}`,
  type,
  message,
  details,
});

const mockValidateFile = async (file: File): Promise<ValidationResult> => {
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1500)); // Simulate network delay

  const issues: ValidationIssue[] = [];
  let status: ValidationResult['status'] = 'success'; // Assume success initially
  
  // Simulate reading <meta name="ad.size" content="width=XXX,height=XXX">
  let actualMetaWidth: number | undefined = undefined;
  let actualMetaHeight: number | undefined = undefined;
  const metaTagScenario = Math.random(); // Determines if/how meta tag is found

  if (metaTagScenario < 0.85) { // 85% chance meta tag is "found" (could be valid or malformed)
    if (Math.random() < 0.9) { // 90% of "found" tags are valid
      // Simulate valid meta tag with some variation based on one of the expected dimensions
      const baseDimIndex = Math.floor(Math.random() * MOCK_EXPECTED_DIMENSIONS.length);
      const baseWidth = MOCK_EXPECTED_DIMENSIONS[baseDimIndex].width;
      const baseHeight = MOCK_EXPECTED_DIMENSIONS[baseDimIndex].height;
      // Allow for some small deviations, or sometimes make it match an expected dim, or be completely different
      const deviationChance = Math.random();
      if (deviationChance < 0.6) { // 60% chance it matches one of the expected sets, or is close
        actualMetaWidth = baseWidth + Math.floor((Math.random() - 0.5) * 10); // +/- 5px
        actualMetaHeight = baseHeight + Math.floor((Math.random() - 0.5) * 10); // +/- 5px
      } else if (deviationChance < 0.8) { // 20% chance it matches exactly another expected dim
         const anotherExpectedDim = MOCK_EXPECTED_DIMENSIONS[(baseDimIndex + 1) % MOCK_EXPECTED_DIMENSIONS.length];
         actualMetaWidth = anotherExpectedDim.width;
         actualMetaHeight = anotherExpectedDim.height;
      } else { // 20% chance it's some other random dimension
        actualMetaWidth = Math.floor(100 + Math.random() * 500); // e.g. 100-599
        actualMetaHeight = Math.floor(50 + Math.random() * 300); // e.g. 50-349
      }
    } else {
      // Simulate malformed meta tag
      issues.push(createMockIssue('error', 'Invalid ad.size meta tag format.', 'Expected format: "width=XXX,height=XXX".'));
      // actualMetaWidth and actualMetaHeight remain undefined
    }
  } else { // 15% chance meta tag is "not found"
    issues.push(createMockIssue('error', 'Required ad.size meta tag not found in HTML.', 'Ensure <meta name="ad.size" content="width=XXX,height=XXX"> is present.'));
    // actualMetaWidth and actualMetaHeight remain undefined
  }

  // Determine expected dimensions (e.g., from campaign settings for the ad slot)
  // For mock, let's always pick one of the MOCK_EXPECTED_DIMENSIONS as the "expected" for this validation run.
  const expectedDim = MOCK_EXPECTED_DIMENSIONS[Math.floor(Math.random() * MOCK_EXPECTED_DIMENSIONS.length)];

  // Populate adDimensions for the report. This part should always run.
  // It represents the expected dimensions for the slot, and what was detected from the creative.
  const adDimensions: ValidationResult['adDimensions'] = {
    width: expectedDim.width, // Expected width for the ad slot
    height: expectedDim.height, // Expected height for the ad slot
    actual: actualMetaWidth !== undefined && actualMetaHeight !== undefined 
            ? { width: actualMetaWidth, height: actualMetaHeight } 
            : undefined, // Actual dimensions detected from the creative's meta tag
  };

  // Check if actual detected dimensions (if any) match expected dimensions for the slot
  if (adDimensions.actual) {
    if (adDimensions.actual.width !== expectedDim.width || adDimensions.actual.height !== expectedDim.height) {
      issues.push(createMockIssue('warning', `Detected dimensions ${adDimensions.actual.width}x${adDimensions.actual.height}px do not match expected slot dimensions ${expectedDim.width}x${expectedDim.height}px.`));
    }
  }
  // Note: If adDimensions.actual is undefined, an error regarding the meta tag (missing or malformed) 
  // would have already been added to the 'issues' array by the logic above.

  // --- Existing mock checks (file size, clickTag, file structure) ---
  const isTooLarge = file.size > MOCK_MAX_FILE_SIZE;
  if (isTooLarge) {
    issues.push(createMockIssue('error', `File size exceeds limit (${(MOCK_MAX_FILE_SIZE / (1024*1024)).toFixed(1)}MB).`));
  }

  const hasClickTag = Math.random() > 0.3; // 70% chance of having clickTag
  if (!hasClickTag) {
    issues.push(createMockIssue('error', 'Missing or invalid clickTag implementation.'));
  }

  const validFileStructure = Math.random() > 0.2; // 80% chance of valid structure
  if (!validFileStructure) {
    issues.push(createMockIssue('error', 'Invalid file structure. Primary HTML file not found at root.'));
  }
  
  if (Math.random() < 0.10 && issues.length === 0) { // 10% chance of a random warning if no other issues
     issues.push(createMockIssue('warning', 'Creative uses deprecated JavaScript features.', 'Consider updating to modern ES6+ syntax for better performance and compatibility.'));
  }


  // --- Determine final status based on issues ---
  const hasErrors = issues.some(issue => issue.type === 'error');
  const hasWarnings = issues.some(issue => issue.type === 'warning');

  if (hasErrors) {
    status = 'error';
  } else if (hasWarnings) {
    status = 'warning';
  } else {
    status = 'success';
  }
  
  // If no errors/warnings yet, but file is large (but not over limit), add a warning for optimization
  if (status === 'success' && file.size > MOCK_MAX_FILE_SIZE * 0.75 && file.size <= MOCK_MAX_FILE_SIZE) {
    issues.push(createMockIssue('warning', 'File size is large, consider optimizing assets for faster loading.', `Current size: ${(file.size / (1024*1024)).toFixed(2)}MB.`));
    if (!hasErrors) status = 'warning'; // Ensure status becomes warning if it was success
  }


  return {
    id: `${file.name}-${Date.now()}`,
    fileName: file.name,
    status,
    issues,
    adDimensions, // This is now always populated
    fileStructureOk: validFileStructure,
    clickTagFound: hasClickTag,
    fileSize: file.size,
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
    // Initialize results with pending status
    const initialResults = selectedFiles.map(file => ({
      id: `${file.name}-${Date.now()}-pending`,
      fileName: file.name,
      status: 'validating' as ValidationResult['status'],
      issues: [],
      fileSize: file.size,
      maxFileSize: MOCK_MAX_FILE_SIZE,
      // adDimensions will be populated by mockValidateFile
    }));
    setValidationResults(initialResults);

    const resultsPromises = selectedFiles.map(file => mockValidateFile(file));
    
    // Process results as they come in for better UX
    for (let i = 0; i < resultsPromises.length; i++) {
      try {
        const result = await resultsPromises[i];
        setValidationResults(prevResults => 
          prevResults.map(pr => pr.fileName === result.fileName && pr.status === 'validating' ? result : pr)
        );
      } catch (error) {
        console.error("Validation error for file:", selectedFiles[i].name, error);
        const errorResult: ValidationResult = {
          id: `${selectedFiles[i].name}-${Date.now()}-error`,
          fileName: selectedFiles[i].name,
          status: 'error',
          issues: [createMockIssue('error', 'An unexpected error occurred during validation.')],
          fileSize: selectedFiles[i].size,
          adDimensions: MOCK_EXPECTED_DIMENSIONS.length > 0 ? { width: MOCK_EXPECTED_DIMENSIONS[0].width, height: MOCK_EXPECTED_DIMENSIONS[0].height } : undefined, // Basic fallback
        };
        setValidationResults(prevResults => 
          prevResults.map(pr => pr.fileName === selectedFiles[i].name && pr.status === 'validating' ? errorResult : pr)
        );
      }
    }
    
    setIsLoading(false);
    toast({
      title: "Validation Complete",
      description: `Processed ${selectedFiles.length} file(s). Check the report below.`,
    });
  };
  
  // Reset results when selected files change
  useEffect(() => {
    if (selectedFiles.length === 0) {
        setValidationResults([]);
    }
    // More sophisticated logic for preserving results for files that remain selected could be added here.
    // For now, if file selection changes, running validation again will clear and repopulate.
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

    