import React, { useState, useEffect } from 'react';
import { ExtractedRow } from '../types';
import { X, Save, CheckCircle2, AlertTriangle } from 'lucide-react';

interface EditRowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedRow: ExtractedRow) => void;
  row: ExtractedRow | null;
}

export const EditRowModal: React.FC<EditRowModalProps> = ({ isOpen, onClose, onSave, row }) => {
  const [city, setCity] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [amount, setAmount] = useState<string | number>('');

  useEffect(() => {
    if (row) {
      setCity(row.city || '');
      setPhoneNumber(row.phoneNumber || '');
      setAmount(row.amount || '');
    }
  }, [row]);

  if (!isOpen || !row) return null;

  // Perform dynamic validation based on inputs
  const trimmedCity = city.trim();
  const trimmedPhone = phoneNumber.trim();
  const numAmount = typeof amount === 'number' ? amount : parseFloat(amount.toString().replace(/,/g, ''));
  
  const isCityValid = trimmedCity.length > 0;
  const isPhoneValid = /^[6-9]\d{9}$/.test(trimmedPhone);
  const isAmountValid = !isNaN(numAmount) && numAmount > 0;
  const isValid = isCityValid && isPhoneValid && isAmountValid;

  const currentStatus = isValid ? 'OK' : 'Needs Review';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const invalidReasons: string[] = [];
    if (!isCityValid) {
      invalidReasons.push('City cannot be empty');
    }
    if (!isPhoneValid) {
      invalidReasons.push('Phone Number must be a 10-digit Indian number starting with 6, 7, 8, or 9');
    }
    if (!isAmountValid) {
      invalidReasons.push('Amount must be greater than 0');
    }

    onSave({
      ...row,
      city: trimmedCity,
      phoneNumber: trimmedPhone,
      amount: isAmountValid ? numAmount : (Number(amount) || amount),
      status: currentStatus,
      needsReview: !isValid,
      reviewReason: isValid ? '' : invalidReasons.join(' • ')
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-6 py-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 bg-cyan-500/20 text-cyan-400 font-bold text-xs rounded-full border border-cyan-500/30 uppercase tracking-wider">
                Page {row.pageNumber} • Row #{row.rowNumber}
              </span>
              {currentStatus === 'Needs Review' ? (
                <span className="px-2.5 py-0.5 bg-rose-500/20 text-rose-300 font-bold text-xs rounded-full border border-rose-500/30">
                  Needs Review ⚠️
                </span>
              ) : (
                <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 font-bold text-xs rounded-full border border-emerald-500/30">
                  Status: OK ✅
                </span>
              )}
            </div>
            <h3 className="font-extrabold text-xl mt-1 tracking-tight">Edit Extracted Scan Record</h3>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          
          {/* City Input */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              1. Extracted City <span className="text-slate-400 text-none lowercase font-normal">(Only HYDERABAD, BANGALORE...)</span>
            </label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. HYDERABAD, BANGALORE"
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-black tracking-wide focus:ring-2 focus:ring-cyan-500 dark:focus:ring-cyan-400 focus:outline-none transition"
            />
          </div>

          {/* Phone Input */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              2. Phone / Mobile Number <span className="text-slate-400 text-none lowercase font-normal">(Prefer MOBILE)</span>
            </label>
            <input
              type="text"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="e.g. 8801861960"
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono font-medium focus:ring-2 focus:ring-cyan-500 dark:focus:ring-cyan-400 focus:outline-none transition"
            />
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              3. Financial Amount <span className="text-slate-400 text-none lowercase font-normal">(Final numeric after LANDMARK/STD)</span>
            </label>
            <div className="relative">
              <span className="absolute left-4 top-3.5 text-slate-400 font-bold">₹</span>
              <input
                type="number"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 4500000"
                className="w-full pl-8 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-emerald-600 dark:text-emerald-400 font-bold focus:ring-2 focus:ring-cyan-500 dark:focus:ring-cyan-400 focus:outline-none transition"
              />
            </div>
          </div>

          {/* Original OCR verification Text */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              🔍 Original Scanned OCR Verification Text
            </label>
            <div className="p-3 bg-slate-100 dark:bg-slate-950/50 rounded-xl text-xs font-mono text-slate-600 dark:text-slate-400 break-all select-all">
              {row.originalOcrText || 'No original OCR string available'}
            </div>
            {row.reviewReason && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center space-x-1 font-medium">
                <AlertTriangle className="w-4 h-4" />
                <span>Flagged Reason: {row.reviewReason}</span>
              </p>
            )}
          </div>

          {/* Toggle status (displays read-only current evaluation status) */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Validation Status</span>
            <div
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-black transition ${
                currentStatus === 'OK'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30'
              }`}
            >
              {currentStatus === 'OK' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              <span>{currentStatus === 'OK' ? 'Status: OK ✅' : 'Status: Needs Review ⚠️'}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center space-x-2 px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-sm rounded-xl shadow-lg shadow-cyan-500/25 hover:from-cyan-600 hover:to-blue-700 transition"
            >
              <Save className="w-4 h-4" />
              <span>Save & Update Row</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
