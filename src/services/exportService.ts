import * as xlsx from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { ExtractedRow } from '../types';

export function exportToExcelBrowser(rows: ExtractedRow[], includeOcr: boolean = true) {
  const sortedRows = [...rows].sort((a, b) => a.pageNumber - b.pageNumber);
  
  const sheetData: any[] = [];
  let currentPage: number | null = null;

  sortedRows.forEach((row) => {
    // Requirements: "After every PDF page, insert 3 blank rows in Excel before continuing next page."
    if (currentPage !== null && currentPage !== row.pageNumber) {
      sheetData.push({});
      sheetData.push({});
      sheetData.push({});
    }

    currentPage = row.pageNumber;

    sheetData.push({
      'Page No': row.pageNumber || 1,
      'City': row.city || '',
      'Phone / Mobile Number': row.phoneNumber || '',
      'Amount': Number(row.amount) || row.amount || 0,
      ...(includeOcr ? { 'Original OCR Text': row.originalOcrText || '' } : {}),
      'Status': (row.status === 'OK' && !row.needsReview) ? 'OK' : 'Needs Review'
    });
  });

  const worksheet = xlsx.utils.json_to_sheet(sheetData);

  worksheet['!cols'] = [
    { wch: 10 }, // Page No
    { wch: 22 }, // City
    { wch: 20 }, // Phone
    { wch: 16 }, // Amount
    ...(includeOcr ? [{ wch: 65 }] : []), // OCR
    { wch: 15 }  // Status
  ];

  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Extracted Scan Data');

  xlsx.writeFile(workbook, 'Extracted_Data.xlsx');
}

export function exportToPdfBrowser(rows: ExtractedRow[], title: string = 'Paisadu Data Extractor Final Report', includeOcr: boolean = true) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'A4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(30, 41, 59);
  doc.rect(0, 0, pageWidth, 75, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text(title, 40, 35);

  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Exported on: ${new Date().toLocaleDateString()}  •  Total Records Extracted: ${rows.length}`, 40, 55);

  const grouped = rows.reduce((acc, row) => {
    const p = row.pageNumber || 1;
    if (!acc[p]) acc[p] = [];
    acc[p].push(row);
    return acc;
  }, {} as Record<number, ExtractedRow[]>);

  let finalY = 95;

  const sortedPageNums = Object.keys(grouped).map(Number).sort((a, b) => a - b);

  sortedPageNums.forEach((pageNum, gIdx) => {
    if (gIdx > 0) {
      finalY += 30;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text(`Page ${pageNum} Scanned Records`, 40, finalY);
    finalY += 12;

    const tableRows = grouped[pageNum].map((r) => [
      `P${r.pageNumber || pageNum}`,
      r.city || '--',
      r.phoneNumber || '--',
      `${Number(r.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
      ...(includeOcr ? [r.originalOcrText || ''] : []),
      (r.status === 'OK' && !r.needsReview) ? 'OK' : 'Needs Review'
    ]);

    const headColumns = [
      'Page No',
      'City',
      'Phone / Mobile',
      'Amount',
      ...(includeOcr ? ['Original OCR Text'] : []),
      'Status'
    ];

    (doc as any).autoTable({
      startY: finalY,
      head: [headColumns],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 11 },
      bodyStyles: { textColor: [51, 65, 85], fontSize: 10 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 60, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: includeOcr ? 110 : 160 },
        2: { cellWidth: includeOcr ? 110 : 160 },
        3: { cellWidth: includeOcr ? 100 : 140, halign: 'right', fontStyle: 'bold', textColor: [22, 163, 74] },
        ...(includeOcr ? { 4: { cellWidth: 'auto', fontStyle: 'italic', fontSize: 9 } } : {}),
        [includeOcr ? 5 : 4]: { cellWidth: includeOcr ? 100 : 130, halign: 'center', fontStyle: 'bold' }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.cells[includeOcr ? 5 : 4].text[0]?.includes('Needs Review')) {
          data.cell.styles.fillColor = [254, 242, 242];
        }
      }
    });

    finalY = (doc as any).lastAutoTable.finalY;
  });

  doc.save('Extracted_Data_Report.pdf');
}
