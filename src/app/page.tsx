
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

// Simulate a wider range of possible actual dimensions that could be in a meta tag
const POSSIBLE_ACTUAL_DIMENSIONS_FROM_META = [
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

const mockValidateFile = async (file: File): Promise<ValidationResult> => {
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1500)); // Simulate network delay

  const issues: ValidationIssue[] = [];
  let status: ValidationResult['status'] = 'success'; // Assume success initially
  
  let actualMetaWidth: number | undefined = undefined;
  let actualMetaHeight: number | undefined = undefined;
  let simulatedMetaTagContentString: string | null = null; // Store what the meta tag content would be

  const metaTagScenario = Math.random();

  if (metaTagScenario < 0.05) { // 5% chance meta tag is completely missing
    simulatedMetaTagContentString = null; // Representing missing tag
    issues.push(createMockIssue('error', 'Required ad.size meta tag not found in HTML.', 'Ensure <meta name="ad.size" content="width=XXX,height=XXX"> is present.'));
  } else if (metaTagScenario < 0.15) { // 10% chance meta tag is present but malformed
    const malformType = Math.random();
    if (malformType < 0.25) simulatedMetaTagContentString = "width=300,height=BAD";
    else if (malformType < 0.50) simulatedMetaTagContentString = "width=300";
    else if (malformType < 0.75) simulatedMetaTagContentString = "height=250";
    else simulatedMetaTagContentString = "size=300x250"; // Another common malformed type
    
    issues.push(createMockIssue('error', 'Invalid ad.size meta tag format.', `Meta tag content found: "${simulatedMetaTagContentString}". Expected format: "width=XXX,height=XXX".`));
  } else { // 85% chance meta tag is present and notionally parsable
    // Pick one of the possible actual dimensions to simulate what's in the file's meta tag
    const chosenActualDim = POSSIBLE_ACTUAL_DIMENSIONS_FROM_META[Math.floor(Math.random() * POSSIBLE_ACTUAL_DIMENSIONS_FROM_META.length)];
    simulatedMetaTagContentString = `width=${chosenActualDim.width},height=${chosenActualDim.height}`;
    
    // "Parse" the simulatedMetaTagContentString
    // This regex is a simplified parser for "width=XXX,height=YYY"
    const match = simulatedMetaTagContentString.match(/width=(\d+),height=(\d+)/);
    if (match && match[1] && match[2]) {
      const wVal = parseInt(match[1], 10);
      const hVal = parseInt(match[2], 10);
      if (!isNaN(wVal) && !isNaN(hVal)) {
        actualMetaWidth = wVal;
        actualMetaHeight = hVal;
      } else {
        // This case should be rare given the regex, but as a fallback:
        issues.push(createMockIssue('error', 'Invalid numeric values in ad.size meta tag.', `Parsed non-numeric values from: "${simulatedMetaTagContentString}"`));
        simulatedMetaTagContentString = `width=NUM_ERR,height=NUM_ERR`; // Mark as effectively malformed
      }
    } else {
       // If regex doesn't match, it's malformed (should have been caught by earlier scenario, but good to be robust)
       issues.push(createMockIssue('error', 'Malformed ad.size meta tag content.', `Content: "${simulatedMetaTagContentString}". Expected "width=XXX,height=YYY".`));
       simulatedMetaTagContentString = `width=MALFORMED,height=MALFORMED`; // Mark as effectively malformed
    }
  }

  // Determine expected dimensions (e.g., from campaign settings for the ad slot)
  const expectedDim = MOCK_EXPECTED_DIMENSIONS[Math.floor(Math.random() * MOCK_EXPECTED_DIMENSIONS.length)];

  // Populate adDimensions for the report.
  const adDimensions: ValidationResult['adDimensions'] = {
    width: expectedDim.width, // Expected width for the ad slot
    height: expectedDim.height, // Expected height for the ad slot
    actual: (actualMetaWidth !== undefined && actualMetaHeight !== undefined)
            ? { width: actualMetaWidth, height: actualMetaHeight }
            : undefined, // Actual dimensions "parsed" from the creative's meta tag
  };

  // Add warning if actual detected dimensions (from a valid meta tag) don't match expected slot dimensions
  if (adDimensions.actual) { // This implies the meta tag was found, parsable, and yielded actual dimensions
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
    adDimensions, // This is now always populated, actual may be undefined if meta tag issues
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
      adDimensions: { // Provide a default structure for adDimensions
        width: 0, // Placeholder, will be overwritten by mockValidateFile
        height: 0, // Placeholder
        actual: undefined
      }
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
           adDimensions: { // Fallback adDimensions
            width: MOCK_EXPECTED_DIMENSIONS.length > 0 ? MOCK_EXPECTED_DIMENSIONS[0].width : 0,
            height: MOCK_EXPECTED_DIMENSIONS.length > 0 ? MOCK_EXPECTED_DIMENSIONS[0].height : 0,
            actual: undefined
          },
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
