import React, { useState } from 'react';
import { ExtractedRow } from '../types';
import { 
  Trash2, Edit3, FileSpreadsheet, FileText as FilePdfIcon, CheckCircle2, AlertTriangle, RefreshCw, Layers 
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { exportToExcelBrowser, exportToPdfBrowser } from '../services/exportService';
import { expressApiClient } from '../services/apiClient';

interface DataTableProps {
  rows: ExtractedRow[];
  setRows: React.Dispatch<React.SetStateAction<ExtractedRow[]>>;
  onEditRow: (row: ExtractedRow) => void;
  onReset: () => void;
}

export const DataTable: React.FC<DataTableProps> = ({ rows, setRows, onEditRow, onReset }) => {
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // If total records are 0, hide preview table entirely as requested!
  if (rows.length === 0) {
    return null;
  }

  const handleDelete = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const fireSuccessConfetti = () => {
    try {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    } catch {
      // ignore
    }
  };

  const handleExportExcel = async () => {
    console.log("Download Excel clicked - filename: Extracted_Data.xlsx");
    if (rows.length === 0) return;
    setIsExportingExcel(true);

    try {
      try {
        await expressApiClient.exportExcel(rows, true);
        fireSuccessConfetti();
      } catch (err) {
        console.warn('Express server Excel export fallback...', err);
        exportToExcelBrowser(rows, true);
        fireSuccessConfetti();
      }
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportPdf = async () => {
    console.log("Download PDF clicked - filename: Extracted_Data_Report.pdf");
    if (rows.length === 0) return;
    setIsExportingPdf(true);

    try {
      try {
        await expressApiClient.exportPdf(rows, 'Paisadu Data Extractor Executive Report', true);
        fireSuccessConfetti();
      } catch (err) {
        console.warn('Express server PDF export fallback...', err);
        exportToPdfBrowser(rows, 'Paisadu Data Extractor Executive Report', true);
        fireSuccessConfetti();
      }
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Small Summary counts
  const okCount = rows.filter(r => r.status === 'OK' && !r.needsReview).length;
  const reviewCount = rows.filter(r => r.status === 'Needs Review' || r.needsReview).length;
  const missingAmountReviewCount = rows.filter(
    r => (r.status === 'Needs Review' || r.needsReview) && 
         (!r.amount || parseFloat(r.amount.toString()) === 0 || r.amount.toString() === '0')
  ).length;

  return (
    <div id="extraction-results-table" className="w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden mt-8 animate-fadeIn select-none">
      
      {/* Table Header Bar with Small Summary & Export Buttons Clearly Visible Above Table */}
      <div className="p-6 sm:p-7 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-5 select-none shadow-sm">
        
        {/* Left Summary */}
        <div className="flex items-center space-x-3.5">
          <div className="p-2.5 bg-blue-500/10 text-blue-500 dark:text-cyan-400 rounded-2xl shadow-inner">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-extrabold text-slate-900 dark:text-white text-lg tracking-tight">
              Extracted Data Preview
            </h3>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center space-x-2.5 mt-1 font-mono font-medium">
              <span>Total: <strong className="text-slate-800 dark:text-slate-200">{rows.length}</strong></span>
              <span>•</span>
              <span className="text-emerald-600 dark:text-emerald-400">OK: <strong>{okCount}</strong></span>
              {reviewCount > 0 && (
                <>
                  <span>•</span>
                  <span className="text-rose-600 dark:text-rose-400">Needs Review: <strong>{reviewCount}</strong></span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Action Buttons Clearly Visible Above Table */}
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          
          {/* Download Excel */}
          <button
            onClick={handleExportExcel}
            disabled={isExportingExcel}
            className="flex-1 sm:flex-none flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs rounded-xl shadow-md transition transform hover:scale-105 cursor-pointer disabled:opacity-50"
            title="Download extracted records as an Excel spreadsheet (.XLSX)"
          >
            {isExportingExcel ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Generating Excel...</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-4 h-4 text-emerald-200" />
                <span>Download Excel</span>
              </>
            )}
          </button>

          {/* Download PDF */}
          <button
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            className="flex-1 sm:flex-none flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-extrabold text-xs rounded-xl shadow-md transition transform hover:scale-105 cursor-pointer disabled:opacity-50"
            title="Download extracted records as an Executive PDF report"
          >
            {isExportingPdf ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Generating PDF...</span>
              </>
            ) : (
              <>
                <FilePdfIcon className="w-4 h-4 text-rose-200" />
                <span>Download PDF</span>
              </>
            )}
          </button>

          {/* Upload New File */}
          <button
            onClick={onReset}
            className="w-full sm:w-auto flex items-center justify-center space-x-1.5 px-5 py-3 bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-xs transition cursor-pointer shadow-sm"
            title="Clear current workspace and upload another PDF or image file"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            <span>Upload New File</span>
          </button>

        </div>

      </div>

      {missingAmountReviewCount >= 3 && (
        <div className="mx-6 my-4 p-4 bg-amber-500/10 text-amber-800 dark:text-amber-200 border border-amber-500/30 rounded-2xl flex items-start space-x-3 select-none animate-fadeIn">
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <p className="text-xs sm:text-sm font-bold leading-relaxed">
            Some rows may need manual review because the source PDF page may be truncated or the amount column may be missing.
          </p>
        </div>
      )}

      {/* Main Extracted Records Table */}
      <div className="overflow-x-auto min-h-[220px]">
        <table className="w-full text-left border-collapse font-sans">
          <thead>
            <tr className="bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 uppercase font-black text-xs tracking-wider border-b border-slate-200 dark:border-slate-800 select-none">
              <th className="py-4 px-5 w-16 text-center">S.No</th>
              <th className="py-4 px-4 w-24 text-center">Page No</th>
              <th className="py-4 px-6">City</th>
              <th className="py-4 px-6 font-mono font-bold">Phone Number</th>
              <th className="py-4 px-6 text-right">Amount</th>
              <th className="py-4 px-6 text-center">Status</th>
              <th className="py-4 px-6 max-w-xs">Original OCR Text</th>
              <th className="py-4 px-6 text-right">Edit / Action</th>
            </tr>
          </thead>
          
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm font-bold">
            {rows.map((row, idx) => {
              const isReview = row.status === 'Needs Review' || row.needsReview;
              return (
                <tr
                  key={row.id}
                  className={`transition-colors hover:bg-cyan-50/60 dark:hover:bg-slate-800/60 ${
                    isReview ? 'bg-rose-50/50 dark:bg-rose-950/20' : ''
                  }`}
                >
                  <td className="py-4 px-5 font-mono text-xs text-slate-500 dark:text-slate-400 text-center font-black">
                    {row.sNo || row.rowNumber || idx + 1}
                  </td>

                  <td className="py-4 px-4 text-center font-mono">
                    <span className="px-2.5 py-1 bg-slate-200 dark:bg-slate-700/80 rounded-xl text-xs font-black text-slate-900 dark:text-slate-100 shadow-inner">
                      Page {row.pageNo || row.pageNumber || 1}
                    </span>
                  </td>

                  <td className="py-4 px-6 font-black text-slate-950 dark:text-white text-base tracking-tight">
                    {row.city || <span className="text-rose-500 italic font-medium">Missing</span>}
                  </td>

                  <td className="py-4 px-6 font-mono text-blue-600 dark:text-cyan-400 font-extrabold tracking-wide text-base">
                    {row.phoneNumber || <span className="text-rose-500 italic font-medium">Missing</span>}
                  </td>

                  <td className="py-4 px-6 text-right font-black font-mono text-emerald-600 dark:text-emerald-400 text-lg">
                    ₹{Number(row.amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </td>

                  <td className="py-4 px-6 text-center">
                    {row.status === 'OK' ? (
                      <span className="inline-flex items-center space-x-1.5 px-3 py-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40 rounded-full font-black text-xs shadow-sm select-none">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span>OK</span>
                      </span>
                    ) : row.status === 'Source Truncated / Missing Amount' ? (
                      <span 
                        className="inline-flex items-center space-x-1.5 px-3 py-1 bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40 rounded-full font-black text-xs cursor-pointer hover:bg-amber-500/25 transition shadow-sm"
                        onClick={() => onEditRow(row)}
                        title="Source Truncated / Missing Amount. Click edit icon to resolve."
                      >
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span>Source Truncated</span>
                      </span>
                    ) : row.status === 'Low OCR Confidence' ? (
                      <span 
                        className="inline-flex items-center space-x-1.5 px-3 py-1 bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/40 rounded-full font-black text-xs cursor-pointer hover:bg-purple-500/25 transition shadow-sm"
                        onClick={() => onEditRow(row)}
                        title="Low OCR Confidence. Click edit icon to resolve."
                      >
                        <AlertTriangle className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                        <span>Low OCR Confidence</span>
                      </span>
                    ) : (
                      <span 
                        className="inline-flex items-center space-x-1.5 px-3 py-1 bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40 rounded-full font-black text-xs cursor-pointer hover:bg-rose-500/25 transition shadow-sm"
                        onClick={() => onEditRow(row)}
                        title="Needs review. Click edit icon to resolve."
                      >
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                        <span>Needs Review</span>
                      </span>
                    )}
                  </td>

                  <td className="py-4 px-6 font-mono text-xs text-slate-600 dark:text-slate-400 max-w-xs break-all select-all font-normal">
                    {row.originalOcrText || '--'}
                  </td>

                  <td className="py-4 px-6 text-right space-x-2">
                    <button
                      onClick={() => onEditRow(row)}
                      className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-cyan-500 hover:text-white text-slate-700 dark:text-slate-200 rounded-xl transition shadow-sm transform hover:scale-105 cursor-pointer"
                      title="Edit Row Data"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    
                    <button
                      onClick={() => handleDelete(row.id)}
                      className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-rose-500 hover:text-white text-slate-700 dark:text-slate-200 rounded-xl transition shadow-sm transform hover:scale-105 cursor-pointer"
                      title="Delete Record"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>

        </table>
      </div>

    </div>
  );
};
