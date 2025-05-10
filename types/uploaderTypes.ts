// Types for the uploader options
export interface UploaderOptions {
  chunkSize?: number;
  forceChunkSize?: boolean;
  simultaneousUploads?: number;
  fileParameterName?: string;
  chunkNumberParameterName?: string;
  chunkSizeParameterName?: string;
  currentChunkSizeParameterName?: string;
  totalSizeParameterName?: string;
  typeParameterName?: string;
  identifierParameterName?: string;
  fileNameParameterName?: string;
  relativePathParameterName?: string;
  totalChunksParameterName?: string;
  throttleProgressCallbacks?: number;
  query?: Record<string, any> | ((file: ResumableFile, chunk?: ResumableChunk) => Record<string, any>);
  headers?: Record<string, string> | ((file: ResumableFile, chunk?: ResumableChunk) => Record<string, string>);
  preprocess?: ((chunk: ResumableChunk) => void) | null;
  preprocessFile?: ((file: ResumableFile) => void) | null;
  method?: 'multipart' | 'octet';
  uploadMethod?: string;
  testMethod?: string;
  prioritizeFirstAndLastChunk?: boolean;
  target?: string;
  testTarget?: string | null;
  parameterNamespace?: string;
  testChunks?: boolean;
  generateUniqueIdentifier?: ((file: File, event?: Event) => string) | null;
  getTarget?: ((params: string[]) => string) | null;
  maxChunkRetries?: number;
  chunkRetryInterval?: number | undefined;
  permanentErrors?: number[];
  maxFiles?: number | undefined;
  withCredentials?: boolean;
  xhrTimeout?: number;
  clearInput?: boolean;
  chunkFormat?: 'blob' | 'base64';
  setChunkTypeFromFile?: boolean;
  fileType?: string[];
  maxFilesErrorCallback?: (files: File[], errorCount: number) => void;
  minFileSizeErrorCallback?: (file: File, errorCount: number) => void;
  maxFileSizeErrorCallback?: (file: File, errorCount: number) => void;
  fileTypeErrorCallback?: (file: File, errorCount: number) => void;
  // Allow indexing with string
  [key: string]: any;
}

// Interface for a chunk of a file
export interface ResumableChunk {
  fileObj: ResumableFile;
  offset: number;
  tested: boolean;
  retries: number;
  pendingRetry: boolean;
  preprocessState: number;
  markComplete: boolean;
  loaded: number;
  startByte: number;
  endByte: number;
  xhr: XMLHttpRequest | null;
  status: () => 'pending' | 'uploading' | 'success' | 'error';
  message: () => string;
  progress: (relative?: boolean) => number;
  abort: () => void;
  test: () => void;
  send: () => void;
  preprocessFinished: () => void;
}

// Interface for a file being uploaded
export interface ResumableFile {
  file: File;
  fileName: string;
  size: number;
  relativePath: string;
  uniqueIdentifier: string;
  chunks: ResumableChunk[];
  progress: () => number;
  isUploading: () => boolean;
  isComplete: () => boolean;
  abort: () => void;
  cancel: () => void;
  retry: () => void;
  bootstrap: () => void;
  pause: (pause?: boolean) => void;
  isPaused: () => boolean;
  preprocessFinished: () => void;
  upload: () => boolean;
  markChunksCompleted: (chunkNumber: number) => void;
  preprocessState: number;
  _pause: boolean;
  _prevProgress: number;
  _error?: boolean;
  container?: any;
}

// Return type for the hook
export interface UploaderHookResult {
  isUploading: () => boolean;
  upload: () => void;
  pause: () => void;
  cancel: () => void;
  progress: () => number;
  addFile: (file: File, event?: Event) => void;
  addFiles: (files: FileList | File[], event?: Event) => void;
  removeFile: (file: ResumableFile) => void;
  getFromUniqueIdentifier: (uniqueIdentifier: string) => ResumableFile | null;
  getSize: () => number;
  on: (event: string, callback: (...args: any[]) => void) => void;
  files: ResumableFile[];
  support: boolean;
}