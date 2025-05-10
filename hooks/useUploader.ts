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
  
  // Refs to avoid re-renders and stale closures
  const eventsRef = useRef<any[]>([]);
  const optionsRef = useRef(options);
  const filesRef = useRef<ResumableFile[]>([]);
  const isPausedRef = useRef<boolean>(false);
  
  // Initialize
  useEffect(() => {
    setSupport(checkSupport());
    optionsRef.current = options;
  }, [options]);

  // Keep filesRef in sync with files state
  useEffect(() => {
    console.log(`Files state changed: ${files.length} files with ${files.reduce((sum, file) => sum + file.chunks.length, 0)} total chunks`);
    filesRef.current = files;
  }, [files]);

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
    // Use filesRef.current to avoid stale closure issues
    const currentFiles = filesRef.current;
    
    // If globally paused, don't upload anything
    if (isPausedRef.current) {
      console.log('Upload is globally paused, not uploading next chunk');
      return false;
    }
    
    console.log('uploadNextChunk called - current files:', currentFiles.length, 'with total chunks:',
      currentFiles.reduce((sum, file) => sum + file.chunks.length, 0));
    
    // Safety check - if files array is empty but we know we should have files, don't proceed with completion
    if (currentFiles.length === 0) {
      console.log('No files to upload');
      return false;
    }
    
    let found = false;

    // In some cases it's really handy to upload the first
    // and last chunk of a file quickly; this let's the server check the file's
    // metadata and determine if there's even a point in continuing.
    if (getOpt('prioritizeFirstAndLastChunk')) {
      each(currentFiles, (file: ResumableFile) => {
        // Skip paused files
        if (file.isPaused()) {
          return true;
        }
        
        if (file.chunks.length && file.chunks[0].status() === 'pending' && file.chunks[0].preprocessState === 0) {
          console.log('Prioritizing first chunk of file:', file.fileName);
          file.chunks[0].send();
          found = true;
          return false;
        }
        if (file.chunks.length > 1 && file.chunks[file.chunks.length - 1].status() === 'pending' && file.chunks[file.chunks.length - 1].preprocessState === 0) {
          console.log('Prioritizing last chunk of file:', file.fileName);
          file.chunks[file.chunks.length - 1].send();
          found = true;
          return false;
        }
        return true;
      });
      if (found) {
        console.log('uploadNextChunk returning true (prioritized chunk)');
        return true;
      }
    }

    // Now, simply look for the next, best thing to upload
    each(currentFiles, (file: ResumableFile) => {
      // Skip paused files
      if (file.isPaused()) {
        return true;
      }
      
      // Log chunk statuses for debugging
      let pendingCount = 0;
      let uploadingCount = 0;
      let successCount = 0;
      let errorCount = 0;
      
      each(file.chunks, (chunk: ResumableChunk) => {
        const status = chunk.status();
        if (status === 'pending') pendingCount++;
        if (status === 'uploading') uploadingCount++;
        if (status === 'success') successCount++;
        if (status === 'error') errorCount++;
      });
      
      console.log(`File ${file.fileName} chunks - pending: ${pendingCount}, uploading: ${uploadingCount}, success: ${successCount}, error: ${errorCount}, total: ${file.chunks.length}`);
      
      found = file.upload();
      if (found) {
        console.log('Found next chunk to upload in file:', file.fileName);
        return false;
      }
      return true;
    });
    if (found) {
      console.log('uploadNextChunk returning true (regular chunk)');
      return true;
    }

    // The are no more outstanding chunks to upload, check is everything is done
    let outstanding = false;
    each(currentFiles, (file: ResumableFile) => {
      if (!file.isComplete()) {
        outstanding = true;
        console.log('File not complete:', file.fileName, 'chunks:', file.chunks.length);
        return false;
      }
      return true;
    });
    if (!outstanding) {
      // All chunks have been uploaded, complete
      console.log('All files complete, firing complete event');
      fire('complete');
    } else {
      console.log('Some files not complete, but no chunks to upload');
      
      // Try to find any chunks that might be in a stuck state and retry them
      each(currentFiles, (file: ResumableFile) => {
        // Skip paused files
        if (file.isPaused()) {
          return true;
        }
        
        let foundStuckChunk = false;
        each(file.chunks, (chunk: ResumableChunk) => {
          if (chunk.status() !== 'success' && !chunk.xhr) {
            console.log(`Found potentially stuck chunk ${chunk.offset + 1}, retrying`);
            chunk.send();
            foundStuckChunk = true;
            return false;
          }
          return true;
        });
        if (foundStuckChunk) return false;
        return true;
      });
    }
    console.log('uploadNextChunk returning false (no chunks to upload)');
    return false;
  }, [getOpt, fire]);

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
    console.log(`removeFile called for: ${file.fileName}`);
    console.log(`Current files count before removal: ${files.length}`);
    
    setFiles(prevFiles => {
      const newFiles = prevFiles.filter(f => f !== file);
      console.log(`Files count after removal: ${newFiles.length}`);
      return newFiles;
    });
  }, [files.length]);

  // Get a file by its unique identifier
  const getFromUniqueIdentifier = useCallback((uniqueIdentifier: string): ResumableFile | null => {
    let ret: ResumableFile | null = null;
    
    // Use filesRef.current to avoid stale closure issues
    const currentFiles = filesRef.current;
    
    each(currentFiles, (f: ResumableFile) => {
      if (f.uniqueIdentifier === uniqueIdentifier) {
        ret = f;
        return false;
      }
      return true;
    });
    return ret;
  }, []);

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
        console.log(`isComplete check for ${this.fileName}, chunks: ${this.chunks.length}`);
        
        // If preprocessing is in progress, file is not complete
        if (this.preprocessState === 1) {
          console.log(`${this.fileName} is not complete: preprocessing in progress`);
          return false;
        }
        
        // If there are no chunks, file is not complete (this shouldn't happen normally)
        if (this.chunks.length === 0) {
          console.log(`${this.fileName} is not complete: no chunks`);
          return false;
        }
        
        // Count chunks by status
        let pendingCount = 0;
        let uploadingCount = 0;
        let successCount = 0;
        let errorCount = 0;
        let preprocessingCount = 0;
        
        each(this.chunks, (chunk: ResumableChunk) => {
          const status = chunk.status();
          if (status === 'pending') pendingCount++;
          else if (status === 'uploading') uploadingCount++;
          else if (status === 'success') successCount++;
          else if (status === 'error') errorCount++;
          
          if (chunk.preprocessState === 1) preprocessingCount++;
        });
        
        console.log(`${this.fileName} chunks - pending: ${pendingCount}, uploading: ${uploadingCount}, success: ${successCount}, error: ${errorCount}, preprocessing: ${preprocessingCount}, total: ${this.chunks.length}`);
        
        // File is complete only if all chunks are successful
        const isComplete = pendingCount === 0 && uploadingCount === 0 && preprocessingCount === 0 && successCount === this.chunks.length;
        console.log(`${this.fileName} is ${isComplete ? 'complete' : 'not complete'}`);
        
        return isComplete;
      },
      
      pause: function(pause?: boolean) {
        if (typeof pause === 'undefined') {
          this._pause = !this._pause;
        } else {
          this._pause = pause;
        }
        
        // If pausing, abort any active uploads
        if (this._pause) {
          this.abort();
        } else {
          // If resuming and not globally paused, trigger the upload process
          if (!isPausedRef.current) {
            fire('fileProgress', this);
            uploadNextChunk();
          }
        }
        
        // Trigger event for UI updates
        fire('fileProgress', this);
      },
      
      isPaused: function() {
        // Check both the file's local pause state and the global pause state
        return this._pause || isPausedRef.current;
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
        console.log(`cancel called for file: ${this.fileName}`);
        // Reset this file to be void
        const _chunks = this.chunks;
        const chunkCount = _chunks.length;
        this.chunks = [];
        
        // Stop current uploads
        let abortedChunks = 0;
        each(_chunks, (c: ResumableChunk) => {
          if (c.status() === 'uploading') {
            c.abort();
            abortedChunks++;
          }
        });
        console.log(`Aborted ${abortedChunks} uploading chunks out of ${chunkCount} total chunks`);
        
        console.log(`Removing file ${this.fileName} from files array`);
        removeFile(this);
        fire('fileProgress', this);
        
        // Try to upload next chunk from another file
        uploadNextChunk();
      },
      
      retry: function() {
        this._error = false;
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
                  console.log(`Error in chunk for file ${this.fileName}, but keeping chunks array intact for potential retry`);
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
        console.log(`File.upload called for ${this.fileName}, chunks: ${this.chunks.length}, paused: ${this.isPaused()}`);
        let found = false;
        
        if (this.isPaused() === false) {
          const preprocess = getOpt('preprocessFile');
          
          if (typeof preprocess === 'function') {
            switch (this.preprocessState) {
              case 0:
                this.preprocessState = 1;
                preprocess(this);
                console.log(`File.upload returning true (preprocessing started)`);
                return true;
              case 1:
                console.log(`File.upload returning true (preprocessing in progress)`);
                return true;
              case 2:
                break;
            }
          }
          
          let pendingChunks = 0;
          each(this.chunks, (chunk: ResumableChunk) => {
            if (chunk.status() === 'pending' && chunk.preprocessState !== 1) {
              pendingChunks++;
            }
          });
          console.log(`File ${this.fileName} has ${pendingChunks} pending chunks`);
          
          // Find a chunk to upload
          each(this.chunks, (chunk: ResumableChunk) => {
            if (chunk.status() === 'pending' && chunk.preprocessState !== 1) {
              console.log(`Sending chunk ${chunk.offset + 1}/${this.chunks.length} for ${this.fileName}`);
              chunk.send();
              found = true;
              return false;
            }
            return true;
          });
        }
        
        console.log(`File.upload returning ${found} for ${this.fileName}`);
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
  }, [getOpt, fire, on, removeFile, uploadNextChunk]);

  // Append files from file list
  const appendFilesFromFileList = useCallback((fileList: File[], event?: Event) => {
    // Use filesRef.current to avoid stale closure issues
    const currentFiles = filesRef.current;
    
    // Check for uploading too many files
    let errorCount = 0;
    const o = getOpt(['maxFiles', 'minFileSize', 'maxFileSize', 'fileType']) as any;
    
    if (typeof o.maxFiles !== 'undefined' && o.maxFiles < (fileList.length + currentFiles.length)) {
      // If single-file upload, file is already added, and trying to add 1 new file, simply replace the already-added file
      if (o.maxFiles === 1 && currentFiles.length === 1 && fileList.length === 1) {
        removeFile(currentFiles[0]);
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
  }, [getOpt, fire, removeFile, getFromUniqueIdentifier, createResumableFile]);

  // Public API methods
  const upload = useCallback(() => {
    // Reset global pause state
    isPausedRef.current = false;
    
    // Use filesRef.current to avoid stale closure issues
    const currentFiles = filesRef.current;
    
    // Kick off the queue
    const simultaneousUploads = getOpt('simultaneousUploads') as number;
    console.log(`Starting upload process with simultaneousUploads=${simultaneousUploads}`);
    console.log(`Total files: ${currentFiles.length}, total chunks: ${currentFiles.reduce((sum, file) => sum + file.chunks.length, 0)}`);
    
    fire('uploadStart');
    for (let num = 1; num <= simultaneousUploads; num++) {
      console.log(`Initiating upload for chunk batch ${num}/${simultaneousUploads}`);
      uploadNextChunk();
    }
  }, [fire, getOpt, uploadNextChunk]);

  const isUploading = useCallback(() => {
    let uploading = false;
    // Use filesRef.current to avoid stale closure issues
    const currentFiles = filesRef.current;
    
    each(currentFiles, (file: ResumableFile) => {
      if (file.isUploading()) {
        uploading = true;
        return false;
      }
      return true;
    });
    return uploading;
  }, []);

  const pause = useCallback(() => {
    // Set global pause state
    isPausedRef.current = true;
    
    // Abort all chunks currently being uploaded
    // Use filesRef.current to avoid stale closure issues
    const currentFiles = filesRef.current;
    
    each(currentFiles, (file: ResumableFile) => {
      file.abort();
      // Don't set individual file pause state - that's handled separately
    });
    
    fire('pause');
  }, [fire]);

  const cancel = useCallback(() => {
    // Use filesRef.current to avoid stale closure issues
    const currentFiles = filesRef.current;
    
    console.log(`cancel all called, files count: ${currentFiles.length}`);
    fire('beforeCancel');
    
    // Make a copy of the files array to avoid issues with it changing during iteration
    const filesToCancel = [...currentFiles];
    console.log(`Canceling ${filesToCancel.length} files`);
    
    for (let i = filesToCancel.length - 1; i >= 0; i--) {
      console.log(`Canceling file ${i+1}/${filesToCancel.length}: ${filesToCancel[i].fileName}`);
      filesToCancel[i].cancel();
    }
    
    fire('cancel');
  }, [fire]);

  const progress = useCallback(() => {
    let totalDone = 0;
    let totalSize = 0;
    
    // Use filesRef.current to avoid stale closure issues
    const currentFiles = filesRef.current;
    
    // Calculate progress across all files
    each(currentFiles, (file: ResumableFile) => {
      totalDone += file.progress() * file.size;
      totalSize += file.size;
    });
    
    return totalSize > 0 ? totalDone / totalSize : 0;
  }, []);

  const addFile = useCallback((file: File, event?: Event) => {
    appendFilesFromFileList([file], event);
  }, [appendFilesFromFileList]);

  const addFiles = useCallback((files: FileList | File[], event?: Event) => {
    appendFilesFromFileList(Array.from(files), event);
  }, [appendFilesFromFileList]);

  const getSize = useCallback(() => {
    let totalSize = 0;
    
    // Use filesRef.current to avoid stale closure issues
    const currentFiles = filesRef.current;
    
    each(currentFiles, (file: ResumableFile) => {
      totalSize += file.size;
    });
    return totalSize;
  }, []);

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