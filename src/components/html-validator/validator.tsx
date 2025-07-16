
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
    console.log("[TRACE] Validator.tsx: Component mounted. Preview and Font Type Formats Fixing_4");
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

        const previewOutcome = await response.json();

        if (!response.ok) {
            console.error(`[TRACE] Validator.tsx: Server returned an error for ${file.name}.`, previewOutcome.error);
            throw new Error(previewOutcome.error || 'Unknown error from process-file API');
        }

        if (previewOutcome && previewOutcome.previewId) {
          previewResult = {
            id: previewOutcome.previewId,
            fileName: file.name,
            entryPoint: previewOutcome.entryPoint,
            securityWarning: previewOutcome.securityWarning
          };
          console.log(`[TRACE] Validator.tsx: Successfully created previewResult object for ${file.name}`, previewResult);
        } else if (previewOutcome && previewOutcome.error) {
           console.warn(`[TRACE] Validator.tsx: Preview generation failed for ${file.name}.`, previewOutcome.error);
           toast({ title: `Preview Error for ${file.name}`, description: previewOutcome.error, variant: "destructive" });
        }

        const finalResult: ValidationResult = {
          id: `${file.name}-${file.lastModified}`,
          fileName: file.name,
          fileSize: file.size,
          ...validationPart,
          preview: previewResult,
        };
        console.log(`[TRACE] Validator.tsx: Combined client and server results for ${file.name}.`, finalResult);
        
        allResults.push(finalResult);

      } catch (error) {
        console.error(`[TRACE] Validator.tsx: CRITICAL error processing file ${file.name}.`, error);
        toast({ title: `Validation Error for ${file.name}`, description: "An unexpected error occurred during processing.", variant: "destructive" });
        allResults.push({
          id: `${file.name}-${file.lastModified}`,
          fileName: file.name,
          fileSize: file.size,
          status: 'error',
          issues: [{
            id: `api-critical-${Date.now()}`,
            type: 'error',
            message: 'File processing failed via API.',
            details: error instanceof Error ? error.message : String(error)
          }],
          preview: null
        });
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
