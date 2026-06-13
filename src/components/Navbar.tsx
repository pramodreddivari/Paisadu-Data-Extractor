import React from 'react';

export const Navbar: React.FC = () => {
  return (
    <header className="sticky top-0 z-50 bg-slate-900 border-b border-slate-800 text-white shadow-lg select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center h-20 sm:h-24">
          
          {/* Logo & Lockup SVG */}
          <div className="flex items-center justify-center py-2 w-full">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 100" fill="none" className="h-12 sm:h-16 md:h-20 w-auto max-w-full">
              {/* Scan Frame / Brackets */}
              <path d="M12 25C12 17.8203 17.8203 12 25 12H35" stroke="#3b82f6" strokeWidth="3.5" strokeLinecap="round"/>
              <path d="M88 12H98C105.18 12 111 17.8203 111 25V35" stroke="#06b6d4" strokeWidth="3.5" strokeLinecap="round"/>
              <path d="M111 75C111 82.1797 105.18 88 98 88H88" stroke="#2563eb" strokeWidth="3.5" strokeLinecap="round"/>
              <path d="M35 88H25C17.8203 88 12 82.1797 12 75V65" stroke="#1d4ed8" strokeWidth="3.5" strokeLinecap="round"/>
              
              {/* Document Icon */}
              <path d="M28 28C28 25.7909 29.7909 24 32 24H68L80 36V72C80 74.2091 78.2091 76 76 76H32C29.7909 76 28 74.2091 28 72V28Z" fill="#0f172a" stroke="#ffffff" strokeWidth="3" strokeLinejoin="round"/>
              <path d="M68 24V36H80" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinejoin="round"/>
              
              {/* Fields inside document */}
              {/* City (Pin) */}
              <circle cx="42" cy="38" r="3" fill="#3b82f6"/>
              <path d="M42 35C40.3431 35 39 36.3431 39 38C39 40.5 42 44 42 44C42 44 45 40.5 45 38C45 36.3431 43.6569 35 42 35Z" fill="#ef4444"/>
              <line x1="51" y1="38" x2="68" y2="38" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"/>
              
              {/* Phone (Receiver) */}
              <path d="M39 52C39 50.8954 39.8954 50 41 50H43C44.1046 50 45 50.8954 45 52C45 54.7614 42.7614 57 40 57C38.8954 57 38 56.1046 38 55V53.5L39 52Z" fill="#3b82f6"/>
              <line x1="51" y1="53" x2="68" y2="53" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"/>
              
              {/* Amount (Rupee Symbol) */}
              <path d="M39 64H45M39 67H45M42 64C44 64 45 65 45 66.5C45 68 44 69 42 69H39M42 69L45 73" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="51" y1="68" x2="68" y2="68" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"/>

              {/* Data Extraction / Outgoing Nodes */}
              <rect x="120" y="42" width="6" height="6" rx="1.5" fill="#06b6d4" opacity="0.8"/>
              <rect x="130" y="42" width="6" height="6" rx="1.5" fill="#06b6d4" opacity="0.8"/>
              <rect x="140" y="42" width="6" height="6" rx="1.5" fill="#3b82f6" opacity="0.8"/>
              <rect x="120" y="52" width="6" height="6" rx="1.5" fill="#06b6d4" opacity="0.8"/>
              <rect x="130" y="52" width="6" height="6" rx="1.5" fill="#3b82f6" opacity="0.8"/>
              <rect x="140" y="52" width="6" height="6" rx="1.5" fill="#3b82f6" opacity="0.8"/>
              <rect x="120" y="62" width="6" height="6" rx="1.5" fill="#3b82f6" opacity="0.8"/>
              <rect x="130" y="62" width="6" height="6" rx="1.5" fill="#2563eb" opacity="0.8"/>
              <rect x="140" y="62" width="6" height="6" rx="1.5" fill="#2563eb" opacity="0.8"/>

              {/* Arrow */}
              <path d="M152 55H168M168 55L163 50M168 55L163 60" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              
              {/* Text Lockup */}
              <text x="182" y="52" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="800" fontSize="28" fill="#ffffff" letterSpacing="-0.5">Paisadu Data</text>
              <text x="368" y="52" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="800" fontSize="28" fill="#06b6d4" letterSpacing="-0.5">Extractor</text>
              
              {/* Subtitle */}
              <text x="183" y="74" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="500" fontSize="12" fill="#94a3b8">Extract City, Phone Number, and Amount from PDF/Image</text>
            </svg>
          </div>

        </div>
      </div>
    </header>
  );
};
