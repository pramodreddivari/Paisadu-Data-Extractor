import React, { useState, useCallback } from 'react';
import { UploadCloud, FileText, Play } from 'lucide-react';

interface FileUploaderProps {
  onFileUpload: (file: File) => void;
  isLoading: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onFileUpload, isLoading }) => {
  const [stagedFile, setStagedFile] = useState<File | null>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (isLoading) return;

      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0 && droppedFiles[0]) {
        setStagedFile(droppedFiles[0]);
      }
    },
    [isLoading]
  );

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && e.target.files[0]) {
      setStagedFile(e.target.files[0]);
    }
  };

  const handleTriggerExtract = () => {
    if (stagedFile && !isLoading) {
      onFileUpload(stagedFile);
    }
  };

  return (
    <div className="max-w-2xl mx-auto w-full bg-white dark:bg-slate-900 p-8 sm:p-10 rounded-3xl border-2 border-dashed border-slate-300 dark:border-slate-800 hover:border-cyan-500 transition-all shadow-xl select-none relative group animate-fadeIn">
      
      {!stagedFile && (
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
          onChange={handleFileChange}
          disabled={isLoading}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
          title="Click or drag file here"
        />
      )}

      <div 
        onDrop={handleDrop} 
        onDragOver={handleDragOver} 
        className="flex flex-col items-center justify-center text-center"
      >
        <div className="p-4 bg-cyan-50 dark:bg-slate-800/80 rounded-2xl text-cyan-600 dark:text-cyan-400 mb-4 group-hover:scale-105 transition-transform shadow-inner">
          <UploadCloud className="w-10 h-10" />
        </div>

        <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          {stagedFile ? 'Document Selected' : 'Upload PDF or Image File'}
        </h2>
        
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-md font-medium">
          {stagedFile ? (
            <span className="flex items-center justify-center space-x-1.5 font-mono text-slate-800 dark:text-slate-200">
              <FileText className="w-4 h-4 text-cyan-500 inline" />
              <span className="truncate max-w-xs">{stagedFile.name}</span>
              <span className="text-xs text-slate-400">({(stagedFile.size / (1024*1024)).toFixed(2)} MB)</span>
            </span>
          ) : (
            <span>Click to browse or drag and drop your scanned file here</span>
          )}
        </p>

        {/* Action Buttons */}
        {stagedFile && (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-6 w-full z-20">
            <button
              onClick={() => setStagedFile(null)}
              disabled={isLoading}
              className="w-full sm:w-auto px-5 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-xs transition cursor-pointer disabled:opacity-50"
            >
              Change File
            </button>

            <button
              onClick={handleTriggerExtract}
              disabled={isLoading}
              className="w-full sm:w-auto flex items-center justify-center space-x-2 px-8 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white rounded-xl font-black text-sm shadow-lg shadow-cyan-500/25 transition transform hover:scale-105 cursor-pointer disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Extract Data</span>
                </>
              )}
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
