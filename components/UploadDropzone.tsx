"use client";

import { useState, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useUploader } from '../hooks/useUploader';

interface UploadDropzoneProps {
  uploader: ReturnType<typeof useUploader>;
  className?: string;
}

export default function UploadDropzone({ uploader, className = '' }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Drag event handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);
  
  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploader.addFiles(e.dataTransfer.files, e.nativeEvent);
    }
  }, [uploader]);
  
  // Handle file selection via input
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploader.addFiles(e.target.files, e.nativeEvent);
      // Reset input to allow selecting the same file again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [uploader]);
  
  // Handle click to open file dialog
  const handleClick = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  return (
    <div 
      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
        ${isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-600'}
        ${className}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        onChange={handleFileInputChange} 
        multiple 
      />
      
      <div className="flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 mb-2 opacity-70">
          <Image src="/file.svg" alt="Upload files" width={64} height={64} />
        </div>
        <h3 className="text-lg font-medium">
          {isDragging ? 'Drop files here' : 'Drag & drop files here'}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          or click to browse your files
        </p>
      </div>
    </div>
  );
}