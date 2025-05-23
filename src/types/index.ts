
export interface ValidationIssue {
  id: string;
  type: 'error' | 'warning';
  message: string;
  details?: string;
}

export interface ClickTagInfo {
  name: string;
  url: string;
  isHttps: boolean;
}

export interface ValidationResult {
  id: string; // Unique ID, e.g., fileName + timestamp
  fileName: string;
  status: 'pending' | 'validating' | 'success' | 'error' | 'warning'; // 'warning' if only warnings, 'error' if any error
  issues: ValidationIssue[];
  adDimensions?: { width: number; height: number; actual?: {width: number; height: number} };
  fileStructureOk?: boolean;
  detectedClickTags?: ClickTagInfo[];
  fileSize?: number; // in bytes
  maxFileSize?: number; // in bytes
}
