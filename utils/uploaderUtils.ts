/**
 * Simplified utility functions for the file uploader system
 */
import { UploaderOptions, ResumableChunk, ResumableFile } from '../types/uploaderTypes';

// Default options - simplified to essential options
export const defaultOptions: UploaderOptions = {
  chunkSize: 1 * 1024 * 1024,
  forceChunkSize: false,
  simultaneousUploads: 3,
  fileParameterName: 'file',
  chunkNumberParameterName: 'resumableChunkNumber',
  chunkSizeParameterName: 'resumableChunkSize',
  totalSizeParameterName: 'resumableTotalSize',
  typeParameterName: 'resumableType',
  identifierParameterName: 'resumableIdentifier',
  fileNameParameterName: 'resumableFilename',
  relativePathParameterName: 'resumableRelativePath',
  totalChunksParameterName: 'resumableTotalChunks',
  throttleProgressCallbacks: 0.5,
  uploadMethod: 'POST',
  testMethod: 'GET',
  prioritizeFirstAndLastChunk: false,
  target: '/',
  testTarget: null,
  parameterNamespace: '',
  testChunks: true,
  maxChunkRetries: 10,
  chunkRetryInterval: 1000,
  permanentErrors: [400, 401, 403, 404, 409, 415, 500, 501],
  maxFiles: undefined,
  withCredentials: false,
  fileType: [],
};

/**
 * Format file size in human-readable format
 */
export const formatSize = (size: number): string => {
  if (size < 1024) {
    return size + ' bytes';
  } else if (size < 1024 * 1024) {
    return (size / 1024.0).toFixed(0) + ' KB';
  } else if (size < 1024 * 1024 * 1024) {
    return (size / 1024.0 / 1024.0).toFixed(1) + ' MB';
  } else {
    return (size / 1024.0 / 1024.0 / 1024.0).toFixed(1) + ' GB';
  }
};

/**
 * Iterate over arrays or objects
 */
export const each = (obj: any, callback: Function): void => {
  // Guard against undefined or null objects
  if (!obj) {
    console.warn('each called with undefined or null object');
    return;
  }
  
  try {
    if (typeof obj.length !== 'undefined') {
      for (let i = 0; i < obj.length; i++) {
        if (callback(obj[i]) === false) return;
      }
    } else {
      for (const key in obj) {
        if (callback(key, obj[key]) === false) return;
      }
    }
  } catch (error) {
    console.error('Error in each function:', error);
  }
};

/**
 * Generate a unique identifier for a file
 */
export const generateUniqueIdentifier = (
  file: File,
  event?: Event,
  customGenerator?: ((file: File, event?: Event) => string) | null
): string => {
  if (typeof customGenerator === 'function') {
    return customGenerator(file, event);
  }
  
  const relativePath = (file as any).webkitRelativePath || (file as any).relativePath || file.name;
  const size = file.size;
  return size + '-' + relativePath.replace(/[^0-9a-zA-Z_-]/img, '');
};

export const getTarget = (
  request: string, 
  params: string[], 
  target: string | ((params: string[]) => string), 
  testTarget: string | null
): string => {
  let finalTarget = target;
  
  if (request === 'test' && testTarget) {
    finalTarget = testTarget === '/' ? target : testTarget;
  }
  
  if (typeof finalTarget === 'function') {
    return finalTarget(params);
  }
  
  const separator = (finalTarget as string).indexOf('?') < 0 ? '?' : '&';
  const joinedParams = params.join('&');
  
  if (joinedParams) {
    finalTarget = (finalTarget as string) + separator + joinedParams;
  }
  
  return finalTarget as string;
};

// Process callbacks in sequence
export const processCallbacks = (items: Function[], cb: () => void): void => {
  if (!items || items.length === 0) {
    // Empty or no list, invoke callback
    return cb();
  }
  
  // Invoke current function, pass the next part as continuation
  items[0](() => {
    processCallbacks(items.slice(1), cb);
  });
};

// Create a ResumableChunk object
export const createResumableChunk = (
  fileObj: ResumableFile, 
  offset: number, 
  callback: (event: string, message?: string) => void,
  options: UploaderOptions,
  getOpt: (option: string | string[]) => any,
  uploadNextChunk: () => boolean,
  fire: (event: string, ...args: any[]) => void
): ResumableChunk => {
  const chunkSize = getOpt('chunkSize') as number;
  const startByte = offset * chunkSize;
  const endByte = Math.min(fileObj.size, (offset + 1) * chunkSize);
  
  const chunk: ResumableChunk = {
    fileObj,
    offset,
    tested: false,
    retries: 0,
    pendingRetry: false,
    preprocessState: 0,
    markComplete: false,
    loaded: 0,
    startByte,
    endByte,
    xhr: null,
    
    status: function() {
      if (this.pendingRetry) {
        return 'uploading';
      } else if (this.markComplete) {
        return 'success';
      } else if (!this.xhr) {
        return 'pending';
      } else if (this.xhr.readyState < 4) {
        return 'uploading';
      } else {
        if (this.xhr.status === 200 || this.xhr.status === 201) {
          return 'success';
        } else if (
          (getOpt('permanentErrors') as number[]).includes(this.xhr.status) || 
          this.retries >= (getOpt('maxChunkRetries') as number)
        ) {
          return 'error';
        } else {
          this.abort();
          return 'pending';
        }
      }
    },
    
    message: function() {
      return this.xhr ? this.xhr.responseText : '';
    },
    
    progress: function(relative?: boolean) {
      if (typeof relative === 'undefined') relative = false;
      let factor = relative ? (this.endByte - this.startByte) / fileObj.size : 1;
      
      if (this.pendingRetry) return 0;
      if ((!this.xhr || !this.xhr.status) && !this.markComplete) factor *= 0.95;
      
      const s = this.status();
      switch (s) {
        case 'success':
        case 'error':
          return 1 * factor;
        case 'pending':
          return 0 * factor;
        default:
          return this.loaded / (this.endByte - this.startByte) * factor;
      }
    },
    
    abort: function() {
      if (this.xhr) this.xhr.abort();
      this.xhr = null;
    },
    
    test: function() {
      this.xhr = new XMLHttpRequest();
      
      const testHandler = () => {
        this.tested = true;
        const status = this.status();
        
        if (status === 'success') {
          callback(status, this.message());
          uploadNextChunk();
        } else {
          this.send();
        }
      };
      
      this.xhr.addEventListener('load', testHandler);
      this.xhr.addEventListener('error', testHandler);
      this.xhr.addEventListener('timeout', testHandler);
      
      // Add essential parameters to identify chunk
      const params: string[] = [];
      const parameterNamespace = getOpt('parameterNamespace') as string || '';
      
      // Add only the essential parameters
      params.push(
        `${parameterNamespace}${getOpt('chunkNumberParameterName')}=${this.offset + 1}`,
        `${parameterNamespace}${getOpt('identifierParameterName')}=${encodeURIComponent(fileObj.uniqueIdentifier)}`,
        `${parameterNamespace}${getOpt('fileNameParameterName')}=${encodeURIComponent(fileObj.fileName)}`,
        `${parameterNamespace}${getOpt('totalChunksParameterName')}=${fileObj.chunks.length}`
      );
      
      // Append the relevant chunk and send it
      this.xhr.open(getOpt('testMethod') as string,
        getTarget('test', params, getOpt('target'), getOpt('testTarget')));
      this.xhr.withCredentials = getOpt('withCredentials') as boolean;
      this.xhr.send(null);
    },
    
    preprocessFinished: function() {
      this.preprocessState = 2;
      this.send();
    },
    
    send: function() {
      if (getOpt('testChunks') && !this.tested) {
        this.test();
        return;
      }
      
      // Set up request and listen for event
      this.xhr = new XMLHttpRequest();
      
      // Progress
      this.xhr.upload.addEventListener('progress', (e: ProgressEvent) => {
        if ((new Date()).getTime() - (this as any).lastProgressCallback > (getOpt('throttleProgressCallbacks') as number) * 1000) {
          callback('progress');
          (this as any).lastProgressCallback = (new Date()).getTime();
        }
        this.loaded = e.loaded || 0;
      });
      
      this.loaded = 0;
      this.pendingRetry = false;
      callback('progress');
      
      // Done (either done, failed or retry)
      const doneHandler = () => {
        const status = this.status();
        
        if (status === 'success' || status === 'error') {
          callback(status, this.message());
          setTimeout(() => {
            uploadNextChunk();
          }, 50);
        } else {
          callback('retry', this.message());
          this.abort();
          this.retries++;
          const retryInterval = getOpt('chunkRetryInterval');
          if (retryInterval !== undefined) {
            this.pendingRetry = true;
            setTimeout(() => this.send(), retryInterval);
          } else {
            this.send();
          }
        }
      };
      
      this.xhr.addEventListener('load', doneHandler);
      this.xhr.addEventListener('error', doneHandler);
      this.xhr.addEventListener('timeout', doneHandler);
      
      // Set up the basic query data from Resumable
      const query: Record<string, any> = {
        [getOpt('chunkNumberParameterName') as string]: this.offset + 1,
        [getOpt('chunkSizeParameterName') as string]: getOpt('chunkSize'),
        [getOpt('currentChunkSizeParameterName') as string]: this.endByte - this.startByte,
        [getOpt('totalSizeParameterName') as string]: fileObj.size,
        [getOpt('typeParameterName') as string]: fileObj.file.type,
        [getOpt('identifierParameterName') as string]: fileObj.uniqueIdentifier,
        [getOpt('fileNameParameterName') as string]: fileObj.fileName,
        [getOpt('relativePathParameterName') as string]: fileObj.relativePath,
        [getOpt('totalChunksParameterName') as string]: fileObj.chunks.length,
      };
      
      // Mix in custom data
      let customQuery = getOpt('query') || {};
      if (typeof customQuery === 'function') {
        customQuery = customQuery(fileObj, this) || {};
      }
      
      each(customQuery, (k: string, v: any) => {
        query[k] = v;
      });
      
      // Modern browsers all support slice
      const bytes = fileObj.file.slice(this.startByte, this.endByte);
      
      const data = new FormData();
      const parameterNamespace = getOpt('parameterNamespace') as string || '';
      
      each(query, (k: string, v: any) => {
        data.append(parameterNamespace + k, v);
      });
      
      data.append(parameterNamespace + (getOpt('fileParameterName') as string), bytes, fileObj.fileName);
      
      const target = getTarget('upload', [], getOpt('target'), getOpt('testTarget'));
      const method = getOpt('uploadMethod') as string;
      
      this.xhr.open(method, target);
      this.xhr.timeout = getOpt('xhrTimeout') as number;
      this.xhr.withCredentials = getOpt('withCredentials') as boolean;
      
      // Add data from header options
      let customHeaders = getOpt('headers') || {};
      if (typeof customHeaders === 'function') {
        customHeaders = customHeaders(fileObj, this) || {};
      }
      
      if (this.xhr) {
        each(customHeaders, (k: string, v: string) => {
          if (this.xhr) {
            this.xhr.setRequestHeader(k, v);
          }
        });
        
        this.xhr.send(data);
      }
    }
  };
  
  (chunk as any).lastProgressCallback = new Date();
  return chunk;
};

// Simplified process items function - focuses on files, simplifies directory handling
export const processItem = (
  item: any,
  path: string,
  items: File[],
  cb: () => void,
  processDirectory: (directory: any, path: string, items: File[], cb: () => void) => void
): void => {
  // Handle File objects directly
  if (item instanceof File) {
    (item as any).relativePath = path + item.name;
    items.push(item);
    cb();
    return;
  }
  
  // Handle FileSystem API entries
  if (item.isFile) {
    item.file((file: File) => {
      (file as any).relativePath = path + file.name;
      items.push(file);
      cb();
    });
    return;
  }
  
  // Handle directory entries
  if (item.isDirectory || (typeof item.webkitGetAsEntry === 'function' &&
      item.webkitGetAsEntry()?.isDirectory)) {
    const entry = item.isDirectory ? item : item.webkitGetAsEntry();
    return processDirectory(entry, path + entry.name + '/', items, cb);
  }
  
  // Handle DataTransferItem
  if (typeof item.getAsFile === 'function') {
    const file = item.getAsFile();
    if (file instanceof File) {
      (file as any).relativePath = path + file.name;
      items.push(file);
    }
  }
  
  cb();
};

/**
 * Check browser support for file uploading
 */
export const checkSupport = (): boolean => {
  return (
    typeof(File) !== 'undefined' &&
    typeof(Blob) !== 'undefined' &&
    typeof(FileList) !== 'undefined' &&
    !!Blob.prototype.slice
  );
};