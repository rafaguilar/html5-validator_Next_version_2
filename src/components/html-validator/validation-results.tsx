"use client";

import type { ReactNode } from 'react';
import React from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import type { ValidationResult, ValidationIssue } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, AlertTriangle, FileText, Image as ImageIconLucide, Archive, LinkIcon, Download, Loader2, Info, MonitorPlay, Code2, Share2, Play, Pause } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { BannerPreview } from './banner-preview';
import { useToast } from '@/hooks/use-toast';
import { saveReport } from '@/services/report-service';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';


interface ValidationResultsProps {
  results?: ValidationResult[];
  isLoading: boolean;
}

const StatusIcon = ({ status }: { status: ValidationResult['status'] }) => {
  const commonClass = "w-5 h-5";
  switch (status) {
    case 'success':
      return <CheckCircle2 className={commonClass} />;
    case 'error':
      return <XCircle className={commonClass} />;
    case 'warning':
      return <AlertTriangle className={commonClass} />;
    default:
      return <Loader2 className={`${commonClass} animate-spin`} />; 
  }
};

const IssueIcon = ({ type }: { type: ValidationIssue['type'] }) => {
  switch (type) {
    case 'error':
      return <XCircle className="w-4 h-4 text-destructive mr-2 flex-shrink-0" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-accent mr-2 flex-shrink-0" />;
    case 'info':
      return <Info className="w-4 h-4 text-primary mr-2 flex-shrink-0" />;
    default:
      return <Info className="w-4 h-4 text-muted-foreground mr-2 flex-shrink-0" />;
  }
};

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const SourceCodeViewer = ({ source }: { source: string }) => {
  const lines = source.split('\n');
  return (
    <ScrollArea className="h-[60vh] w-full font-mono text-xs border rounded-md">
        <div className="p-4">
            <div className="flex">
                <div className="text-right text-muted-foreground pr-4 select-none">
                    {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
                </div>
                <pre className="whitespace-pre-wrap break-words">{source}</pre>
            </div>
        </div>
    </ScrollArea>
  );
};

const getGsapControlsInjection = () => {
    return `
        <script>
            document.addEventListener('DOMContentLoaded', function() {
                // Check if GSAP's main objects are available
                if (typeof window.gsap === 'undefined' && typeof window.TweenLite === 'undefined' && typeof window.TimelineLite === 'undefined') {
                    console.log('GSAP not detected on page.');
                    return;
                }
                
                var gsap = window.gsap || {};
                var TimelineLite = window.TimelineLite || gsap.timeline;
                var TweenLite = window.TweenLite || gsap;

                var globalTimeline;

                function exportAndPause() {
                    try {
                        if (gsap && typeof gsap.exportRoot === 'function') {
                           globalTimeline = gsap.exportRoot();
                        } else if (typeof TimelineLite.exportRoot === 'function') {
                           globalTimeline = TimelineLite.exportRoot();
                        } else {
                            console.error('GSAP exportRoot not found.');
                            return;
                        }

                        globalTimeline.pause();
                        
                        var playBtn = document.getElementById('studio-play-btn');
                        if (playBtn) playBtn.style.display = 'block';

                        var pauseBtn = document.getElementById('studio-pause-btn');
                        if (pauseBtn) pauseBtn.style.display = 'none';

                    } catch(e) {
                        console.error('Error exporting GSAP root timeline:', e);
                    }
                }
                
                var style = document.createElement('style');
                style.innerHTML = \`
                    #studio-controls { position: absolute; top: 5px; right: 5px; z-index: 99999; display: flex; gap: 5px; }
                    .studio-btn { width: 32px; height: 32px; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.4); border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; color: white; }
                    .studio-btn:hover { background: rgba(0,0,0,0.8); }
                    .studio-btn svg { width: 16px; height: 16px; }
                \`;
                document.head.appendChild(style);

                var controlsContainer = document.createElement('div');
                controlsContainer.id = 'studio-controls';

                var pauseBtn = document.createElement('button');
                pauseBtn.id = 'studio-pause-btn';
                pauseBtn.className = 'studio-btn';
                pauseBtn.title = 'Pause';
                pauseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
                pauseBtn.onclick = exportAndPause;

                var playBtn = document.createElement('button');
                playBtn.id = 'studio-play-btn';
                playBtn.className = 'studio-btn';
                playBtn.title = 'Play';
                playBtn.style.display = 'none';
                playBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
                playBtn.onclick = function() {
                    if (globalTimeline) {
                        globalTimeline.resume();
                        playBtn.style.display = 'none';
                        pauseBtn.style.display = 'block';
                    }
                };

                controlsContainer.appendChild(pauseBtn);
                controlsContainer.appendChild(playBtn);
                document.body.appendChild(controlsContainer);
            });
        </script>
    `;
};


export function ValidationResults({ results = [], isLoading }: ValidationResultsProps) {
  const reportRef = React.useRef<HTMLDivElement>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = React.useState(false);
  const [isSharing, setIsSharing] = React.useState(false);
  const { toast } = useToast();
  
  const [previewsState, setPreviewsState] = React.useState<Record<string, { refreshKey: number; controlsEnabled: boolean }>>({});

  React.useEffect(() => {
    // Initialize state for new results
    const newStates: Record<string, { refreshKey: number; controlsEnabled: boolean }> = {};
    results.forEach(result => {
      if (!previewsState[result.id]) {
        newStates[result.id] = { refreshKey: 0, controlsEnabled: false };
      }
    });
    if (Object.keys(newStates).length > 0) {
      setPreviewsState(prevState => ({ ...prevState, ...newStates }));
    }
  }, [results, previewsState]);

  const handleRefresh = (resultId: string) => {
    setPreviewsState(prevState => ({
      ...prevState,
      [resultId]: { ...prevState[resultId], refreshKey: (prevState[resultId]?.refreshKey || 0) + 1 },
    }));
  };

  const handleToggleControls = (resultId: string) => {
    setPreviewsState(prevState => ({
      ...prevState,
      [resultId]: { ...prevState[resultId], controlsEnabled: !prevState[resultId]?.controlsEnabled },
    }));
  };


  const handleDownloadPdf = async () => {
    const container = reportRef.current;
    if (!container || results.length === 0) return;
  
    setIsGeneratingPdf(true);
  
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pdfPageWidth = pdf.internal.pageSize.getWidth();
    const pdfPageHeight = pdf.internal.pageSize.getHeight();
    const margin = 30;
    const contentWidth = pdfPageWidth - margin * 2;
  
    let currentY = margin;
  
    const addCanvasToPdf = (canvas: HTMLCanvasElement) => {
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      const contentHeight = (canvasHeight * contentWidth) / canvasWidth;
  
      if (currentY + contentHeight > pdfPageHeight - margin && currentY > margin) {
        pdf.addPage();
        currentY = margin;
      }
  
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, currentY, contentWidth, contentHeight);
      currentY += contentHeight + 20;
    };
  
    const reportCards = Array.from(container.querySelectorAll('[data-report-card="true"]')) as HTMLElement[];
  
    for (const card of reportCards) {
      const elementsToHide = Array.from(card.querySelectorAll('[data-exclude-from-pdf="true"]')) as HTMLElement[];
      const issueArea = card.querySelector('[data-issues-scroll-area="true"]') as HTMLElement | null;
      
      elementsToHide.forEach(el => el.style.display = 'none');
      if (issueArea) {
        issueArea.classList.remove('max-h-[400px]');
      }
      
      try {
        const canvas = await html2canvas(card, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: null,
        });
        addCanvasToPdf(canvas);
      } catch (err) {
        console.error("Error generating canvas for a report card:", err);
      }
  
      elementsToHide.forEach(el => el.style.display = '');
      if (issueArea) {
        issueArea.classList.add('max-h-[400px]');
      }
    }
  
    pdf.save('validation-report.pdf');
    setIsGeneratingPdf(false);
  };
  
  const handleShare = async () => {
    if (results.length === 0) return;
    setIsSharing(true);
    try {
      // Need to pass the original results, not the stateful ones with injected code
      const originalResults = results.map(r => {
        if(r.preview){
            // This is a bit of a hack; ideally validator.tsx would also pass the original htmlContent
            const originalHtml = r.preview.processedHtml.split('<head><base href=')[0] + r.preview.processedHtml.split('</head>')[1];
             return {...r, preview: {...r.preview, processedHtml: originalHtml}}
        }
        return r;
      });

      const reportId = await saveReport(results); // Pass original data to save
      const url = `${window.location.origin}/report/${reportId}`;
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link Copied!",
        description: "A shareable link to the report has been copied to your clipboard.",
      });
    } catch (error) {
      console.error("[TRACE] Full error creating share link:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? `Could not create a shareable link: ${error.message}` : "Could not create a shareable link. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSharing(false);
    }
  };

  if (isLoading && results.length === 0) {
    return null;
  }

  if (!isLoading && results.length === 0) {
    return (
      <Card className="mt-8 shadow-md">
        <CardContent className="p-6 text-center">
          <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-lg font-medium text-foreground">No Validation Results Yet</p>
          <p className="text-sm text-muted-foreground">Upload a ZIP file and click "Validate & Preview" to see the report here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="flex justify-between items-center" id="report-header-to-exclude">
        <h2 className="text-2xl font-semibold text-foreground">Validation Report</h2>
        {results.length > 0 && !results.some(r => r.status === 'pending' || r.status === 'validating') && (
          <div className="flex gap-2">
            <Button onClick={handleShare} disabled={isSharing} variant="outline" size="sm">
              {isSharing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sharing...</>
              ) : (
                <><Share2 className="mr-2 h-4 w-4" /> Share</>
              )}
            </Button>
            <Button onClick={handleDownloadPdf} disabled={isGeneratingPdf} variant="outline" size="sm">
              {isGeneratingPdf ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating PDF...</>
              ) : (
                <><Download className="mr-2 h-4 w-4" /> Download Report</>
              )}
            </Button>
          </div>
        )}
      </div>
      <div ref={reportRef}>
        {(results || []).map(result => {
          
          const previewState = previewsState[result.id] || { refreshKey: 0, controlsEnabled: false };

          let headerBgClass = 'bg-muted/30';
          let headerTextClass = 'text-foreground';
          let badgeTextClass = 'text-foreground';

          if (result.status === 'success') {
            headerBgClass = 'bg-success'; headerTextClass = 'text-success-foreground'; badgeTextClass = 'text-success-foreground';
          } else if (result.status === 'error') {
            headerBgClass = 'bg-destructive'; headerTextClass = 'text-destructive-foreground'; badgeTextClass = 'text-destructive-foreground';
          } else if (result.status === 'warning') {
            headerBgClass = 'bg-accent'; headerTextClass = 'text-accent-foreground'; badgeTextClass = 'text-accent-foreground';
          }

          const sortedIssues = [...(result.issues || [])].sort((a, b) => {
            const order = { error: 0, warning: 1, info: 2 };
            return order[a.type] - order[b.type];
          });
          
          const defaultExpandedIssues = sortedIssues.map(issue => issue.id);

          let dimensionExplanation: React.ReactNode = null;
          if (result.adDimensions && !result.adDimensions.actual) {
            const errorDimensionRuleIds = ['meta-size-invalid-values', 'meta-size-malformed-content', 'meta-size-missing-no-filename', 'meta-size-no-html-no-filename', 'meta-size-fallback-guess', 'meta-size-defaulted'];
            const warningDimensionRuleIds = ['meta-size-missing-inferred-filename', 'meta-size-no-html-inferred-filename'];
            const hasErrorIssue = (result.issues || []).find(issue => issue.type === 'error' && issue.rule && errorDimensionRuleIds.includes(issue.rule));
            const hasWarningIssue = (result.issues || []).find(issue => issue.type === 'warning' && issue.rule && warningDimensionRuleIds.includes(issue.rule));
            if (hasErrorIssue) {
              dimensionExplanation = (<p className="text-xs text-destructive flex items-center mt-1"><XCircle className="w-3 h-3 mr-1 flex-shrink-0" />Effective dimensions from fallback/filename due to meta tag error.</p>);
            } else if (hasWarningIssue) {
              dimensionExplanation = (<p className="text-xs text-accent flex items-center mt-1"><AlertTriangle className="w-3 h-3 mr-1 flex-shrink-0" />Effective dimensions inferred from filename as meta tag was missing.</p>);
            }
          }

          const nonInfoIssuesCount = (result.issues || []).filter(issue => issue.type === 'error' || issue.type === 'warning').length;
          const onlyInfoIssuesExist = (result.issues || []).length > 0 && nonInfoIssuesCount === 0;
          
          const previewWithInjectedCode = result.preview ? {
            ...result.preview,
            processedHtml: previewState.controlsEnabled
              ? result.preview.processedHtml + getGsapControlsInjection()
              : result.preview.processedHtml,
            id: `${result.preview.id}-${previewState.refreshKey}-${previewState.controlsEnabled}`
          } : null;

          return (
            <Card key={result.id} className="shadow-lg overflow-hidden mb-8" data-report-card="true">
              <CardHeader className={`flex flex-row items-center justify-between space-y-0 p-4 ${headerBgClass} ${headerTextClass}`}>
                <div className="min-w-0">
                  <CardTitle className={`text-lg font-semibold truncate ${headerTextClass}`} title={result.fileName}>{result.fileName}</CardTitle>
                  <CardDescription className={`text-xs ${headerTextClass} opacity-80`}>Validation Status</CardDescription>
                </div>
                <div className="flex items-center gap-2" data-exclude-from-pdf="true">
                    {previewWithInjectedCode && (
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="secondary" size="sm" className="h-8">
                                    <MonitorPlay className="w-4 h-4 mr-2" /> Preview
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
                                <DialogHeader className="p-4 border-b">
                                    <DialogTitle>Live Preview: {result.fileName}</DialogTitle>
                                    <DialogDescription className="text-left flex justify-between items-center">
                                        <span>This is a sandboxed preview. Some functionality may differ from the final environment.</span>
                                        <div className="flex items-center space-x-2">
                                            <Switch
                                                id={`controls-switch-${result.id}`}
                                                checked={previewState.controlsEnabled}
                                                onCheckedChange={() => handleToggleControls(result.id)}
                                            />
                                            <Label htmlFor={`controls-switch-${result.id}`} className="text-xs">Animation Controls</Label>
                                        </div>
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="flex-grow overflow-auto">
                                   <BannerPreview result={previewWithInjectedCode} onRefresh={() => handleRefresh(result.id)} />
                                </div>
                            </DialogContent>
                        </Dialog>
                    )}
                    {result.htmlContent && (
                       <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="outline" size="sm" className="h-8 text-foreground">
                                    <Code2 className="w-4 h-4 mr-2" /> View Source
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                                <DialogHeader>
                                    <DialogTitle>Source: {result.htmlEntryPoint}</DialogTitle>
                                     <DialogDescription>
                                        This is the original HTML content from your file.
                                    </DialogDescription>
                                </DialogHeader>
                                <SourceCodeViewer source={result.htmlContent} />
                            </DialogContent>
                        </Dialog>
                    )}
                    <div className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${badgeTextClass}`}>
                      <StatusIcon status={result.status} /><span className="ml-2 capitalize">{result.status}</span>
                    </div>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  {result.adDimensions && (
                    <div className="flex items-start p-3 bg-secondary/30 rounded-md">
                      <ImageIconLucide className="w-5 h-5 text-primary mr-3 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">Ad Dimensions</p>
                        {result.adDimensions.actual ? (<p className="text-muted-foreground">Meta Tag: {result.adDimensions.actual.width}x{result.adDimensions.actual.height}px</p>) : (<p className="text-muted-foreground">Meta Tag: Not found or invalid</p>)}
                        <p className="text-muted-foreground">Effective: {result.adDimensions.width}x{result.adDimensions.height}px</p>
                        {dimensionExplanation}
                      </div>
                    </div>
                  )}
                  {typeof result.fileStructureOk === 'boolean' && (
                    <div className="flex items-start p-3 bg-secondary/30 rounded-md">
                      {result.fileStructureOk ? <CheckCircle2 className="w-5 h-5 text-green-500 mr-3 mt-0.5 flex-shrink-0" /> : <XCircle className="w-5 h-5 text-destructive mr-3 mt-0.5 flex-shrink-0" />}
                      <div>
                        <p className="font-medium text-foreground">File Structure</p>
                        <p className="text-muted-foreground">{result.fileStructureOk ? `Valid (Using ${result.htmlEntryPoint})` : 'Invalid (HTML not found)'}</p>
                      </div>
                    </div>
                  )}
                  {result.fileSize && (
                     <div className="flex items-start p-3 bg-secondary/30 rounded-md">
                      <Archive className="w-5 h-5 text-primary mr-3 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">File Size</p>
                        <p className="text-muted-foreground">{formatBytes(result.fileSize)}{result.maxFileSize && ` (Max: ${formatBytes(result.maxFileSize)})`}</p>
                      </div>
                    </div>
                  )}
                </div>

                {result.detectedClickTags && result.detectedClickTags.length > 0 && (
                  <div>
                    <h4 className="text-md font-medium text-foreground mb-2 flex items-center"><LinkIcon className="w-4 h-4 mr-2 text-primary" />Detected ClickTags:</h4>
                    <ul className="list-disc list-inside pl-4 space-y-1 text-sm bg-secondary/30 p-3 rounded-md">
                      {result.detectedClickTags.map(ct => (<li key={ct.name} className="text-muted-foreground"><span className="font-medium text-foreground">{ct.name}:</span> {ct.url}{!ct.isHttps && <Badge variant="outline" className="ml-2 border-accent text-accent">Non-HTTPS</Badge>}</li>))}
                    </ul>
                  </div>
                )}

                {result.hasCorrectTopLevelClickTag && nonInfoIssuesCount === 0 && (
                  <div className="mt-2 text-sm text-green-600 flex items-center p-3 bg-green-500/10 rounded-md"><CheckCircle2 className="w-5 h-5 mr-2 flex-shrink-0 text-green-500" />Correct top-level clickTag found.</div>
                )}

                {(sortedIssues || []).length > 0 && (
                  <div>
                    <h4 className="text-md font-medium text-foreground mb-2">Issues Found ({sortedIssues.length}):</h4>
                    <ScrollArea className="max-h-[400px] w-full rounded-md border" data-issues-scroll-area="true">
                      <Accordion type="multiple" defaultValue={defaultExpandedIssues} className="w-full bg-card">
                        {sortedIssues.map(issue => (
                          <AccordionItem value={issue.id} key={issue.id}>
                            <AccordionTrigger className="px-4 py-3 text-sm hover:bg-muted/50 transition-colors">
                              <div className="flex items-center"><IssueIcon type={issue.type} /><span className="font-medium capitalize mr-2">{issue.type}:</span><span className="text-foreground text-left">{issue.message}</span></div>
                            </AccordionTrigger>
                            <AccordionContent className="px-4 pb-3 pt-1 text-sm text-muted-foreground bg-secondary/20">{issue.details || 'No additional details.'}</AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </ScrollArea>
                  </div>
                )}
                
                {nonInfoIssuesCount === 0 && result.status !== 'pending' && result.status !== 'validating' && (
                  result.hasCorrectTopLevelClickTag ? (
                    <div className="text-sm text-green-600 flex items-center p-3 bg-green-500/10 rounded-md mt-2"><CheckCircle2 className="w-5 h-5 mr-2 flex-shrink-0 text-green-500"/>{onlyInfoIssuesExist ? "No errors or warnings. ClickTag OK. See info messages." : "Creative meets requirements. ClickTag OK."}</div>
                  ) : (
                    <div className="text-sm text-accent flex items-center p-3 bg-accent/10 rounded-md mt-2"><AlertTriangle className="w-5 h-5 mr-2 flex-shrink-0 text-accent"/>{onlyInfoIssuesExist ? "No errors or warnings. Standard clickTag not found. See info." : "No errors or warnings. Standard clickTag not found."}</div>
                  )
                )}

              </CardContent>
              {result.status === 'pending' && (<CardFooter className="p-4 bg-muted/30"><p className="text-sm text-muted-foreground">Awaiting validation...</p></CardFooter>)}
              {result.status === 'validating' && (<CardFooter className="p-4 bg-primary/10"><div className="flex items-center text-sm text-primary"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Currently validating...</div></CardFooter>)}
            </Card>
          )
        })}
      </div>
      {results.length > 0 && !results.some(r => r.status === 'pending' || r.status !== 'validating') && (
        <div className="mt-8 pt-6 border-t border-border text-muted-foreground text-xs">
          <h5 className="font-semibold text-sm mb-2 text-foreground">ClickTag Identification Limitations:</h5>
          <p className="mb-1">Identification of clickTags from inline HTML scripts may fail for:</p>
          <ul className="list-disc list-inside pl-4 space-y-0.5">
            <li>Minified or obfuscated JavaScript.</li>
            <li>ClickTag URLs constructed dynamically.</li>
            <li>ClickTags defined in external .js files.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
