"use client";

import type { ChangeEvent, DragEvent } from 'react';
import React, { useState, useRef }from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UploadCloud, Archive, XCircle, Loader2 } from 'lucide-react';

interface FileUploaderProps {
  selectedFiles: File[];
  setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>;
  onValidate: () => void;
  isLoading: boolean;
}

export function FileUploader({ selectedFiles, setSelectedFiles, onValidate, isLoading }: FileUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const newFiles = Array.from(event.target.files).filter(file => file.type === 'application/zip' || file.type === 'application/x-zip-compressed');
      // Prevent duplicates by name, simple check
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
    if (!isDragging) setIsDragging(true); // Ensure it's set if entered quickly
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

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl">Upload Creative Assets</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div
          className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg transition-colors
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
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <p className="text-xs text-muted-foreground mt-2">Only .zip files are accepted.</p>
        </div>

        {selectedFiles.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-md font-medium text-foreground">Selected Files:</h3>
            <ScrollArea className="h-40 w-full rounded-md border p-3 bg-secondary/30">
              <ul className="space-y-2">
                {selectedFiles.map(file => (
                  <li
                    key={`${file.name}-${file.lastModified}`}
                    className="flex items-center justify-between p-2 bg-card rounded-md shadow-sm"
                  >
                    <div className="flex items-center space-x-2 overflow-hidden">
                      <Archive className="w-5 h-5 text-primary flex-shrink-0" />
                      <span className="text-sm text-foreground truncate" title={file.name}>{file.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveFile(file.name)}
                      aria-label={`Remove ${file.name}`}
                    >
                      <XCircle className="w-4 h-4" />
                    </Button>
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
              Validating...
            </>
          ) : (
            'Validate Files'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
