"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, ShieldAlert, Play, Pause, Loader2 } from 'lucide-react';
import type { PreviewResult } from '@/types';

interface BannerPreviewProps {
  result: PreviewResult;
  onRefresh: () => void;
  setIframeRef: (el: HTMLIFrameElement | null) => void;
  onTogglePlay: () => void;
  isPlaying: boolean;
  canControl: boolean | null;
}

export function BannerPreview({ 
  result, 
  onRefresh, 
  setIframeRef,
  onTogglePlay,
  isPlaying,
  canControl
}: BannerPreviewProps) {
  const [isLoading, setIsLoading] = React.useState(true);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);

  React.useEffect(() => {
    // Pass the ref up to the parent component
    if (iframeRef.current) {
      setIframeRef(iframeRef.current);
    }
  }, [setIframeRef]);
  
  const handleLoad = () => {
    setIsLoading(false);
  };
  
  const previewSrc = `/api/preview/${result.id}/${result.entryPoint}`;

  return (
    <Card className="shadow-none border-0 h-full flex flex-col">
      <CardHeader className="flex-shrink-0">
        <div className="flex justify-between items-start">
            <div>
                <CardTitle className="text-xl flex items-center gap-2">
                    Live Preview: {result.fileName}
                </CardTitle>
                <CardDescription>
                    A sandboxed preview of your creative.
                </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {canControl === true && (
                <Button variant="outline" size="sm" className="h-8" onClick={onTogglePlay}>
                    {isPlaying ? <Pause className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                    {isPlaying ? 'Pause' : 'Play'}
                </Button>
              )}
              {canControl === null && (
                  <Button variant="outline" size="sm" className="h-8 text-foreground" disabled>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Controls
                  </Button>
              )}
              <Button variant="outline" size="icon" onClick={() => { setIsLoading(true); onRefresh(); }} title="Refresh Preview">
                  <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
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
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-10 text-foreground">
                  <Loader2 className="w-10 h-10 animate-spin mb-4" />
                  <span className="text-lg">Loading Banner...</span>
              </div>
            )}
           <iframe
              ref={iframeRef}
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
