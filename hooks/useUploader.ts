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
  generateUniqueIdentifier,
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
  
  // Initialize
  useEffect(() => {
    setSupport(checkSupport());
    optionsRef.current = options;
  }, [options]);

  // Keep filesRef in sync with files state
  useEffect(() => {
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

  // Simplified event system
  const fire = useCallback((event: string, ...args: any[]) => {
    const eventLower = event.toLowerCase();
    const events = eventsRef.current;
    
    // Find matching event listeners
    for (let i = 0; i < events.length; i += 2) {
      if (events[i] === eventLower || events[i] === 'catchall') {
        events[i + 1].apply(null, events[i] === 'catchall' ? [event, ...args] : args);
      }
    }
    
    // Handle special events
    if (eventLower === 'fileerror') fire('error', args[1], args[0]);
    if (eventLower === 'fileprogress') fire('progress');
  }, []);

  // Event registration with support for multiple events
  const on = useCallback((event: string | string[], callback: (...args: any[]) => void) => {
    if (Array.isArray(event)) {
      event.forEach(e => eventsRef.current.push(e.toLowerCase(), callback));
    } else {
      eventsRef.current.push(event.toLowerCase(), callback);
    }
  }, []);

  // Simplified upload management
  const uploadNextChunk = useCallback(() => {
    const currentFiles = filesRef.current;
    
    // Early return if no files
    if (currentFiles.length === 0) return false;
    
    // Try to find and upload a chunk
    const uploadChunk = (file: ResumableFile, chunkIndex?: number): boolean => {
      if (file.isPaused()) return false;
      
      if (typeof chunkIndex === 'number') {
        // Upload specific chunk
        if (file.chunks[chunkIndex]?.status() === 'pending' &&
            file.chunks[chunkIndex].preprocessState === 0) {
          file.chunks[chunkIndex].send();
          return true;
        }
        return false;
      } else {
        // Let the file find a chunk to upload
        return file.upload();
      }
    };
    
    // 1. First try prioritized chunks if enabled
    if (getOpt('prioritizeFirstAndLastChunk')) {
      for (const file of currentFiles) {
        // Try first chunk
        if (uploadChunk(file, 0)) return true;
        
        // Try last chunk
        if (file.chunks.length > 1 && uploadChunk(file, file.chunks.length - 1)) return true;
      }
    }
    
    // 2. Try regular chunks
    for (const file of currentFiles) {
      if (uploadChunk(file)) return true;
    }
    
    // 3. Check if all files are complete
    const allComplete = currentFiles.every(file => file.isComplete());
    
    if (allComplete) {
      fire('complete');
    } else {
      // 4. Try to find and retry stuck chunks
      for (const file of currentFiles) {
        if (file.isPaused()) continue;
        
        for (const chunk of file.chunks) {
          if (chunk.status() !== 'success' && !chunk.xhr) {
            chunk.send();
            return true;
          }
        }
      }
    }
    
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
    setFiles(prevFiles => {
      const newFiles = prevFiles.filter(f => f !== file);
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
        
        // Count completed chunks instead of summing weighted progress
        // This provides more reliable progress for files with uneven chunk sizes
        let completedChunks = 0;
        let totalChunks = this.chunks.length;
        
        if (totalChunks === 0) return 0;
        
        each(this.chunks, (c: ResumableChunk) => {
          if (c.status() === 'success') {
            completedChunks++;
          } else if (c.status() === 'uploading' && c.loaded > 0) {
            // Add partial progress for currently uploading chunks
            completedChunks += (c.loaded / (c.endByte - c.startByte));
          }
        });
        
        let ret = completedChunks / totalChunks;
        ret = (ret > 0.99999 ? 1 : ret); // Round to 100% if very close
        ret = Math.max(this._prevProgress, ret); // Don't lose percentages when paused
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
        // If preprocessing is in progress, file is not complete
        if (this.preprocessState === 1) {
          return false;
        }
        
        // If there are no chunks, file is not complete
        if (this.chunks.length === 0) {
          return false;
        }
        
        // Simplified completion check - just verify all chunks are successful
        let allSuccessful = true;
        
        each(this.chunks, (chunk: ResumableChunk) => {
          if (chunk.status() !== 'success' || chunk.preprocessState === 1) {
            allSuccessful = false;
            return false; // Break the loop early
          }
          return true;
        });
        
        return allSuccessful;
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
          // If resuming, trigger the upload process
          fire('fileProgress', this);
          uploadNextChunk();
        }
        
        // Trigger event for UI updates
        fire('fileProgress', this);
      },
      
      isPaused: function() {
        // Only check the file's local pause state
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
          }
        });
        
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
          
          // Find a chunk to upload
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
  }, [getOpt, fire, on, removeFile, uploadNextChunk]);

  // Simplified file processing logic
  const appendFilesFromFileList = useCallback((fileList: File[], event?: Event) => {
    const currentFiles = filesRef.current;
    const options = getOpt(['maxFiles', 'minFileSize', 'maxFileSize', 'fileType']) as any;
    const newFiles: ResumableFile[] = [];
    const filesSkipped: File[] = [];
    
    // Handle max files limit
    if (options.maxFiles && options.maxFiles < (fileList.length + currentFiles.length)) {
      // Special case for single file replacement
      if (options.maxFiles === 1 && currentFiles.length === 1 && fileList.length === 1) {
        removeFile(currentFiles[0]);
      } else {
        const maxFilesErrorCallback = getOpt('maxFilesErrorCallback') as Function;
        if (maxFilesErrorCallback) {
          maxFilesErrorCallback(fileList, 0);
        }
        return false;
      }
    }
    
    // Process files in parallel with Promise.all
    Promise.all(
      Array.from(fileList).map(async (file) => {
        // Validate file type
        if (!validateFileType(file, options.fileType)) {
          const fileTypeErrorCallback = getOpt('fileTypeErrorCallback') as Function;
          if (fileTypeErrorCallback) fileTypeErrorCallback(file, 0);
          return null;
        }
        
        // Validate file size
        if (options.minFileSize && file.size < options.minFileSize) {
          const minFileSizeErrorCallback = getOpt('minFileSizeErrorCallback') as Function;
          if (minFileSizeErrorCallback) minFileSizeErrorCallback(file, 0);
          return null;
        }
        
        if (options.maxFileSize && file.size > options.maxFileSize) {
          const maxFileSizeErrorCallback = getOpt('maxFileSizeErrorCallback') as Function;
          if (maxFileSizeErrorCallback) maxFileSizeErrorCallback(file, 0);
          return null;
        }
        
        // Generate unique identifier
        let uniqueIdentifier = generateUniqueIdentifier(file, event, getOpt('generateUniqueIdentifier') as any);
        
        // Handle promise-based identifiers
        if (uniqueIdentifier && typeof (uniqueIdentifier as any).then === 'function') {
          try {
            uniqueIdentifier = await (uniqueIdentifier as any);
          } catch (e) {
            return null;
          }
        }
        
        // Check if file already exists
        if (getFromUniqueIdentifier(uniqueIdentifier as string)) {
          filesSkipped.push(file);
          return null;
        }
        
        // Create and add the file
        const resumableFile = createResumableFile(file, uniqueIdentifier as string);
        resumableFile.container = (typeof event !== 'undefined' ? (event as any).srcElement : null);
        
        setFiles(prevFiles => [...prevFiles, resumableFile]);
        newFiles.push(resumableFile);
        
        fire('fileAdded', resumableFile, event);
        return resumableFile;
      })
    ).then(() => {
      if (newFiles.length > 0 || filesSkipped.length > 0) {
        fire('filesAdded', newFiles, filesSkipped);
        
        // Automatically start upload when files are added
        if (newFiles.length > 0) {
          upload();
        }
      }
    });
    
    return true;
  }, [getOpt, fire, removeFile, getFromUniqueIdentifier, createResumableFile]);
  
  // Helper function to validate file type
  const validateFileType = useCallback((file: File, allowedTypes?: string[]) => {
    if (!allowedTypes || allowedTypes.length === 0) return true;
    
    const fileName = file.name;
    const fileType = file.type;
    
    for (let type of allowedTypes) {
      // Sanitize: remove spaces and lowercase
      type = type.replace(/\s/g, '').toLowerCase();
      
      // Format as extension if needed
      const extension = (type.match(/^[^.][^/]+$/) ? '.' : '') + type;
      
      // Check file extension
      if (fileName.toLowerCase().endsWith(extension)) return true;
      
      // Check MIME type
      if (extension.includes('/')) {
        if (extension.includes('*')) {
          const wildcard = extension.split('*')[0];
          if (fileType.startsWith(wildcard)) return true;
        } else if (fileType === extension) {
          return true;
        }
      }
    }
    
    return false;
  }, []);

  // Public API methods
  const upload = useCallback(() => {
    // Use filesRef.current to avoid stale closure issues
    const currentFiles = filesRef.current;
    
    // Kick off the queue
    const simultaneousUploads = getOpt('simultaneousUploads') as number;
    
    fire('uploadStart');
    for (let num = 1; num <= simultaneousUploads; num++) {
      uploadNextChunk();
    }
  }, [fire, getOpt, uploadNextChunk]);

  // Simplified isUploading method - just checks if any file has progress between 0-100%
  const isUploading = useCallback(() => {
    const currentFiles = filesRef.current;
    
    // If there are no files, we're not uploading
    if (currentFiles.length === 0) return false;
    
    // Calculate total progress directly
    let totalDone = 0;
    let totalSize = 0;
    
    each(currentFiles, (file: ResumableFile) => {
      totalDone += file.progress() * file.size;
      totalSize += file.size;
    });
    
    const totalProgress = totalSize > 0 ? totalDone / totalSize : 0;
    return totalProgress > 0 && totalProgress < 1;
  }, []);

  // Simplified to just abort uploads without pausing
  const cancel = useCallback(() => {
    // Use filesRef.current to avoid stale closure issues
    const currentFiles = filesRef.current;
    
    fire('beforeCancel');
    
    // Make a copy of the files array to avoid issues with it changing during iteration
    const filesToCancel = [...currentFiles];
    
    for (let i = filesToCancel.length - 1; i >= 0; i--) {
      filesToCancel[i].cancel();
    }
    
    fire('cancel');
  }, [fire]);

  // Cancel function is already defined above

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