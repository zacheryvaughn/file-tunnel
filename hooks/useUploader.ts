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
      if (events[i] === eventLower) {
        events[i + 1].apply(null, args);
      }
    }
    
    // Trigger progress events when file events happen
    if (eventLower === 'fileprogress' || eventLower === 'filesuccess' || eventLower === 'fileerror') {
      fire('progress');
    }
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
    
    // Try to find and upload a chunk from any file
    for (const file of currentFiles) {
      if (file.isPaused()) continue;
      
      // Let the file find a chunk to upload
      if (file.upload()) {
        return true;
      }
    }
    
    // Check if all files are complete
    const allComplete = currentFiles.every(file => file.isComplete());
    
    if (allComplete) {
      fire('complete');
    }
    
    return false;
  }, [fire]);

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

  // Create a ResumableFile object - simplified version
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
        
        // Sum up progress across chunks
        let ret = 0;
        let error = false;
        
        each(this.chunks, (c: ResumableChunk) => {
          if (c.status() === 'error') error = true;
          ret += c.progress(true);
        });
        
        ret = (error ? 1 : (ret > 0.99999 ? 1 : ret));
        ret = Math.max(this._prevProgress, ret);
        this._prevProgress = ret;
        return ret;
      },
      
      isUploading: function() {
        for (const chunk of this.chunks) {
          if (chunk.status() === 'uploading') return true;
        }
        return false;
      },
      
      isComplete: function() {
        if (this.chunks.length === 0) return false;
        
        for (const chunk of this.chunks) {
          if (chunk.status() !== 'success') return false;
        }
        return true;
      },
      
      pause: function(pause?: boolean) {
        if (typeof pause === 'undefined') {
          this._pause = !this._pause;
        } else {
          this._pause = pause;
        }
        
        if (this._pause) {
          this.abort();
        } else {
          fire('fileProgress', this);
          uploadNextChunk();
        }
        
        fire('fileProgress', this);
      },
      
      isPaused: function() {
        return this._pause;
      },
      
      abort: function() {
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
        each(this.chunks, (c: ResumableChunk) => {
          if (c.status() === 'uploading') {
            c.abort();
          }
        });
        
        this.chunks = [];
        removeFile(this);
        fire('fileProgress', this);
        uploadNextChunk();
      },
      
      retry: function() {
        this._error = false;
        this.bootstrap();
        fire('uploadStart');
        for (let num = 1; num <= (getOpt('simultaneousUploads') as number); num++) {
          uploadNextChunk();
        }
      },
      
      bootstrap: function() {
        this.abort();
        this._error = false;
        this.chunks = [];
        this._prevProgress = 0;
        
        const chunkSize = getOpt('chunkSize') as number;
        const round = getOpt('forceChunkSize') ? Math.ceil : Math.floor;
        const maxOffset = Math.max(round(this.file.size / chunkSize), 1);
        
        for (let offset = 0; offset < maxOffset; offset++) {
          this.chunks.push(createResumableChunk(
            this,
            offset,
            (event, message) => {
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
                  fire('fileProgress', this, message);
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
        }
        
        setTimeout(() => fire('chunkingComplete', this), 0);
      },
      
      preprocessFinished: function() {
        this.preprocessState = 2;
        this.upload();
      },
      
      upload: function() {
        if (this.isPaused()) return false;
        
        // Find a chunk to upload
        for (const chunk of this.chunks) {
          if (chunk.status() === 'pending') {
            chunk.send();
            return true;
          }
        }
        
        return false;
      }
    };
    
    fire('chunkingStart', resumableFile);
    resumableFile.bootstrap();
    return resumableFile;
  }, [getOpt, fire, removeFile, uploadNextChunk]);

  // Simplified file processing logic
  const appendFilesFromFileList = useCallback((fileList: File[], event?: Event) => {
    const currentFiles = filesRef.current;
    const options = getOpt(['maxFiles', 'maxFileSize', 'fileType']) as any;
    const newFiles: ResumableFile[] = [];
    
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
    
    // Process files synchronously for simplicity
    for (const file of fileList) {
      // Validate file type
      if (options.fileType?.length && !validateFileType(file, options.fileType)) {
        const fileTypeErrorCallback = getOpt('fileTypeErrorCallback') as Function;
        if (fileTypeErrorCallback) fileTypeErrorCallback(file, 0);
        continue;
      }
      
      // Validate file size
      if (options.maxFileSize && file.size > options.maxFileSize) {
        const maxFileSizeErrorCallback = getOpt('maxFileSizeErrorCallback') as Function;
        if (maxFileSizeErrorCallback) maxFileSizeErrorCallback(file, 0);
        continue;
      }
      
      // Generate unique identifier
      const uniqueIdentifier = generateUniqueIdentifier(file, event, getOpt('generateUniqueIdentifier') as any);
      
      // Check if file already exists
      if (getFromUniqueIdentifier(uniqueIdentifier)) {
        continue;
      }
      
      // Create and add the file
      const resumableFile = createResumableFile(file, uniqueIdentifier);
      
      setFiles(prevFiles => [...prevFiles, resumableFile]);
      newFiles.push(resumableFile);
      
      fire('fileAdded', resumableFile, event);
    }
    
    if (newFiles.length > 0) {
      fire('filesAdded', newFiles);
      upload(); // Automatically start upload
    }
    
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