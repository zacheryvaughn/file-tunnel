/**
 * Simplified types for the file uploader system
 */

// Core options for the uploader
export interface UploaderOptions {
  // Basic configuration
  chunkSize?: number;
  forceChunkSize?: boolean;
  simultaneousUploads?: number;
  maxFiles?: number;
  maxFileSize?: number;
  fileType?: string[];
  
  // Upload behavior
  target?: string;
  testChunks?: boolean;
  testTarget?: string | null;
  prioritizeFirstAndLastChunk?: boolean;
  maxChunkRetries?: number;
  chunkRetryInterval?: number;
  
  // Essential API parameter names
  fileParameterName?: string;
  chunkNumberParameterName?: string;
  identifierParameterName?: string;
  fileNameParameterName?: string;
  totalChunksParameterName?: string;
  
  // HTTP options
  uploadMethod?: string;
  testMethod?: string;
  withCredentials?: boolean;
  
  // Error callbacks
  maxFilesErrorCallback?: (files: File[], errorCount: number) => void;
  maxFileSizeErrorCallback?: (file: File, errorCount: number) => void;
  fileTypeErrorCallback?: (file: File, errorCount: number) => void;
  
  // Allow string indexing for dynamic access
  [key: string]: any;
}

// Simplified chunk interface
export interface ResumableChunk {
  fileObj: ResumableFile;
  offset: number;
  startByte: number;
  endByte: number;
  retries: number;
  loaded: number;
  xhr: XMLHttpRequest | null;
  
  // Status tracking
  tested: boolean;
  pendingRetry: boolean;
  markComplete: boolean;
  preprocessState: number;
  
  // Core methods
  status: () => 'pending' | 'uploading' | 'success' | 'error';
  message: () => string;
  progress: (relative?: boolean) => number;
  send: () => void;
  abort: () => void;
  test: () => void;
  preprocessFinished: () => void;
}

// Simplified file interface
export interface ResumableFile {
  // Properties
  file: File;
  fileName: string;
  size: number;
  relativePath: string;
  uniqueIdentifier: string;
  chunks: ResumableChunk[];
  _error?: boolean;
  _pause: boolean;
  _prevProgress: number;
  preprocessState: number;
  container?: any;
  
  // Core methods
  progress: () => number;
  isComplete: () => boolean;
  isUploading: () => boolean;
  isPaused: () => boolean;
  cancel: () => void;
  retry: () => void;
  bootstrap: () => void;
  upload: () => boolean;
  abort: () => void;
  pause: (pause?: boolean) => void;
  preprocessFinished: () => void;
  markChunksCompleted?: (chunkNumber: number) => void;
}

// Hook result interface
export interface UploaderHookResult {
  // State
  files: ResumableFile[];
  support: boolean;
  
  // Methods
  isUploading: () => boolean;
  upload: () => void;
  cancel: () => void;
  progress: () => number;
  getSize: () => number;
  
  // File management
  addFile: (file: File, event?: Event) => void;
  addFiles: (files: FileList | File[], event?: Event) => void;
  removeFile: (file: ResumableFile) => void;
  getFromUniqueIdentifier: (uniqueIdentifier: string) => ResumableFile | null;
  
  // Event system
  on: (event: string | string[], callback: (...args: any[]) => void) => void;
}