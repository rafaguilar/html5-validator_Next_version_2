"use client";

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, ShieldAlert, Loader2 } from 'lucide-react';
import type { PreviewResult } from '@/types';

interface BannerPreviewProps {
  result: PreviewResult;
  onRefresh: () => void;
  controlsEnabled: boolean;
}

export function BannerPreview({ result, onRefresh, controlsEnabled }: BannerPreviewProps) {
  const [isLoading, setIsLoading] = useState(true);

  const iframeKey = useMemo(() => `${result.id}-${Date.now()}`, [result.id, onRefresh]); // Key changes on refresh trigger

  const handleLoad = () => {
    setIsLoading(false);
  };
  
  const previewSrc = `/api/preview/${result.id}/${result.entryPoint}?enabled=${controlsEnabled}`;

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
            <Button variant="outline" size="icon" onClick={() => { setIsLoading(true); onRefresh(); }} title="Refresh Preview">
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
           {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 bg-opacity-90 z-10 text-white">
                  <Loader2 className="w-10 h-10 animate-spin mb-4" />
                  <span className="text-lg">Loading Banner...</span>
              </div>
            )}
           <iframe
              key={iframeKey}
              src={previewSrc}
              sandbox="allow-scripts allow-same-origin"
              className="w-full h-full border-0"
              title={`Preview of ${result.fileName}`}
              onLoad={handleLoad}
            />
        </div>
      </CardContent>
    </Card>
  );
}
