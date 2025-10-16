export interface ValidationIssue {
  id: string;
  type: 'error' | 'warning' | 'info';
  message: string;
  details?: string;
  rule?: string;
}

export interface ClickTagInfo {
  name: string;
  url: string;
  isHttps: boolean;
}

export interface ValidationResult {
  id: string;
  fileName: string;
  status: 'pending' | 'validating' | 'success' | 'error' | 'warning';
  issues: ValidationIssue[];
  adDimensions?: { width: number; height: number; actual?: {width: number; height: number} };
  fileStructureOk?: boolean;
  htmlEntryPoint?: string;
  htmlContent?: string;
  detectedClickTags?: ClickTagInfo[];
  fileSize?: number;
  maxFileSize?: number;
  hasCorrectTopLevelClickTag?: boolean;
  preview: PreviewResult | null;
}

export interface PreviewResult {
  id: string;
  fileName: string;
  entryPoint: string;
  processedHtml: string | null; // Can be null as it's not essential for the new preview method
  securityWarning: string | null;
}
