import React from 'react';
import { Loader2, Layers, Sparkles } from 'lucide-react';

interface ExtractionProgressProps {
  loadingStatus: 'Uploading' | 'Processing page 1/4' | string;
  currentPage: number;
  totalPages: number;
  fileName: string;
}

export const ExtractionProgress: React.FC<ExtractionProgressProps> = ({
  loadingStatus,
  currentPage,
  totalPages,
  fileName
}) => {
  let estimatedProgress = 20;
  if (loadingStatus.includes('Uploading')) estimatedProgress = 25;
  else if (loadingStatus.includes('Processing')) estimatedProgress = Math.round(25 + (currentPage / Math.max(totalPages, 1)) * 45);
  else if (loadingStatus.includes('Extracting')) estimatedProgress = 80;
  else if (loadingStatus.includes('Preparing')) estimatedProgress = 95;
  else if (loadingStatus.includes('Ready')) estimatedProgress = 100;

  return (
    <div className="bg-slate-900 text-white p-7 rounded-3xl border border-slate-800 shadow-2xl mb-8 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5 select-none">
        
        <div className="flex items-center space-x-3.5">
          <div className="p-3 bg-cyan-500/20 text-cyan-400 rounded-2xl border border-cyan-500/30 flex items-center justify-center shadow-inner">
            <Loader2 className="w-7 h-7 animate-spin text-cyan-400" />
          </div>
          <div>
            <h3 className="font-extrabold text-lg tracking-tight flex items-center space-x-2">
              <span>Extracting Customer Data</span>
              <span className="text-[11px] font-bold px-2.5 py-0.5 bg-slate-800 text-cyan-300 rounded-full border border-slate-700">
                In Progress
              </span>
            </h3>
            <p className="text-xs text-slate-400 truncate max-w-md mt-0.5 font-sans font-medium">Target Document: {fileName}</p>
          </div>
        </div>

        <div className="flex items-center justify-between md:flex-col md:items-end">
          <span className="text-3xl font-black text-cyan-400 tracking-tight">{estimatedProgress}%</span>
          <p className="text-xs text-slate-400 font-bold mt-1 flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span>Page {currentPage} of {totalPages}</span>
          </p>
        </div>

      </div>

      {/* Modern Gradient Progress Track */}
      <div className="w-full bg-slate-800/90 h-3.5 rounded-full overflow-hidden p-0.5 border border-slate-700/60 mb-4 shadow-inner">
        <div
          className="bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 h-full rounded-full transition-all duration-300 shadow-lg shadow-cyan-500/30"
          style={{ width: `${estimatedProgress}%` }}
        />
      </div>

      {/* Explicit Loading Phase Banner */}
      <div className="p-3.5 bg-slate-800/50 rounded-2xl border border-slate-700/50 flex items-center justify-between text-xs font-medium">
        <div className="flex items-center space-x-2.5 text-cyan-300 font-bold text-sm">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
          <span className="tracking-wide font-sans">{loadingStatus}</span>
        </div>
        <div className="flex items-center space-x-1.5 text-slate-400 font-sans text-xs">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>Secure Automated Scanning</span>
        </div>
      </div>

    </div>
  );
};
