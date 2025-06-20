
export interface ValidationIssue {
  id: string;
  type: 'error' | 'warning' | 'info';
  message: string;
  details?: string;
  rule?: string; // Added rule to align with createIssuePageClient
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
  // htmlContent?: string; // This was for previews, not strictly needed for core validation of v1.1.0
  hasCorrectTopLevelClickTag?: boolean; // New field
}
