"use client";

import { useState, useEffect } from 'react';
import { useUploader } from '../hooks/useUploader';
import { ResumableFile } from '../types/uploaderTypes';
import { formatSize } from '../utils/uploaderUtils';
import Image from 'next/image';

interface UploadQueueProps {
  uploader: ReturnType<typeof useUploader>;
  className?: string;
}

export default function UploadQueue({ uploader, className = '' }: UploadQueueProps) {
  const [files, setFiles] = useState<ResumableFile[]>([]);

  // Update files whenever the uploader's files change
  useEffect(() => {
    const updateFiles = () => {
      setFiles([...uploader.files]);
    };

    // Set up event listeners
    uploader.on('fileAdded', updateFiles);
    uploader.on('filesAdded', updateFiles);
    uploader.on('fileRemoved', updateFiles);
    uploader.on('fileProgress', updateFiles);
    uploader.on('fileSuccess', updateFiles);
    uploader.on('fileError', updateFiles);
    uploader.on('complete', updateFiles);

    // Initial update
    updateFiles();

    // No explicit cleanup needed as the events are stored in the uploader's internal state
  }, [uploader]);

  // Helper function to get file extension
  const getFileExtension = (filename: string) => {
    return filename.slice((filename.lastIndexOf('.') - 1 >>> 0) + 2).toLowerCase();
  };

  // Helper function to get file icon based on extension
  const getFileIcon = (filename: string) => {
    const ext = getFileExtension(filename);
    // You could add more specific icons based on file type
    return '/file.svg';
  };

  // Don't show anything if there are no files
  if (files.length === 0) {
    return null;
  }

  return (
    <div className={`w-full ${className}`}>
      <h3 className="text-lg font-medium mb-4">Files ({files.length})</h3>
      
      <div className="space-y-3">
        {files.map((file) => {
          const progress = file.progress();
          const progressPercent = Math.round(progress * 100);
          const isUploading = file.isUploading();
          const isComplete = file.isComplete();
          const isPaused = file.isPaused();
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
                      className={`h-1.5 rounded-full ${
                        hasError 
                          ? 'bg-red-500' 
                          : isComplete 
                            ? 'bg-green-500' 
                            : isUploading 
                              ? 'bg-blue-500' 
                              : 'bg-yellow-500'
                      }`}
                      style={{ width: `${progressPercent}%` }}
                    ></div>
                  </div>
                  
                  <div className="flex justify-between items-center mt-2">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {hasError 
                        ? 'Error' 
                        : isComplete 
                          ? 'Complete' 
                          : isUploading 
                            ? `Uploading: ${progressPercent}%` 
                            : isPaused 
                              ? 'Paused' 
                              : 'Waiting...'}
                    </div>
                    
                    <div className="flex gap-2">
                      {!isComplete && !hasError && (
                        <>
                          {isPaused ? (
                            <button
                              onClick={() => file.pause(false)}
                              className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              Resume
                            </button>
                          ) : (
                            <button
                              onClick={() => file.pause(true)}
                              className="text-xs text-yellow-500 hover:text-yellow-700 dark:text-yellow-400 dark:hover:text-yellow-300"
                            >
                              Pause
                            </button>
                          )}
                        </>
                      )}
                      
                      {hasError && (
                        <button
                          onClick={() => file.retry()}
                          className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          Retry
                        </button>
                      )}
                      
                      <button
                        onClick={() => file.cancel()}
                        className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}