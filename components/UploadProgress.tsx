"use client";

import { useState, useEffect, useCallback } from 'react';
import { useUploader } from '../hooks/useUploader';
import { ResumableFile } from '../types/uploaderTypes';
import { formatSize } from '../utils/uploaderUtils';
import Image from 'next/image';

interface UploadProgressProps {
  uploader: ReturnType<typeof useUploader>;
  className?: string;
}

export default function UploadProgress({ uploader, className = '' }: UploadProgressProps) {
  // Combined state from both components
  const [progress, setProgress] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [uploadedSize, setUploadedSize] = useState(0);
  const [files, setFiles] = useState<ResumableFile[]>([]);

  // Combined update function for all state
  const updateStatus = useCallback(() => {
    // Update overall progress (from UploadProgress)
    const currentProgress = uploader.progress();
    setProgress(currentProgress);
    
    const total = uploader.getSize();
    setTotalSize(total);
    setUploadedSize(Math.round(total * currentProgress));
    
    // Update files list (from UploadQueue)
    setFiles([...uploader.files]);
  }, [uploader]);

  useEffect(() => {
    // Combined event listeners from both components
    const events = [
      'fileProgress', 'fileSuccess', 'fileError', 'fileAdded',
      'filesAdded', 'fileRemoved', 'complete', 'progress'
    ];
    
    // Register all events with the same handler
    events.forEach(event => uploader.on(event, updateStatus));
    
    // Special case for uploadStart
    uploader.on('uploadStart', () => {
      updateStatus();
    });
    
    // Initial update
    updateStatus();
    
    // No explicit cleanup needed
  }, [uploader, updateStatus]);

  // Format the progress percentage
  const progressPercent = Math.round(progress * 100);
  
  // Don't show anything if there are no files
  if (totalSize === 0) {
    return null;
  }

  // Helper function to get file extension (from UploadQueue)
  const getFileIcon = (filename: string) => {
    return '/file.svg';
  };

  return (
    <div className={`w-full ${className}`}>
      {/* Overall Progress Section */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <div className="text-sm font-medium">
            {progress > 0 && progress < 1 ? 'Uploading...' : progress === 0 ? 'Waiting...' : ''}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {formatSize(uploadedSize)} / {formatSize(totalSize)}
          </div>
        </div>
        
        <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
          <div
            className="h-2.5 rounded-full bg-blue-500"
            style={{ width: `${progressPercent}%` }}
          ></div>
        </div>
        
        <div className="flex justify-between mt-2">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {progressPercent}%
          </div>
        </div>
      </div>
      
      {/* Files List Section (from UploadQueue) */}
      {files.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-medium mb-4">Files ({files.length})</h3>
          
          <div className="space-y-3">
            {files.map((file) => {
              const progress = file.progress();
              const progressPercent = Math.round(progress * 100);
              const isComplete = file.isComplete();
              const hasError = file._error;
              
              return (
                <div
                  key={file.uniqueIdentifier}
                  className="border rounded-lg p-3 bg-white dark:bg-gray-800 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 flex-shrink-0">
                      <Image
                        src={getFileIcon(file.fileName)}
                        alt={file.fileName}
                        width={40}
                        height={40}
                        className="opacity-70"
                      />
                    </div>
                    
                    <div className="flex-grow min-w-0">
                      <div className="flex justify-between items-start">
                        <div className="truncate font-medium text-sm">
                          {file.fileName}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 ml-2 flex-shrink-0">
                          {formatSize(file.size)}
                        </div>
                      </div>
                      
                      <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2 dark:bg-gray-700">
                        <div
                          className={`h-1.5 rounded-full ${hasError ? 'bg-red-500' : 'bg-blue-500'}`}
                          style={{ width: `${progressPercent}%` }}
                        ></div>
                      </div>
                      
                      <div className="flex justify-between items-center mt-2">
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {hasError ? 'Error' : `${progressPercent}%`}
                        </div>
                        
                        <div className="flex gap-2">
                          {hasError && (
                            <button
                              onClick={() => file.retry()}
                              className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}