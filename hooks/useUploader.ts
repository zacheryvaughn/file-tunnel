import { useState, useCallback, useRef, useEffect } from 'react';
import {
  UploaderOptions,
  ResumableFile,
  ResumableChunk,
  UploaderHookResult
} from '../types/uploaderTypes';
import {
  defaultOptions,
  each,
  formatSize,
  generateUniqueIdentifier,
  getTarget,
  processCallbacks,
  createResumableChunk,
  processItem,
  checkSupport
} from '../utils/uploaderUtils';

/**
 * React hook for resumable file uploads
 * Based on Resumable.js (https://github.com/23/resumable.js)
 */
export const useUploader = (options: UploaderOptions = {}): UploaderHookResult => {
  // State
  const [files, setFiles] = useState<ResumableFile[]>([]);
  const [support, setSupport] = useState(false);
  
  // Refs to avoid re-renders
  const eventsRef = useRef<any[]>([]);
  const optionsRef = useRef(options);
  
  // Initialize
  useEffect(() => {
    setSupport(checkSupport());
    optionsRef.current = options;
  }, [options]);

  // Helper functions
  const getOpt = useCallback((option: string | string[]) => {
    // Get multiple options if passed an array
    if (Array.isArray(option)) {
      const options: Record<string, any> = {};
      option.forEach(opt => {
        options[opt] = getOpt(opt);
      });
      return options;
    }
    
    // Otherwise, just return a simple option
    if (typeof optionsRef.current[option] !== 'undefined') {
      return optionsRef.current[option];
    } else {
      return defaultOptions[option];
    }
  }, []);

  const fire = useCallback((event: string, ...args: any[]) => {
    // Find event listeners, and support pseudo-event 'catchAll'
    const eventLower = event.toLowerCase();
    for (let i = 0; i < eventsRef.current.length; i += 2) {
      if (eventsRef.current[i] === eventLower) {
        eventsRef.current[i + 1].apply(null, args);
      }
      if (eventsRef.current[i] === 'catchall') {
        eventsRef.current[i + 1].apply(null, [event, ...args]);
      }
    }
    
    if (eventLower === 'fileerror') fire('error', args[1], args[0]);
    if (eventLower === 'fileprogress') fire('progress');
  }, []);

  // Event registration
  const on = useCallback((event: string, callback: (...args: any[]) => void) => {
    eventsRef.current.push(event.toLowerCase(), callback);
  }, []);

  // Upload management
  const uploadNextChunk = useCallback(() => {
    let found = false;

    // In some cases it's really handy to upload the first
    // and last chunk of a file quickly; this let's the server check the file's
    // metadata and determine if there's even a point in continuing.
    if (getOpt('prioritizeFirstAndLastChunk')) {
      each(files, (file: ResumableFile) => {
        if (file.chunks.length && file.chunks[0].status() === 'pending' && file.chunks[0].preprocessState === 0) {
          file.chunks[0].send();
          found = true;
          return false;
        }
        if (file.chunks.length > 1 && file.chunks[file.chunks.length - 1].status() === 'pending' && file.chunks[file.chunks.length - 1].preprocessState === 0) {
          file.chunks[file.chunks.length - 1].send();
          found = true;
          return false;
        }
        return true;
      });
      if (found) return true;
    }

    // Now, simply look for the next, best thing to upload
    each(files, (file: ResumableFile) => {
      found = file.upload();
      if (found) return false;
      return true;
    });
    if (found) return true;

    // The are no more outstanding chunks to upload, check is everything is done
    let outstanding = false;
    each(files, (file: ResumableFile) => {
      if (!file.isComplete()) {
        outstanding = true;
        return false;
      }
      return true;
    });
    if (!outstanding) {
      // All chunks have been uploaded, complete
      fire('complete');
    }
    return false;
  }, [getOpt, fire, files]);

  // Process directory recursively
  const processDirectory = useCallback((directory: any, path: string, items: File[], cb: () => void) => {
    const dirReader = directory.createReader();
    const allEntries: any[] = [];
    
    function readEntries() {
      dirReader.readEntries((entries: any[]) => {
        if (entries.length) {
          allEntries.push(...entries);
          return readEntries();
        }
        
        // Process all conversion callbacks, finally invoke own one
        processCallbacks(
          allEntries.map(entry => {
            // Bind all properties except for callback
            return (innerCb: () => void) => processItem(entry, path, items, innerCb, processDirectory);
          }),
          cb
        );
      });
    }
    
    readEntries();
  }, []);

  // Load files from drop or input
  const loadFiles = useCallback((items: any, event?: Event) => {
    if (!items.length) {
      return; // Nothing to do
    }
    
    fire('beforeAdd');
    const fileList: File[] = [];
    
    processCallbacks(
      Array.from(items).map((item: any) => {
        // Bind all properties except for callback
        let entry = item;
        if (typeof item.webkitGetAsEntry === 'function') {
          entry = item.webkitGetAsEntry();
        }
        return (cb: () => void) => processItem(entry, '', fileList, cb, processDirectory);
      }),
      () => {
        if (fileList.length) {
          // At least one file found
          appendFilesFromFileList(fileList, event);
        }
      }
    );
  }, [fire, processDirectory]);

  // Remove a file from the list
  const removeFile = useCallback((file: ResumableFile) => {
    setFiles(prevFiles => prevFiles.filter(f => f !== file));
  }, []);

  // Get a file by its unique identifier
  const getFromUniqueIdentifier = useCallback((uniqueIdentifier: string): ResumableFile | null => {
    let ret: ResumableFile | null = null;
    each(files, (f: ResumableFile) => {
      if (f.uniqueIdentifier === uniqueIdentifier) {
        ret = f;
        return false;
      }
      return true;
    });
    return ret;
  }, [files]);

  // Create a ResumableFile object
  const createResumableFile = useCallback((file: File, uniqueIdentifier: string): ResumableFile => {
    const resumableFile: ResumableFile = {
      file,
      fileName: file.name,
      size: file.size,
      relativePath: (file as any).relativePath || (file as any).webkitRelativePath || file.name,
      uniqueIdentifier,
      chunks: [],
      preprocessState: 0,
      _pause: false,
      _prevProgress: 0,
      
      progress: function() {
        if (this._error) return 1;
        
        // Sum up progress across everything
        let ret = 0;
        let error = false;
        
        each(this.chunks, (c: ResumableChunk) => {
          if (c.status() === 'error') error = true;
          ret += c.progress(true); // Get chunk progress relative to entire file
        });
        
        ret = (error ? 1 : (ret > 0.99999 ? 1 : ret));
        ret = Math.max(this._prevProgress, ret); // We don't want to lose percentages when an upload is paused
        this._prevProgress = ret;
        return ret;
      },
      
      isUploading: function() {
        let uploading = false;
        each(this.chunks, (chunk: ResumableChunk) => {
          if (chunk.status() === 'uploading') {
            uploading = true;
            return false;
          }
          return true;
        });
        return uploading;
      },
      
      isComplete: function() {
        let outstanding = false;
        if (this.preprocessState === 1) {
          return false;
        }
        
        each(this.chunks, (chunk: ResumableChunk) => {
          const status = chunk.status();
          if (status === 'pending' || status === 'uploading' || chunk.preprocessState === 1) {
            outstanding = true;
            return false;
          }
          return true;
        });
        
        return !outstanding;
      },
      
      pause: function(pause?: boolean) {
        if (typeof pause === 'undefined') {
          this._pause = !this._pause;
        } else {
          this._pause = pause;
        }
      },
      
      isPaused: function() {
        return this._pause;
      },
      
      abort: function() {
        // Stop current uploads
        let abortCount = 0;
        each(this.chunks, (c: ResumableChunk) => {
          if (c.status() === 'uploading') {
            c.abort();
            abortCount++;
          }
        });
        
        if (abortCount > 0) fire('fileProgress', this);
      },
      
      cancel: function() {
        // Reset this file to be void
        const _chunks = this.chunks;
        this.chunks = [];
        
        // Stop current uploads
        each(_chunks, (c: ResumableChunk) => {
          if (c.status() === 'uploading') {
            c.abort();
            uploadNextChunk();
          }
        });
        
        removeFile(this);
        fire('fileProgress', this);
      },
      
      retry: function() {
        this.bootstrap();
        let firedRetry = false;
        
        on('chunkingComplete', () => {
          if (!firedRetry) {
            // Use the upload function from the hook's scope
            // This avoids the circular dependency issue
            fire('uploadStart');
            for (let num = 1; num <= (getOpt('simultaneousUploads') as number); num++) {
              uploadNextChunk();
            }
          }
          firedRetry = true;
        });
      },
      
      bootstrap: function() {
        this.abort();
        this._error = false;
        
        // Rebuild stack of chunks from file
        this.chunks = [];
        this._prevProgress = 0;
        
        const round = getOpt('forceChunkSize') ? Math.ceil : Math.floor;
        const maxOffset = Math.max(round(this.file.size / (getOpt('chunkSize') as number)), 1);
        
        for (let offset = 0; offset < maxOffset; offset++) {
          this.chunks.push(createResumableChunk(
            this, 
            offset, 
            (event, message) => {
              // Event can be 'progress', 'success', 'error' or 'retry'
              switch (event) {
                case 'progress':
                  fire('fileProgress', this, message);
                  break;
                case 'error':
                  this.abort();
                  this._error = true;
                  this.chunks = [];
                  fire('fileError', this, message);
                  break;
                case 'success':
                  if (this._error) return;
                  fire('fileProgress', this, message); // It's at least progress
                  if (this.isComplete()) {
                    fire('fileSuccess', this, message);
                  }
                  break;
                case 'retry':
                  fire('fileRetry', this);
                  break;
              }
            },
            optionsRef.current,
            getOpt,
            uploadNextChunk,
            fire
          ));
          
          fire('chunkingProgress', this, offset / maxOffset);
        }
        
        setTimeout(() => {
          fire('chunkingComplete', this);
        }, 0);
      },
      
      preprocessFinished: function() {
        this.preprocessState = 2;
        this.upload();
      },
      
      upload: function() {
        let found = false;
        
        if (this.isPaused() === false) {
          const preprocess = getOpt('preprocessFile');
          
          if (typeof preprocess === 'function') {
            switch (this.preprocessState) {
              case 0:
                this.preprocessState = 1;
                preprocess(this);
                return true;
              case 1:
                return true;
              case 2:
                break;
            }
          }
          
          each(this.chunks, (chunk: ResumableChunk) => {
            if (chunk.status() === 'pending' && chunk.preprocessState !== 1) {
              chunk.send();
              found = true;
              return false;
            }
            return true;
          });
        }
        
        return found;
      },
      
      markChunksCompleted: function(chunkNumber: number) {
        if (!this.chunks || this.chunks.length <= chunkNumber) {
          return;
        }
        
        for (let num = 0; num < chunkNumber; num++) {
          this.chunks[num].markComplete = true;
        }
      }
    };
    
    // Bootstrap and return
    fire('chunkingStart', resumableFile);
    resumableFile.bootstrap();
    return resumableFile;
  }, [getOpt, fire, on, removeFile]);

  // Append files from file list
  const appendFilesFromFileList = useCallback((fileList: File[], event?: Event) => {
    // Check for uploading too many files
    let errorCount = 0;
    const o = getOpt(['maxFiles', 'minFileSize', 'maxFileSize', 'fileType']) as any;
    
    if (typeof o.maxFiles !== 'undefined' && o.maxFiles < (fileList.length + files.length)) {
      // If single-file upload, file is already added, and trying to add 1 new file, simply replace the already-added file
      if (o.maxFiles === 1 && files.length === 1 && fileList.length === 1) {
        removeFile(files[0]);
      } else {
        const maxFilesErrorCallback = getOpt('maxFilesErrorCallback') as Function;
        if (maxFilesErrorCallback) {
          maxFilesErrorCallback(fileList, errorCount++);
        }
        return false;
      }
    }
    
    const newFiles: ResumableFile[] = [];
    const filesSkipped: File[] = [];
    let remaining = fileList.length;
    
    const decreaseRemaining = () => {
      if (!--remaining) {
        // All files processed, trigger event
        if (!newFiles.length && !filesSkipped.length) {
          // No succeeded files, just skip
          return;
        }
        
        setTimeout(() => {
          fire('filesAdded', newFiles, filesSkipped);
        }, 0);
      }
    };
    
    each(fileList, (file: File) => {
      const fileName = file.name;
      const fileType = file.type; // e.g video/mp4
      
      if (o.fileType && o.fileType.length > 0) {
        let fileTypeFound = false;
        
        for (let index in o.fileType) {
          // For good behavior we do some initial sanitizing. Remove spaces and lowercase all
          o.fileType[index] = o.fileType[index].replace(/\s/g, '').toLowerCase();
          
          // Allowing for both [extension, .extension, mime/type, mime/*]
          const extension = ((o.fileType[index].match(/^[^.][^/]+$/)) ? '.' : '') + o.fileType[index];
          
          if ((fileName.substr(-1 * extension.length).toLowerCase() === extension) ||
            // If MIME type, check for wildcard or if extension matches the files tiletype
            (extension.indexOf('/') !== -1 && (
              (extension.indexOf('*') !== -1 && fileType.substr(0, extension.indexOf('*')) === extension.substr(0, extension.indexOf('*'))) ||
              fileType === extension
            ))
          ) {
            fileTypeFound = true;
            break;
          }
        }
        
        if (!fileTypeFound) {
          const fileTypeErrorCallback = getOpt('fileTypeErrorCallback') as Function;
          if (fileTypeErrorCallback) {
            fileTypeErrorCallback(file, errorCount++);
          }
          return true;
        }
      }
      
      if (typeof o.minFileSize !== 'undefined' && file.size < o.minFileSize) {
        const minFileSizeErrorCallback = getOpt('minFileSizeErrorCallback') as Function;
        if (minFileSizeErrorCallback) {
          minFileSizeErrorCallback(file, errorCount++);
        }
        return true;
      }
      
      if (typeof o.maxFileSize !== 'undefined' && file.size > o.maxFileSize) {
        const maxFileSizeErrorCallback = getOpt('maxFileSizeErrorCallback') as Function;
        if (maxFileSizeErrorCallback) {
          maxFileSizeErrorCallback(file, errorCount++);
        }
        return true;
      }
      
      const addFile = (uniqueIdentifier: string) => {
        if (!getFromUniqueIdentifier(uniqueIdentifier)) {
          const resumableFile = createResumableFile(file, uniqueIdentifier);
          setFiles(prevFiles => [...prevFiles, resumableFile]);
          newFiles.push(resumableFile);
          resumableFile.container = (typeof event !== 'undefined' ? (event as any).srcElement : null);
          
          setTimeout(() => {
            fire('fileAdded', resumableFile, event);
          }, 0);
        } else {
          filesSkipped.push(file);
        }
        
        decreaseRemaining();
      };
      
      // Directories have size == 0
      const uniqueIdentifier = generateUniqueIdentifier(file, event, getOpt('generateUniqueIdentifier') as any);
      
      if (uniqueIdentifier && typeof (uniqueIdentifier as any).then === 'function') {
        // Promise or Promise-like object provided as unique identifier
        (uniqueIdentifier as any)
          .then(
            (uid: string) => {
              // Unique identifier generation succeeded
              addFile(uid);
            },
            () => {
              // Unique identifier generation failed
              // Skip further processing, only decrease file count
              decreaseRemaining();
            }
          );
      } else {
        // Non-Promise provided as unique identifier, process synchronously
        addFile(uniqueIdentifier as string);
      }
    });
    
    return true;
  }, [getOpt, fire, files, removeFile, getFromUniqueIdentifier, createResumableFile]);

  // Public API methods
  const upload = useCallback(() => {
    // Make sure we don't start too many uploads at once
    if (isUploading()) return;
    
    // Kick off the queue
    fire('uploadStart');
    for (let num = 1; num <= (getOpt('simultaneousUploads') as number); num++) {
      uploadNextChunk();
    }
  }, [fire, getOpt, uploadNextChunk]);

  const isUploading = useCallback(() => {
    let uploading = false;
    each(files, (file: ResumableFile) => {
      if (file.isUploading()) {
        uploading = true;
        return false;
      }
      return true;
    });
    return uploading;
  }, [files]);

  const pause = useCallback(() => {
    // Resume all chunks currently being uploaded
    each(files, (file: ResumableFile) => {
      file.abort();
    });
    fire('pause');
  }, [fire, files]);

  const cancel = useCallback(() => {
    fire('beforeCancel');
    for (let i = files.length - 1; i >= 0; i--) {
      files[i].cancel();
    }
    fire('cancel');
  }, [fire, files]);

  const progress = useCallback(() => {
    let totalDone = 0;
    let totalSize = 0;
    
    // Resume all chunks currently being uploaded
    each(files, (file: ResumableFile) => {
      totalDone += file.progress() * file.size;
      totalSize += file.size;
    });
    
    return totalSize > 0 ? totalDone / totalSize : 0;
  }, [files]);

  const addFile = useCallback((file: File, event?: Event) => {
    appendFilesFromFileList([file], event);
  }, [appendFilesFromFileList]);

  const addFiles = useCallback((files: FileList | File[], event?: Event) => {
    appendFilesFromFileList(Array.from(files), event);
  }, [appendFilesFromFileList]);

  const getSize = useCallback(() => {
    let totalSize = 0;
    each(files, (file: ResumableFile) => {
      totalSize += file.size;
    });
    return totalSize;
  }, [files]);

  return {
    support,
    files,
    isUploading,
    upload,
    pause,
    cancel,
    progress,
    addFile,
    addFiles,
    removeFile,
    getFromUniqueIdentifier,
    getSize,
    on
  };
};