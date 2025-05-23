"use client";

import type { ValidationResult, ValidationIssue } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, AlertTriangle, FileText, Image as ImageIcon, Archive, ExternalLink, Info } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ValidationResultsProps {
  results: ValidationResult[];
  isLoading: boolean;
}

const StatusIcon = ({ status }: { status: ValidationResult['status'] }) => {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    case 'error':
      return <XCircle className="w-5 h-5 text-destructive" />;
    case 'warning':
      return <AlertTriangle className="w-5 h-5 text-yellow-500" />; // Custom yellow if not covered by accent
    default:
      return <Info className="w-5 h-5 text-muted-foreground" />;
  }
};

const IssueIcon = ({ type }: { type: ValidationIssue['type'] }) => {
  switch (type) {
    case 'error':
      return <XCircle className="w-4 h-4 text-destructive mr-2 flex-shrink-0" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-yellow-500 mr-2 flex-shrink-0" />; // Custom yellow
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
  if (isLoading && results.length === 0) {
    // This state is handled by the button text usually.
    // If there's a global loading screen for results, it could go here.
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
    <div className="mt-8 space-y-6">
      <h2 className="text-2xl font-semibold text-foreground">Validation Report</h2>
      {results.map(result => (
        <Card key={result.id} className="shadow-lg overflow-hidden">
          <CardHeader className={`flex flex-row items-center justify-between space-y-0 pb-2 ${
            result.status === 'success' ? 'bg-green-500/10' :
            result.status === 'error' ? 'bg-destructive/10' :
            result.status === 'warning' ? 'bg-yellow-500/10' : // Custom yellow
            'bg-muted/30'
          }`}>
            <div className="min-w-0">
              <CardTitle className="text-lg font-semibold text-foreground truncate" title={result.fileName}>
                {result.fileName}
              </CardTitle>
              <CardDescription className="text-xs">
                Validation Status
              </CardDescription>
            </div>
            <Badge variant={
              result.status === 'success' ? 'default' : // Assuming default is green-ish via custom theme or explicit style
              result.status === 'error' ? 'destructive' :
              result.status === 'warning' ? 'default' : // Using default for warning, can customize badge further
              'secondary'
            }
            className={`py-1 px-3 text-sm ${
                result.status === 'success' ? 'bg-green-600 text-white' :
                result.status === 'error' ? 'bg-destructive text-destructive-foreground' :
                result.status === 'warning' ? 'bg-yellow-500 text-white' : // Custom yellow
                ''
            }`}
            >
              <StatusIcon status={result.status} />
              <span className="ml-2 capitalize">{result.status}</span>
            </Badge>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {result.adDimensions && (
                <div className="flex items-start p-3 bg-secondary/30 rounded-md">
                  <ImageIcon className="w-5 h-5 text-primary mr-3 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">Ad Dimensions</p>
                    <p className="text-muted-foreground">
                      {result.adDimensions.actual ? 
                       `Detected: ${result.adDimensions.actual.width}x${result.adDimensions.actual.height}px ` : ''}
                       {result.adDimensions.width && result.adDimensions.height ?
                       `(Expected: ${result.adDimensions.width}x${result.adDimensions.height}px)`: 'Not specified'}
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
              {typeof result.clickTagFound === 'boolean' && (
                <div className="flex items-start p-3 bg-secondary/30 rounded-md">
                 {result.clickTagFound ? <CheckCircle2 className="w-5 h-5 text-green-500 mr-3 mt-0.5 flex-shrink-0" /> : <XCircle className="w-5 h-5 text-destructive mr-3 mt-0.5 flex-shrink-0" />}
                  <div>
                     <p className="font-medium text-foreground">ClickTag</p>
                    <p className="text-muted-foreground">{result.clickTagFound ? 'Found' : 'Not Found / Invalid'}</p>
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
            {result.issues.length === 0 && result.status !== 'pending' && result.status !== 'validating' && (
              <div className="text-sm text-green-600 flex items-center p-3 bg-green-500/10 rounded-md">
                <CheckCircle2 className="w-5 h-5 mr-2 flex-shrink-0"/>
                No issues found. This creative meets the requirements.
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
                <p className="text-sm text-primary">Currently validating...</p>
             </CardFooter>
          )}
        </Card>
      ))}
    </div>
  );
}
