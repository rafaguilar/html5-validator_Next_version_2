
"use client";

import type { ReactNode } from 'react';
import React, { useRef, useState } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import type { ValidationResult, ValidationIssue, ClickTagInfo } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, AlertTriangle, FileText, Image as ImageIconLucide, Archive, ExternalLink, Info, LinkIcon, Download, Loader2, Eye } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
// Image component from next/image is removed as previews are not part of v1.1.0

interface ValidationResultsProps {
  results: ValidationResult[];
  isLoading: boolean;
}

const StatusIcon = ({ status }: { status: ValidationResult['status'] }) => {
  // Color will be determined by parent's text color (e.g., text-destructive-foreground)
  const commonClass = "w-5 h-5";
  switch (status) {
    case 'success':
      return <CheckCircle2 className={commonClass} />;
    case 'error':
      return <XCircle className={commonClass} />;
    case 'warning':
      return <AlertTriangle className={commonClass} />;
    default:
      return <Info className={commonClass} />; // For pending/validating
  }
};

const IssueIcon = ({ type }: { type: ValidationIssue['type'] }) => {
  switch (type) {
    case 'error':
      return <XCircle className="w-4 h-4 text-destructive mr-2 flex-shrink-0" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-accent mr-2 flex-shrink-0" />;
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
      // Ensure the element is fully visible and rendered for html2canvas
      // For example, temporarily expand its container or scroll it into view if necessary.
      // This example assumes 'input' (reportRef.current) is the complete element to capture.

      html2canvas(input, {
        scale: 2, // Higher scale can improve quality but increases canvas size
        useCORS: true,
        logging: false, // Set to true for html2canvas debugging
        // Consider adding width/height if content overflows visually but not scroll-wise
        // windowWidth: input.scrollWidth,
        // windowHeight: input.scrollHeight,
      })
        .then((canvas) => {
          const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'pt',
            format: 'a4',
          });

          const pdfPageWidth = pdf.internal.pageSize.getWidth();
          const pdfPageHeight = pdf.internal.pageSize.getHeight();

          const canvasOriginalWidth = canvas.width;
          const canvasOriginalHeight = canvas.height;

          const leftMargin = 30; 
          const rightMargin = 30;
          const topMargin = 40; 
          const bottomMargin = 40;

          // Calculate the width the image will take on the PDF page
          const imagePdfWidth = pdfPageWidth - leftMargin - rightMargin;
          // Calculate the total height the image would span on the PDF if rendered continuously, maintaining aspect ratio
          const imageTotalPdfHeight = (canvasOriginalHeight * imagePdfWidth) / canvasOriginalWidth;

          let yPositionOnCanvas = 0; // Current Y position on the source canvas
          let currentYOnPdf = topMargin; // Current Y position on the PDF page

          // Add title to the first page
          pdf.setFontSize(18);
          pdf.text("Validation Report", pdfPageWidth / 2, currentYOnPdf, { align: "center" });
          currentYOnPdf += 30; // Space after title

          while (yPositionOnCanvas < canvasOriginalHeight) {
            // Calculate available vertical space on the current PDF page
            let spaceLeftOnPage = pdfPageHeight - currentYOnPdf - bottomMargin;

            if (spaceLeftOnPage <= 20) { // If very little space (e.g., less than 20pt), or if new page needed
              pdf.addPage();
              currentYOnPdf = topMargin; // Reset Y for the new page
              spaceLeftOnPage = pdfPageHeight - topMargin - bottomMargin; // Full content height available
            }

            // Determine the height of the current chunk on the PDF
            // This is the minimum of the space left on the page, or the remaining total PDF height of the image
            const remainingImageOverallPdfHeight = imageTotalPdfHeight * ((canvasOriginalHeight - yPositionOnCanvas) / canvasOriginalHeight);
            const chunkPdfHeight = Math.min(spaceLeftOnPage, remainingImageOverallPdfHeight);

            if (chunkPdfHeight <= 0.1) { // Threshold to prevent tiny or zero-height chunks
                 if (yPositionOnCanvas < canvasOriginalHeight - 0.1 && (canvasOriginalHeight - yPositionOnCanvas) > 1 ) { // If significant canvas is left
                    pdf.addPage();
                    currentYOnPdf = topMargin;
                    continue; // Restart logic for new page
                }
                break; // No more content to draw or space is too small
            }

            // Calculate the corresponding height on the source canvas for this chunk
            // (chunkPdfHeight / imageTotalPdfHeight) is the fraction of total image this chunk represents
            const chunkCanvasHeight = (chunkPdfHeight / imageTotalPdfHeight) * canvasOriginalHeight;
            
            // Ensure we don't try to read past the end of the canvas or create a malformed chunk
            const safeChunkCanvasHeight = Math.max(0.1, Math.min(chunkCanvasHeight, canvasOriginalHeight - yPositionOnCanvas));

             if (safeChunkCanvasHeight <= 0.1) {
                 if(yPositionOnCanvas < canvasOriginalHeight - 0.1 && (canvasOriginalHeight - yPositionOnCanvas) > 1 ) {
                    pdf.addPage();
                    currentYOnPdf = topMargin;
                    continue;
                }
                break;
            }
            
            // Create a temporary canvas for the current chunk
            const tempChunkCanvas = document.createElement('canvas');
            tempChunkCanvas.width = canvasOriginalWidth;
            tempChunkCanvas.height = safeChunkCanvasHeight;
            const tempCtx = tempChunkCanvas.getContext('2d');

            if (!tempCtx) {
              console.error("Failed to get 2D context for tempChunkCanvas");
              setIsGeneratingPdf(false);
              return;
            }

            // Draw the segment from the main captured canvas to the temporary chunk canvas
            tempCtx.drawImage(canvas,
              0, yPositionOnCanvas,             // Source X, Y on main canvas
              canvasOriginalWidth, safeChunkCanvasHeight, // Source W, H on main canvas
              0, 0,                             // Destination X, Y on tempChunkCanvas
              canvasOriginalWidth, safeChunkCanvasHeight // Destination W, H on tempChunkCanvas
            );

            const chunkDataUrl = tempChunkCanvas.toDataURL('image/png');

            // Add the chunk image to the PDF
            pdf.addImage(
              chunkDataUrl,
              'PNG',
              leftMargin,       // X position on PDF page
              currentYOnPdf,    // Y position on PDF page
              imagePdfWidth,    // Width on PDF page (fixed to maintain aspect ratio with chunkPdfHeight)
              chunkPdfHeight    // Height on PDF page (calculated to maintain aspect ratio of this chunk)
            );

            yPositionOnCanvas += safeChunkCanvasHeight; // Advance Y position on the source canvas
            currentYOnPdf += chunkPdfHeight + 5; // Advance Y position on PDF, add small padding
          }

          pdf.save('validation-report.pdf');
        })
        .catch(err => {
          console.error("Error generating PDF:", err);
          // Optionally, show a toast message to the user about the error
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
          <p className="text-sm text-muted-foreground">Upload files and click "Validate" to see the results here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-8 space-y-6" >
      <div className="flex justify-between items-center" id="report-header-to-exclude">
        <h2 className="text-2xl font-semibold text-foreground">Validation Report</h2>
        {results.length > 0 && !results.some(r => r.status === 'pending' || r.status === 'validating') && (
          <Button
            onClick={handleDownloadPdf}
            disabled={isGeneratingPdf}
            variant="outline"
            size="sm"
          >
            {isGeneratingPdf ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating PDF...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download PDF
              </>
            )}
          </Button>
        )}
      </div>
      <div ref={reportRef}>
        {results.map(result => {
          let headerBgClass = 'bg-muted/30';
          let headerTextClass = 'text-foreground'; // Default text for pending/validating
          let badgeTextClass = 'text-foreground';

          if (result.status === 'success') {
            headerBgClass = 'bg-success';
            headerTextClass = 'text-success-foreground';
            badgeTextClass = 'text-success-foreground';
          } else if (result.status === 'error') {
            headerBgClass = 'bg-destructive';
            headerTextClass = 'text-destructive-foreground';
            badgeTextClass = 'text-destructive-foreground';
          } else if (result.status === 'warning') {
            headerBgClass = 'bg-accent';
            headerTextClass = 'text-accent-foreground';
            badgeTextClass = 'text-accent-foreground';
          }

          return (
            <Card key={result.id} className="shadow-lg overflow-hidden mb-6">
              <CardHeader className={`flex flex-row items-center justify-between space-y-0 p-4 ${headerBgClass} ${headerTextClass}`}>
                <div className="min-w-0">
                  <CardTitle className={`text-lg font-semibold truncate ${headerTextClass}`} title={result.fileName}>
                    {result.fileName}
                  </CardTitle>
                  <CardDescription className={`text-xs ${headerTextClass} opacity-80`}>
                    Validation Status
                  </CardDescription>
                </div>
                <div className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${badgeTextClass}`}>
                  <StatusIcon status={result.status} />
                  <span className="ml-2 capitalize">{result.status}</span>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  {result.adDimensions && (
                    <div className="flex items-start p-3 bg-secondary/30 rounded-md">
                      <ImageIconLucide className="w-5 h-5 text-primary mr-3 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">Ad Dimensions</p>
                        <p className="text-muted-foreground">
                          {result.adDimensions.actual ?
                           `Detected: ${result.adDimensions.actual.width}x${result.adDimensions.actual.height}px ` : ''}
                           {(result.adDimensions.width && result.adDimensions.height && (!result.adDimensions.actual || (result.adDimensions.actual.width !== result.adDimensions.width || result.adDimensions.actual.height !== result.adDimensions.height))) ?
                           `(Expected: ${result.adDimensions.width}x${result.adDimensions.height}px)`: result.adDimensions.actual ? '' : 'Not specified'}
                        </p>
                      </div>
                    </div>
                  )}
                  {typeof result.fileStructureOk === 'boolean' && (
                    <div className="flex items-start p-3 bg-secondary/30 rounded-md">
                      {result.fileStructureOk ? <CheckCircle2 className="w-5 h-5 text-green-500 mr-3 mt-0.5 flex-shrink-0" /> : <XCircle className="w-5 h-5 text-destructive mr-3 mt-0.5 flex-shrink-0" />}
                      <div>
                        <p className="font-medium text-foreground">File Structure</p>
                        <p className="text-muted-foreground">{result.fileStructureOk ? 'Valid' : 'Invalid'}</p>
                      </div>
                    </div>
                  )}
                  {result.fileSize && (
                     <div className="flex items-start p-3 bg-secondary/30 rounded-md">
                      <Archive className="w-5 h-5 text-primary mr-3 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">File Size</p>
                        <p className="text-muted-foreground">
                          {formatBytes(result.fileSize)}
                          {result.maxFileSize && ` (Max: ${formatBytes(result.maxFileSize)})`}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Banner Preview Section Removed for v1.1.0 */}

                {result.detectedClickTags && result.detectedClickTags.length > 0 && (
                  <div>
                    <h4 className="text-md font-medium text-foreground mb-2 flex items-center">
                      <LinkIcon className="w-4 h-4 mr-2 text-primary" /> Detected ClickTags:
                    </h4>
                    <ul className="list-disc list-inside pl-4 space-y-1 text-sm bg-secondary/30 p-3 rounded-md">
                      {result.detectedClickTags.map(ct => (
                        <li key={ct.name} className="text-muted-foreground">
                          <span className="font-medium text-foreground">{ct.name}:</span> {ct.url}
                          {!ct.isHttps && <Badge variant="outline" className="ml-2 border-accent text-accent">Non-HTTPS</Badge>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.hasCorrectTopLevelClickTag && (
                  <div className="mt-2 text-sm text-green-600 flex items-center p-3 bg-green-500/10 rounded-md">
                    <CheckCircle2 className="w-5 h-5 mr-2 flex-shrink-0 text-green-500" />
                    Correct top-level clickTag (named 'clickTag' with HTTPS URL) detected.
                  </div>
                )}


                {result.issues.length > 0 && (
                  <div>
                    <h4 className="text-md font-medium text-foreground mb-2">Issues Found ({result.issues.length}):</h4>
                    <ScrollArea className="h-[200px] w-full rounded-md border">
                    <Accordion type="multiple" className="w-full bg-card">
                      {result.issues.map(issue => (
                        <AccordionItem value={issue.id} key={issue.id}>
                          <AccordionTrigger className="px-4 py-3 text-sm hover:bg-muted/50 transition-colors">
                            <div className="flex items-center">
                              <IssueIcon type={issue.type} />
                              <span className="font-medium capitalize mr-2">{issue.type}:</span>
                              <span className="text-foreground text-left">{issue.message}</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="px-4 pb-3 pt-1 text-sm text-muted-foreground bg-secondary/20">
                            {issue.details || 'No additional details.'}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                    </ScrollArea>
                  </div>
                )}
                {result.issues.length === 0 && result.status !== 'pending' && result.status !== 'validating' && !result.hasCorrectTopLevelClickTag && (
                  <div className="text-sm text-green-600 flex items-center p-3 bg-green-500/10 rounded-md">
                    <CheckCircle2 className="w-5 h-5 mr-2 flex-shrink-0 text-green-500"/>
                    No issues found. This creative meets the requirements.
                  </div>
                )}
                 {result.issues.length === 0 && result.status === 'success' && result.hasCorrectTopLevelClickTag && (
                  <div className="text-sm text-green-600 flex items-center p-3 bg-green-500/10 rounded-md">
                    <CheckCircle2 className="w-5 h-5 mr-2 flex-shrink-0 text-green-500"/>
                    Creative meets requirements.
                  </div>
                )}
              </CardContent>
              {result.status === 'pending' && (
                 <CardFooter className="p-4 bg-muted/30">
                    <p className="text-sm text-muted-foreground">Awaiting validation...</p>
                 </CardFooter>
              )}
               {result.status === 'validating' && (
                 <CardFooter className="p-4 bg-primary/10">
                    <div className="flex items-center text-sm text-primary">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Currently validating...
                    </div>
                 </CardFooter>
              )}
            </Card>
          )
        })}
      </div>
      {results.length > 0 && !results.some(r => r.status === 'pending' || r.status === 'validating') && (
        <div className="mt-8 pt-6 border-t border-border text-muted-foreground text-xs">
          <h5 className="font-semibold text-sm mb-2 text-foreground">ClickTag Identification Limitations:</h5>
          <p className="mb-1">Identification of clickTags via HTML parsing may fail for:</p>
          <ul className="list-disc list-inside pl-4 space-y-0.5">
            <li>Minified or obfuscated JavaScript.</li>
            <li>ClickTag URLs constructed dynamically (e.g., from multiple variables).</li>
            <li>More complex JavaScript assignment patterns.</li>
            <li>ClickTags defined in ways other than simple variable assignments.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
