
"use client";

import React, { useState, useEffect } from 'react';
import type { ValidationResult, PreviewResult } from '@/types';
import { useToast } from "@/hooks/use-toast";
import { ValidationResults } from './validation-results';
import { FileUploader } from './file-uploader';
import { processAndCacheFile } from '@/actions/preview-actions';
import { runClientSideValidation } from '@/lib/client-validator';

export function Validator() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleValidate = async () => {
    console.log("Preview and Font Type Formats Fixing_2");
    if (selectedFiles.length === 0) {
      toast({ title: "No file selected", description: "Please select one or more ZIP files.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    // Initialize results with a pending state
    setValidationResults(selectedFiles.map(file => ({
      id: `${file.name}-${file.lastModified}`,
      fileName: file.name,
      status: 'pending',
      issues: [],
      preview: null
    })));

    const allResults: ValidationResult[] = [];

    for (const file of selectedFiles) {
      try {
        console.log(`[DIAG_VALIDATE] Start processing file: ${file.name}`);

        // Perform client-side analysis first
        const validationPart = await runClientSideValidation(file);
        console.log(`[DIAG_VALIDATE] Client-side analysis complete for ${file.name}. Issues found: ${validationPart.issues.length}`);

        // Then, process for preview (server action)
        const formData = new FormData();
        formData.append('file', file);
        const previewOutcome = await processAndCacheFile(formData);
        console.log(`[DIAG_VALIDATE] Server action 'processAndCacheFile' outcome for ${file.name}:`, previewOutcome);

        let previewResult: PreviewResult | null = null;
        if (previewOutcome && 'previewId' in previewOutcome) {
          previewResult = {
            id: previewOutcome.previewId,
            fileName: file.name,
            entryPoint: previewOutcome.entryPoint,
            securityWarning: previewOutcome.securityWarning
          };
          console.log(`[DIAG_VALIDATE] Successfully created previewResult object for ${file.name}`);
        } else if (previewOutcome && 'error' in previewOutcome) {
          console.error(`[DIAG_VALIDATE] Preview error for ${file.name}:`, previewOutcome.error);
          toast({ title: `Preview Error for ${file.name}`, description: previewOutcome.error, variant: "destructive" });
        } else {
            console.error(`[DIAG_VALIDATE] Unknown error from preview action for ${file.name}. Outcome:`, previewOutcome);
        }

        // Combine client-side validation with server-side preview result
        const finalResult: ValidationResult = {
          id: `${file.name}-${file.lastModified}`,
          fileName: file.name,
          fileSize: file.size,
          ...validationPart,
          preview: previewResult,
        };
        
        console.log(`[DIAG_VALIDATE] Final combined result for ${file.name}:`, JSON.parse(JSON.stringify(finalResult)));
        allResults.push(finalResult);

      } catch (error) {
        console.error(`[DIAG_VALIDATE] CRITICAL validation failed for ${file.name}:`, error);
        toast({ title: `Validation Error for ${file.name}`, description: "An unexpected error occurred during processing.", variant: "destructive" });
        // Create a result object even on critical failure
        allResults.push({
          id: `${file.name}-${file.lastModified}`,
          fileName: file.name,
          fileSize: file.size,
          status: 'error',
          issues: [{
            id: `client-critical-${Date.now()}`,
            type: 'error',
            message: 'File processing failed unexpectedly.',
            details: error instanceof Error ? error.message : String(error)
          }],
          preview: null
        });
      }
    }

    console.log(`[DIAG_VALIDATE] All files processed. Updating state with ${allResults.length} results.`);
    setValidationResults(allResults);
    setIsLoading(false);
    
    if (allResults.length > 0) {
      toast({ title: "Analysis Complete", description: `Processed ${allResults.length} file(s). Check the report below.` });
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
