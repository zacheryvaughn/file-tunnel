import { UploaderOptions, ResumableChunk, ResumableFile } from '../types/uploaderTypes';

// Default options
export const defaultOptions: UploaderOptions = {
  chunkSize: 1 * 1024 * 1024,
  forceChunkSize: false,
  simultaneousUploads: 3,
  fileParameterName: 'file',
  chunkNumberParameterName: 'resumableChunkNumber',
  chunkSizeParameterName: 'resumableChunkSize',
  currentChunkSizeParameterName: 'resumableCurrentChunkSize',
  totalSizeParameterName: 'resumableTotalSize',
  typeParameterName: 'resumableType',
  identifierParameterName: 'resumableIdentifier',
  fileNameParameterName: 'resumableFilename',
  relativePathParameterName: 'resumableRelativePath',
  totalChunksParameterName: 'resumableTotalChunks',
  throttleProgressCallbacks: 0.5,
  query: {},
  headers: {},
  preprocess: null,
  preprocessFile: null,
  method: 'multipart',
  uploadMethod: 'POST',
  testMethod: 'GET',
  prioritizeFirstAndLastChunk: false,
  target: '/',
  testTarget: null,
  parameterNamespace: '',
  testChunks: true,
  generateUniqueIdentifier: null,
  maxChunkRetries: 100,
  chunkRetryInterval: undefined,
  permanentErrors: [400, 401, 403, 404, 409, 415, 500, 501],
  maxFiles: undefined,
  withCredentials: false,
  xhrTimeout: 0,
  clearInput: true,
  chunkFormat: 'blob',
  setChunkTypeFromFile: false,
  fileType: [],
};

// Helper functions
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

export const each = (obj: any, callback: Function): void => {
  if (typeof obj.length !== 'undefined') {
    for (let i = 0; i < obj.length; i++) {
      // Array or FileList
      if (callback(obj[i]) === false) return;
    }
  } else {
    for (const key in obj) {
      // Object
      if (callback(key, obj[key]) === false) return;
    }
  }
};

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
      console.log(`Chunk.test called for chunk ${this.offset + 1} of file ${this.fileObj.fileName}`);
      this.xhr = new XMLHttpRequest();
      
      const testHandler = () => {
        this.tested = true;
        const status = this.status();
        console.log(`Chunk test result for chunk ${this.offset + 1}: ${status}, status code: ${this.xhr?.status}`);
        
        if (status === 'success') {
          console.log(`Chunk ${this.offset + 1} already exists on server, skipping upload`);
          callback(status, this.message());
          uploadNextChunk();
        } else {
          console.log(`Chunk ${this.offset + 1} doesn't exist on server, proceeding with upload`);
          this.send();
        }
      };
      
      this.xhr.addEventListener('load', testHandler);
      this.xhr.addEventListener('error', testHandler);
      this.xhr.addEventListener('timeout', testHandler);
      
      // Add data from the query options
      const params: string[] = [];
      const parameterNamespace = getOpt('parameterNamespace') as string;
      let customQuery = getOpt('query');
      
      if (typeof customQuery === 'function') {
        customQuery = customQuery(fileObj, this);
      }
      
      each(customQuery, (k: string, v: any) => {
        params.push([encodeURIComponent(parameterNamespace + k), encodeURIComponent(v)].join('='));
      });
      
      // Add extra data to identify chunk
      params.push(...[
        ['chunkNumberParameterName', this.offset + 1],
        ['chunkSizeParameterName', getOpt('chunkSize')],
        ['currentChunkSizeParameterName', this.endByte - this.startByte],
        ['totalSizeParameterName', fileObj.size],
        ['typeParameterName', fileObj.file.type],
        ['identifierParameterName', fileObj.uniqueIdentifier],
        ['fileNameParameterName', fileObj.fileName],
        ['relativePathParameterName', fileObj.relativePath],
        ['totalChunksParameterName', fileObj.chunks.length]
      ]
        .filter(pair => getOpt(pair[0]))
        .map(pair => [
          parameterNamespace + getOpt(pair[0]),
          encodeURIComponent(pair[1])
        ].join('='))
      );
      
      // Append the relevant chunk and send it
      this.xhr.open(getOpt('testMethod') as string, 
        getTarget('test', params, getOpt('target'), getOpt('testTarget')));
      this.xhr.timeout = getOpt('xhrTimeout') as number;
      this.xhr.withCredentials = getOpt('withCredentials') as boolean;
      
      // Add data from header options
      let customHeaders = getOpt('headers');
      if (typeof customHeaders === 'function') {
        customHeaders = customHeaders(fileObj, this);
      }
      
      each(customHeaders, (k: string, v: string) => {
        if (this.xhr) {
          this.xhr.setRequestHeader(k, v);
        }
      });
      
      if (this.xhr) {
        this.xhr.send(null);
      }
    },
    
    preprocessFinished: function() {
      this.preprocessState = 2;
      this.send();
    },
    
    send: function() {
      console.log(`Chunk.send called for chunk ${this.offset + 1} of file ${this.fileObj.fileName}`);
      
      const preprocess = getOpt('preprocess');
      if (typeof preprocess === 'function') {
        switch (this.preprocessState) {
          case 0:
            this.preprocessState = 1;
            preprocess(this);
            console.log(`Chunk preprocessing started for chunk ${this.offset + 1}`);
            return;
          case 1:
            console.log(`Chunk preprocessing in progress for chunk ${this.offset + 1}`);
            return;
          case 2:
            console.log(`Chunk preprocessing completed for chunk ${this.offset + 1}`);
            break;
        }
      }
      
      if (getOpt('testChunks') && !this.tested) {
        console.log(`Testing if chunk ${this.offset + 1} exists on server`);
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
        console.log(`Chunk ${this.offset + 1} completed with status: ${status}, xhr status: ${this.xhr?.status}`);
        
        // Log more details about the response
        if (this.xhr) {
          console.log(`Chunk ${this.offset + 1} response:`, {
            status: this.xhr.status,
            statusText: this.xhr.statusText,
            responseText: this.xhr.responseText,
            isPermanentError: (getOpt('permanentErrors') as number[]).includes(this.xhr.status),
            maxRetries: getOpt('maxChunkRetries'),
            currentRetries: this.retries
          });
        }
        
        if (status === 'success' || status === 'error') {
          console.log(`Chunk ${this.offset + 1} ${status === 'success' ? 'succeeded' : 'failed permanently'}, calling uploadNextChunk`);
          callback(status, this.message());
          
          // Add a small delay before calling uploadNextChunk to ensure state updates have propagated
          setTimeout(() => {
            console.log(`Delayed uploadNextChunk call for chunk ${this.offset + 1}`);
            uploadNextChunk();
          }, 50);
        } else {
          console.log(`Chunk ${this.offset + 1} needs retry, attempt ${this.retries + 1}`);
          callback('retry', this.message());
          this.abort();
          this.retries++;
          const retryInterval = getOpt('chunkRetryInterval');
          if (retryInterval !== undefined) {
            this.pendingRetry = true;
            console.log(`Scheduling retry for chunk ${this.offset + 1} in ${retryInterval}ms`);
            setTimeout(() => this.send(), retryInterval);
          } else {
            console.log(`Immediate retry for chunk ${this.offset + 1}`);
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
      let customQuery = getOpt('query');
      if (typeof customQuery === 'function') {
        customQuery = customQuery(fileObj, this);
      }
      
      each(customQuery, (k: string, v: any) => {
        query[k] = v;
      });
      
      // Handle different browser implementations of slice
      let bytes: Blob;
      if (typeof fileObj.file.slice === 'function') {
        bytes = fileObj.file.slice(this.startByte, this.endByte,
                getOpt('setChunkTypeFromFile') ? fileObj.file.type : '');
      } else if ((fileObj.file as any).mozSlice) {
        bytes = (fileObj.file as any).mozSlice(this.startByte, this.endByte,
                getOpt('setChunkTypeFromFile') ? fileObj.file.type : '');
      } else if ((fileObj.file as any).webkitSlice) {
        bytes = (fileObj.file as any).webkitSlice(this.startByte, this.endByte,
                getOpt('setChunkTypeFromFile') ? fileObj.file.type : '');
      } else {
        // Fallback
        bytes = fileObj.file.slice(this.startByte, this.endByte,
                getOpt('setChunkTypeFromFile') ? fileObj.file.type : '');
      }
      
      const data = new FormData();
      const parameterNamespace = getOpt('parameterNamespace') as string;
      
      each(query, (k: string, v: any) => {
        data.append(parameterNamespace + k, v);
      });
      
      if (getOpt('chunkFormat') === 'blob') {
        data.append(parameterNamespace + (getOpt('fileParameterName') as string), bytes, fileObj.fileName);
      } else if (getOpt('chunkFormat') === 'base64') {
        const fr = new FileReader();
        fr.onload = (e) => {
          data.append(parameterNamespace + (getOpt('fileParameterName') as string), fr.result as string);
          this.xhr?.send(data);
        };
        fr.readAsDataURL(bytes);
        return;
      }
      
      const target = getTarget('upload', [], getOpt('target'), getOpt('testTarget'));
      const method = getOpt('uploadMethod') as string;
      
      this.xhr.open(method, target);
      this.xhr.timeout = getOpt('xhrTimeout') as number;
      this.xhr.withCredentials = getOpt('withCredentials') as boolean;
      
      // Add data from header options
      let customHeaders = getOpt('headers');
      if (typeof customHeaders === 'function') {
        customHeaders = customHeaders(fileObj, this);
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

// Process items (files or directories)
export const processItem = (
  item: any, 
  path: string, 
  items: File[], 
  cb: () => void,
  processDirectory: (directory: any, path: string, items: File[], cb: () => void) => void
): void => {
  let entry;
  
  if (item.isFile) {
    // File provided
    item.file((file: File) => {
      (file as any).relativePath = path + file.name;
      items.push(file);
      cb();
    });
    return;
  } else if (item.isDirectory) {
    // Item is already a directory entry, just assign
    entry = item;
  } else if (item instanceof File) {
    items.push(item);
  }
  
  if (typeof item.webkitGetAsEntry === 'function') {
    // Get entry from file object
    entry = item.webkitGetAsEntry();
  }
  
  if (entry && entry.isDirectory) {
    // Directory provided, process it
    return processDirectory(entry, path + entry.name + '/', items, cb);
  }
  
  if (typeof item.getAsFile === 'function') {
    // Item represents a File object, convert it
    item = item.getAsFile();
    if (item instanceof File) {
      (item as any).relativePath = path + item.name;
      items.push(item);
    }
  }
  
  cb(); // Indicate processing is done
};

// Check browser support for file uploading
export const checkSupport = (): boolean => {
  return (
    typeof(File) !== 'undefined' &&
    typeof(Blob) !== 'undefined' &&
    typeof(FileList) !== 'undefined' &&
    (
      !!(Blob.prototype as any).webkitSlice ||
      !!(Blob.prototype as any).mozSlice ||
      !!Blob.prototype.slice ||
      false
    )
  );
};