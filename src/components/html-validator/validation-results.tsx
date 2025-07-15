
"use client";

import type { ReactNode } from 'react';
import React, { useRef, useState } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import type { ValidationResult, ValidationIssue } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, AlertTriangle, FileText, Image as ImageIconLucide, Archive, LinkIcon, Download, Loader2, Info, MonitorPlay } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { BannerPreview } from './banner-preview';


interface ValidationResultsProps {
  results: ValidationResult[];
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

export function ValidationResults({ results, isLoading }: ValidationResultsProps) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const handleDownloadPdf = () => {
    const input = reportRef.current;
    if (input && results.length > 0) {
      setIsGeneratingPdf(true);
      html2canvas(input, { scale: 2, useCORS: true, logging: false, onclone: (doc) => {
          doc.querySelectorAll('[data-exclude-from-pdf="true"]').forEach(el => el.remove());
      }})
        .then((canvas) => {
          const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
          const pdfPageWidth = pdf.internal.pageSize.getWidth();
          const pdfPageHeight = pdf.internal.pageSize.getHeight();
          const canvasOriginalWidth = canvas.width;
          const canvasOriginalHeight = canvas.height;
          const leftMargin = 30; 
          const rightMargin = 30;
          const topMargin = 40; 
          const bottomMargin = 40;
          const imagePdfWidth = pdfPageWidth - leftMargin - rightMargin;
          const imageTotalPdfHeight = (canvasOriginalHeight * imagePdfWidth) / canvasOriginalWidth;
          let yPositionOnCanvas = 0;
          let currentYOnPdf = topMargin;

          pdf.setFontSize(18);
          pdf.text("Validation Report", pdfPageWidth / 2, currentYOnPdf, { align: "center" });
          currentYOnPdf += 30;

          while (yPositionOnCanvas < canvasOriginalHeight) {
            let spaceLeftOnPage = pdfPageHeight - currentYOnPdf - bottomMargin;
            if (spaceLeftOnPage <= 20) {
              pdf.addPage();
              currentYOnPdf = topMargin;
              spaceLeftOnPage = pdfPageHeight - topMargin - bottomMargin;
            }
            const remainingImageOverallPdfHeight = imageTotalPdfHeight * ((canvasOriginalHeight - yPositionOnCanvas) / canvasOriginalHeight);
            const chunkPdfHeight = Math.min(spaceLeftOnPage, remainingImageOverallPdfHeight);

            if (chunkPdfHeight <= 0.1) {
                if (yPositionOnCanvas < canvasOriginalHeight - 0.1 && (canvasOriginalHeight - yPositionOnCanvas) > 1 ) {
                    pdf.addPage();
                    currentYOnPdf = topMargin;
                    continue;
                }
                break;
            }

            const chunkCanvasHeight = (chunkPdfHeight / imageTotalPdfHeight) * canvasOriginalHeight;
            const safeChunkCanvasHeight = Math.max(0.1, Math.min(chunkCanvasHeight, canvasOriginalHeight - yPositionOnCanvas));

            if (safeChunkCanvasHeight <= 0.1) {
                if(yPositionOnCanvas < canvasOriginalHeight - 0.1 && (canvasOriginalHeight - yPositionOnCanvas) > 1 ) {
                    pdf.addPage();
                    currentYOnPdf = topMargin;
                    continue;
                }
                break;
            }
            
            const tempChunkCanvas = document.createElement('canvas');
            tempChunkCanvas.width = canvasOriginalWidth;
            tempChunkCanvas.height = safeChunkCanvasHeight;
            const tempCtx = tempChunkCanvas.getContext('2d');

            if (!tempCtx) {
              console.error("Failed to get 2D context for tempChunkCanvas");
              setIsGeneratingPdf(false);
              return;
            }

            tempCtx.drawImage(canvas,
              0, yPositionOnCanvas,
              canvasOriginalWidth, safeChunkCanvasHeight,
              0, 0,
              canvasOriginalWidth, safeChunkCanvasHeight
            );

            const chunkDataUrl = tempChunkCanvas.toDataURL('image/png');
            pdf.addImage(chunkDataUrl, 'PNG', leftMargin, currentYOnPdf, imagePdfWidth, chunkPdfHeight);
            yPositionOnCanvas += safeChunkCanvasHeight;
            currentYOnPdf += 5;
          }

          pdf.save('validation-report.pdf');
        })
        .catch(err => {
          console.error("Error generating PDF:", err);
        })
        .finally(() => {
          setIsGeneratingPdf(false);
        });
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
          <Button onClick={handleDownloadPdf} disabled={isGeneratingPdf} variant="outline" size="sm">
            {isGeneratingPdf ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating PDF...</>
            ) : (
              <><Download className="mr-2 h-4 w-4" /> Download Report</>
            )}
          </Button>
        )}
      </div>
      <div ref={reportRef}>
        {results.map(result => {
          // Diagnostic Log
          console.log(`[DIAG_RENDER] Rendering report for ${result.fileName}. Preview data:`, result.preview);
          
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

          return (
            <Card key={result.id} className="shadow-lg overflow-hidden mb-6">
              <CardHeader className={`flex flex-row items-center justify-between space-y-0 p-4 ${headerBgClass} ${headerTextClass}`}>
                <div className="min-w-0">
                  <CardTitle className={`text-lg font-semibold truncate ${headerTextClass}`} title={result.fileName}>{result.fileName}</CardTitle>
                  <CardDescription className={`text-xs ${headerTextClass} opacity-80`}>Validation Status</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                    {result.preview ? (
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="secondary" size="sm" data-exclude-from-pdf="true" className="h-8">
                                    <MonitorPlay className="w-4 h-4 mr-2" /> Preview
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
                                <DialogHeader className="p-4 border-b">
                                    <DialogTitle>Live Preview: {result.fileName}</DialogTitle>
                                </DialogHeader>
                                <div className="flex-grow overflow-auto">
                                   <BannerPreview result={result.preview} />
                                </div>
                            </DialogContent>
                        </Dialog>
                    ) : (
                      // Diagnostic: Show why button is missing
                      <div className="text-xs opacity-70" data-exclude-from-pdf="true">[No Preview]</div>
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
                        <p className="text-muted-foreground">{result.fileStructureOk ? 'Valid (HTML found)' : 'Invalid (HTML not found)'}</p>
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
                    <ScrollArea className="h-[200px] w-full rounded-md border">
                      <Accordion type="multiple" className="w-full bg-card">
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
