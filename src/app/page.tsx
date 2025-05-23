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
  let status: ValidationResult['status'] = 'success';
  
  // Mock common validation checks
  const isTooLarge = file.size > MOCK_MAX_FILE_SIZE;
  if (isTooLarge) {
    issues.push(createMockIssue('error', `File size exceeds limit (${(MOCK_MAX_FILE_SIZE / (1024*1024)).toFixed(1)}MB).`));
  }

  // Simulate dimension check (randomly pick one or none)
  let adDimensions: ValidationResult['adDimensions'] | undefined = undefined;
  const dimensionScenario = Math.random();
  if (dimensionScenario < 0.7) { // 70% chance to have dimension checks
    const expectedDim = MOCK_EXPECTED_DIMENSIONS[Math.floor(Math.random() * MOCK_EXPECTED_DIMENSIONS.length)];
    const actualDim = { // simulate detected dimensions
        width: expectedDim.width + (Math.random() > 0.8 ? (Math.random() > 0.5 ? 10 : -10) : 0), 
        height: expectedDim.height + (Math.random() > 0.8 ? (Math.random() > 0.5 ? 10 : -10) : 0)
    };
    adDimensions = { width: expectedDim.width, height: expectedDim.height, actual: actualDim };
    if (actualDim.width !== expectedDim.width || actualDim.height !== expectedDim.height) {
        issues.push(createMockIssue('warning', `Detected dimensions ${actualDim.width}x${actualDim.height}px do not match expected ${expectedDim.width}x${expectedDim.height}px.`));
    }
  }


  const hasClickTag = Math.random() > 0.3; // 70% chance of having clickTag
  if (!hasClickTag) {
    issues.push(createMockIssue('error', 'Missing or invalid clickTag implementation.'));
  }

  const validFileStructure = Math.random() > 0.2; // 80% chance of valid structure
  if (!validFileStructure) {
    issues.push(createMockIssue('error', 'Invalid file structure. Primary HTML file not found at root.'));
  }
  
  if (Math.random() < 0.15 && issues.length === 0) { // 15% chance of a random warning if no errors
     issues.push(createMockIssue('warning', 'Creative uses deprecated JavaScript features.', 'Consider updating to modern ES6+ syntax.'));
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
  
  // If success, but file is large (but not over limit), add a warning for optimization
  if (status === 'success' && file.size > MOCK_MAX_FILE_SIZE * 0.8 && file.size <= MOCK_MAX_FILE_SIZE) {
    issues.push(createMockIssue('warning', 'File size is large, consider optimizing assets.', `Current size: ${(file.size / (1024*1024)).toFixed(2)}MB.`));
    status = 'warning';
  }


  return {
    id: `${file.name}-${Date.now()}`,
    fileName: file.name,
    status,
    issues,
    adDimensions,
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
    }));
    setValidationResults(initialResults);

    const results: ValidationResult[] = [];
    for (const file of selectedFiles) {
      try {
        const result = await mockValidateFile(file);
        results.push(result);
        // Update results incrementally
        setValidationResults(prevResults => prevResults.map(pr => pr.fileName === file.name ? result : pr));
      } catch (error) {
        console.error("Validation error for file:", file.name, error);
        const errorResult: ValidationResult = {
          id: `${file.name}-${Date.now()}-error`,
          fileName: file.name,
          status: 'error',
          issues: [createMockIssue('error', 'An unexpected error occurred during validation.')],
          fileSize: file.size,
        };
        results.push(errorResult);
        setValidationResults(prevResults => prevResults.map(pr => pr.fileName === file.name ? errorResult : pr));
      }
    }
    
    // Final update after all files are processed (optional, if incremental is good)
    // setValidationResults(results);
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
    } else {
        // Optionally, keep results if some files remain, or clear always.
        // For now, let's clear if the set of files is different.
        // This logic could be refined to only remove results for files no longer selected.
        // A simple approach: if selected files change, reset to "pending" or clear results.
        const currentFileNames = new Set(selectedFiles.map(f => f.name));
        const resultsToKeep = validationResults.filter(r => currentFileNames.has(r.fileName));
        if(resultsToKeep.length !== validationResults.length || selectedFiles.length !== resultsToKeep.length) {
          // If files were removed or added, and validation was already run, reset.
          // Or, just keep relevant results. For now, a simple reset if selection changes much.
          // This part can be complex, for now we'll clear results if the file list changes significantly
          // or if files are removed after validation.
          // A better UX might keep results for files that are still selected.
        }
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
