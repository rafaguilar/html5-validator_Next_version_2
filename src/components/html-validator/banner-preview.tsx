
"use client";

import React, { useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import type { PreviewResult } from '@/types';

interface BannerPreviewProps {
  result: PreviewResult;
}

export function BannerPreview({ result }: BannerPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeKey, setIframeKey] = useState(Date.now());

  const handleRefresh = () => {
    setIframeKey(Date.now());
  };
  
  const previewUrl = `/api/preview/${result.id}/${result.entryPoint}`;

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
            <Button variant="outline" size="icon" onClick={handleRefresh} title="Refresh Preview">
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
           <iframe
              key={iframeKey}
              ref={iframeRef}
              src={previewUrl}
              sandbox="allow-scripts allow-same-origin"
              className="w-full h-full border-0"
              title={`Preview of ${result.fileName}`}
            />
        </div>
      </CardContent>
    </Card>
  );
}
