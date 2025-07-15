
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
  detectedClickTags?: ClickTagInfo[];
  fileSize?: number;
  maxFileSize?: number;
  hasCorrectTopLevelClickTag?: boolean;
}

export interface PreviewResult {
  id: string; // The unique ID for the preview session
  fileName: string;
  entryPoint: string; // The path to the main HTML file
  securityWarning: string | null;
}
