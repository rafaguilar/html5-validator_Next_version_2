
'use client';

import { useEffect, useState } from 'react';
import { getReport } from '@/services/report-service';
import type { ValidationResult } from '@/types';
import { AppHeader } from '@/components/layout/header';
import { ValidationResults } from '@/components/html-validator/validation-results';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, FileX2 } from 'lucide-react';

export default function ReportPage({ params }: { params: { reportId: string } }) {
  const [reportData, setReportData] = useState<ValidationResult[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.reportId) {
      const fetchReport = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const data = await getReport(params.reportId);
          if (data) {
            setReportData(data);
          } else {
            setError('Report not found. The link may have expired or is invalid.');
          }
        } catch (err) {
          console.error('Failed to fetch report:', err);
          setError(err instanceof Error ? err.message : 'An unexpected error occurred while fetching the report.');
        } finally {
          setIsLoading(false);
        }
      };
      fetchReport();
    }
  }, [params.reportId]);

  return (
    <div className="min-h-screen flex flex-col bg-muted/20">
      <AppHeader />
      <main className="flex-grow container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto space-y-8">
          {isLoading && (
            <Card className="shadow-md">
              <CardContent className="p-10 text-center">
                <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
                <p className="text-lg font-medium text-foreground">Loading Report...</p>
                <p className="text-sm text-muted-foreground">Please wait while we fetch the validation results.</p>
              </CardContent>
            </Card>
          )}
          {error && !isLoading && (
             <Card className="shadow-md border-destructive">
                <CardContent className="p-10 text-center">
                    <FileX2 className="w-12 h-12 mx-auto text-destructive mb-4" />
                    <p className="text-lg font-medium text-destructive">Error Loading Report</p>
                    <p className="text-sm text-muted-foreground">{error}</p>
                </CardContent>
            </Card>
          )}
          {reportData && !isLoading && (
            <>
                <div className="p-4 bg-card rounded-lg border">
                    <h1 className="text-2xl font-semibold text-foreground">Validation Report</h1>
                    <p className="text-sm text-muted-foreground">This is a shared, read-only view of a validation report. Report ID: {params.reportId}</p>
                </div>
                <ValidationResults results={reportData} isLoading={false} />
            </>
          )}
        </div>
      </main>
       <footer className="py-6 text-center text-sm text-muted-foreground border-t bg-card">
        © {new Date().getFullYear()} HTML Validator. All rights reserved.
      </footer>
    </div>
  );
}
