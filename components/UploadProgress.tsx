"use client";

import { useState, useEffect, useCallback } from 'react';
import { useUploader } from '../hooks/useUploader';
import { formatSize } from '../utils/uploaderUtils';

interface UploadProgressProps {
  uploader: ReturnType<typeof useUploader>;
  className?: string;
}

export default function UploadProgress({ uploader, className = '' }: UploadProgressProps) {
  const [progress, setProgress] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [uploadedSize, setUploadedSize] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // Update progress whenever files change or progress is made
  const updateProgress = useCallback(() => {
    const currentProgress = uploader.progress();
    setProgress(currentProgress);
    
    const total = uploader.getSize();
    setTotalSize(total);
    setUploadedSize(Math.round(total * currentProgress));
    setIsUploading(uploader.isUploading());
  }, [uploader]);

  useEffect(() => {
    // Set up event listeners for progress updates
    uploader.on('fileProgress', updateProgress);
    uploader.on('fileSuccess', updateProgress);
    uploader.on('fileError', updateProgress);
    uploader.on('fileAdded', updateProgress);
    uploader.on('filesAdded', updateProgress);
    uploader.on('complete', updateProgress);
    uploader.on('progress', updateProgress);
    uploader.on('uploadStart', () => {
      setIsUploading(true);
      updateProgress();
    });
    uploader.on('pause', () => {
      setIsUploading(false);
      updateProgress();
    });
    
    // Initial progress update
    updateProgress();
    
    // Clean up event listeners
    return () => {
      // No explicit cleanup needed as the events are stored in the uploader's internal state
    };
  }, [uploader, updateProgress]);

  // Format the progress percentage
  const progressPercent = Math.round(progress * 100);
  
  // Don't show anything if there are no files
  if (totalSize === 0) {
    return null;
  }

  return (
    <div className={`w-full ${className}`}>
      <div className="flex justify-between items-center mb-2">
        <div className="text-sm font-medium">
          {isUploading ? 'Uploading...' : progressPercent === 100 ? 'Upload complete' : 'Upload paused'}
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {formatSize(uploadedSize)} / {formatSize(totalSize)}
        </div>
      </div>
      
      <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
        <div 
          className={`h-2.5 rounded-full ${
            progressPercent === 100 
              ? 'bg-green-500' 
              : isUploading 
                ? 'bg-blue-500' 
                : 'bg-yellow-500'
          }`}
          style={{ width: `${progressPercent}%` }}
        ></div>
      </div>
      
      <div className="flex justify-between mt-2">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {progressPercent}%
        </div>
        
        <div className="flex gap-2">
          {!isUploading && progressPercent < 100 && (
            <button
              onClick={() => uploader.upload()}
              className="text-sm text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Resume
            </button>
          )}
          
          {isUploading && (
            <button
              onClick={() => uploader.pause()}
              className="text-sm text-yellow-500 hover:text-yellow-700 dark:text-yellow-400 dark:hover:text-yellow-300"
            >
              Pause
            </button>
          )}
          
          {uploader.files.length > 0 && (
            <button
              onClick={() => uploader.cancel()}
              className="text-sm text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Cancel All
            </button>
          )}
        </div>
      </div>
    </div>
  );
}