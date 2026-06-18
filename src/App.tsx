import React, { useState, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { FileUploader } from './components/FileUploader';
import { ExtractionProgress } from './components/ExtractionProgress';
import { DataTable } from './components/DataTable';
import { EditRowModal } from './components/EditRowModal';
import { expressApiClient } from './services/apiClient';
import { ApiExtractResponse, ExtractedRow } from './types';
import { AlertCircle, X } from 'lucide-react';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const AppComponent: React.FC = () => {
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  
  // Simple customer alert bar (only shown after a failed extraction attempt)
  const [serverAlert, setServerAlert] = useState<string | null>(null);

  const [ocrProgress, setOcrProgress] = useState<{
    active: boolean;
    loadingStatus: string;
    currentPage: number;
    totalPages: number;
    fileName: string;
  }>({
    active: false,
    loadingStatus: 'Uploading',
    currentPage: 1,
    totalPages: 1,
    fileName: ''
  });

  const [editingRow, setEditingRow] = useState<ExtractedRow | null>(null);

  const applyExtractionResult = useCallback((apiRes: ApiExtractResponse) => {
    if (!apiRes.rows || apiRes.rows.length === 0) {
      throw new Error(apiRes.message || 'Empty extracted data. We could not detect any valid customer records or amounts in this document.');
    }

    const finalizedRows: ExtractedRow[] = apiRes.rows.map((r, i) => ({
      ...r,
      id: `rec-${Date.now()}-${i}`,
      sNo: r.sNo || i + 1,
      rowNumber: r.rowNumber || r.sNo || i + 1,
      pageNo: r.pageNo || r.pageNumber || 1,
      pageNumber: r.pageNumber || r.pageNo || 1,
      status: r.status || (r.needsReview ? 'Needs Review' : 'OK')
    }));

    setRows(finalizedRows);

    setTimeout(() => {
      document.getElementById('extraction-results-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, []);

  // Main Customer Extraction Trigger (Called ONLY when user clicks Extract Data)
  const executeDataExtraction = useCallback(
    async (file: File) => {
      setServerAlert(null);
      
      const validExtensions = ['pdf', 'jpg', 'jpeg', 'png'];
      const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
      if (!validExtensions.includes(fileExt) && !file.type.startsWith('image/') && file.type !== 'application/pdf') {
        setServerAlert('Unsupported file type. Please upload a PDF, JPG, JPEG, or PNG file.');
        return;
      }

      if (file.size > 25 * 1024 * 1024) {
        setServerAlert('File too large. Please upload documents under 25MB.');
        return;
      }

      // Reset old rows
      setRows([]);

      // Start phase
      setOcrProgress({
        active: true,
        loadingStatus: 'Uploading file...',
        currentPage: 1,
        totalPages: 1,
        fileName: file.name
      });

      try {
        setTimeout(() => {
          setOcrProgress(prev => ({
            ...prev,
            loadingStatus: 'Processing document text...'
          }));
        }, 700);

        // Directly call POST /api/extract
        let apiRes = await expressApiClient.extractFile(file);
        
        if (apiRes.async && apiRes.jobId) {
          setOcrProgress(prev => ({
            ...prev,
            loadingStatus: apiRes.message || 'PDF extraction started',
            currentPage: 0,
            totalPages: 0
          }));

          let completedResult: ApiExtractResponse | null = null;

          while (!completedResult) {
            await delay(5000);
            const statusRes = await expressApiClient.getExtractStatus(apiRes.jobId);
            const progress = statusRes.progress;

            setOcrProgress(prev => ({
              ...prev,
              loadingStatus: progress?.message || (statusRes.status === 'pending' ? 'PDF extraction queued' : 'Processing PDF...'),
              currentPage: progress?.currentPage ?? prev.currentPage,
              totalPages: progress?.totalPages ?? prev.totalPages
            }));

            if (statusRes.status === 'completed') {
              completedResult = statusRes.result;
              break;
            }

            if (statusRes.status === 'failed') {
              throw new Error(statusRes.error || 'PDF extraction failed.');
            }
          }

          if (!completedResult) {
            throw new Error('PDF extraction finished without a result.');
          }

          apiRes = completedResult;
        }

        const totalPages = apiRes.pageCount || 1;

        setOcrProgress({
          active: true,
          loadingStatus: 'Preparing preview table...',
          currentPage: totalPages,
          totalPages: totalPages,
          fileName: file.name
        });

        applyExtractionResult(apiRes);

      } catch (err: any) {
        console.error('Extraction failure:', err);
        setServerAlert(err.message || 'Backend server is not running. Please start backend on port 5001 and try again.');
      } finally {
        setTimeout(() => {
          setOcrProgress(prev => ({ ...prev, active: false }));
        }, 1200);
      }
    },
    [applyExtractionResult]
  );

  const handleUpdateRow = (updatedRow: ExtractedRow) => {
    const originalRow = rows.find(r => r.id === updatedRow.id);
    if (originalRow) {
      if (updatedRow.city !== originalRow.city) {
        expressApiClient.saveCorrection({
          fieldType: 'city',
          oldValue: originalRow.city || '',
          correctedValue: updatedRow.city || '',
          originalOcrText: originalRow.originalOcrText || ''
        });
      }
      if (updatedRow.phoneNumber !== originalRow.phoneNumber) {
        expressApiClient.saveCorrection({
          fieldType: 'phone',
          oldValue: originalRow.phoneNumber || '',
          correctedValue: updatedRow.phoneNumber || '',
          originalOcrText: originalRow.originalOcrText || ''
        });
      }
      if (updatedRow.amount !== originalRow.amount) {
        expressApiClient.saveCorrection({
          fieldType: 'amount',
          oldValue: (originalRow.amount ?? '').toString(),
          correctedValue: (updatedRow.amount ?? '').toString(),
          originalOcrText: originalRow.originalOcrText || ''
        });
      }
    }
    setRows(prev => prev.map(r => r.id === updatedRow.id ? updatedRow : r));
  };

  const handleResetWorkspace = () => {
    setRows([]);
    setServerAlert(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans flex flex-col justify-between selection:bg-cyan-500 selection:text-white">
      
      {/* Super simple app header */}
      <Navbar />

      {/* Main Container - Super compact & centered */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col justify-center select-none">
        
        {/* Customer alert box shown only if extraction fails */}
        {serverAlert && (
          <div className="max-w-2xl mx-auto w-full p-5 bg-rose-500 text-white rounded-2xl shadow-xl mb-8 flex items-center justify-between animate-fadeIn border border-rose-400 select-none">
            <div className="flex items-center space-x-3">
              <AlertCircle className="w-6 h-6 shrink-0 text-white" />
              <p className="text-xs sm:text-sm font-bold tracking-wide">{serverAlert}</p>
            </div>
            <button
              onClick={() => setServerAlert(null)}
              className="p-1.5 hover:bg-rose-600 rounded-xl transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Central Upload Section */}
        <FileUploader
          onFileUpload={executeDataExtraction}
          isLoading={ocrProgress.active}
        />

        {/* Live Animated Scanning Track */}
        {ocrProgress.active && (
          <div className="max-w-2xl mx-auto w-full mt-6">
            <ExtractionProgress
              loadingStatus={ocrProgress.loadingStatus}
              currentPage={ocrProgress.currentPage}
              totalPages={ocrProgress.totalPages}
              fileName={ocrProgress.fileName}
            />
          </div>
        )}

        {/* After Extraction Editable Table Preview & Export Buttons Clearly Visible Above Table */}
        <DataTable
          rows={rows}
          setRows={setRows}
          onEditRow={(row) => setEditingRow(row)}
          onReset={handleResetWorkspace}
        />

      </main>

      {/* Manual Verification Edit Row Dialog */}
      <EditRowModal
        isOpen={!!editingRow}
        onClose={() => setEditingRow(null)}
        onSave={handleUpdateRow}
        row={editingRow}
      />

    </div>
  );
};

export const App = AppComponent;
export default AppComponent;
