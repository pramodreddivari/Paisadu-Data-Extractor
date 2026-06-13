export interface ExtractedRow {
  id: string;
  sNo?: number;
  rowNumber: number;
  pageNo?: number;
  pageNumber: number;
  city: string;
  phoneNumber: string;
  amount: string | number;
  status: 'OK' | 'Needs Review';
  originalOcrText: string;
  confidence: number;
  needsReview: boolean;
  reviewReason?: string;
  sourceFileName: string;
}

export interface UploadedDocument {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'processing' | 'success' | 'error';
  loadingSubStatus?: string;
  progress: number;
  errorMessage?: string;
  pageCount: number;
}

export interface ApiExtractResponse {
  success: boolean;
  message: string;
  fileName: string;
  pageCount: number;
  rows: Omit<ExtractedRow, 'id'>[];
  totalExtracted: number;
  needsReviewCount: number;
}

export interface ProcessingOptions {
  mode: 'backend' | 'browser';
  backendUrl: string;
  minConfidenceThreshold: number;
  cityRegex?: string;
  phoneRegex?: string;
  amountRegex?: string;
}
