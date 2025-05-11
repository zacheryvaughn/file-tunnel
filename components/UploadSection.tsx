"use client";

import { useEffect } from 'react';
import { useUploader } from '../hooks/useUploader';
import { formatSize } from '../utils/uploaderUtils';
import UploadDropzone from './UploadDropzone';
import UploadProgress from './UploadProgress';

interface UploadSectionProps {
  className?: string;
  targetUrl?: string;
  maxFileSize?: number;
  maxFiles?: number;
  allowedFileTypes?: string[];
  chunkSize?: number;
  simultaneousUploads?: number;
}

export default function UploadSection({
  className = '',
  targetUrl = '/api/upload',
  maxFileSize = 32 * 1024 * 1024 * 1024, // 1GB
  maxFiles = 80,
  allowedFileTypes = [],
  chunkSize = 8 * 1024 * 1024, // 1MB
  simultaneousUploads = 4
}: UploadSectionProps) {
  // Initialize the uploader with options
  const uploader = useUploader({
    target: targetUrl,
    chunkSize,
    simultaneousUploads,
    maxFileSize,
    maxFiles,
    fileType: allowedFileTypes,
    testChunks: true,
    prioritizeFirstAndLastChunk: true,
    maxChunkRetries: 10,
    chunkRetryInterval: 1000,
    // Error callbacks
    maxFilesErrorCallback: (files, errorCount) => {
      alert(`Error: Too many files. Maximum allowed: ${maxFiles}`);
    },
    maxFileSizeErrorCallback: (file, errorCount) => {
      alert(`Error: File too large. Maximum size: ${formatSize(maxFileSize)}`);
    },
    fileTypeErrorCallback: (file, errorCount) => {
      alert(`Error: Invalid file type for ${file.name}`);
    }
  });

  // Set up event listeners for notifications
  useEffect(() => {
    uploader.on('fileSuccess', (file) => {
      console.log(`File uploaded successfully: ${file.fileName}`);
    });

    uploader.on('fileError', (file, message) => {
      console.error(`Error uploading file ${file.fileName}: ${message}`);
    });

    uploader.on('complete', () => {
      console.log('All uploads completed');
    });
  }, [uploader]);

  return (
    <div className={`w-full max-w-3xl mx-auto ${className}`}>
      <div className="space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2">File Upload</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Upload your files securely with resumable uploads
          </p>
        </div>
        
        <UploadDropzone uploader={uploader} />
        
        <UploadProgress uploader={uploader} />
      </div>
    </div>
  );
}