import express from 'express';
import cors from 'cors';
import multer from 'multer';
import xlsx from 'xlsx';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { processFileForOcr } from './ocrService.js';

const app = express();
const PORT = process.env.PORT || 5001;

const corsOptions = {
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept'],
  credentials: true
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
  fileFilter: (req, file, cb) => {
    const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (validTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Only PDF, JPG, JPEG, and PNG files are accepted.'));
    }
  }
});

app.get('/api', (req, res) => {
  res.json({
    service: 'Paisadu Data Extractor Enterprise Backend API',
    status: 'operational',
    endpoints: ['POST /api/extract', 'POST /api/export/excel', 'POST /api/export/pdf'],
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: "Backend running", port: 5001 });
});

function getCorrectionsPath() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'backend'))) {
    return path.join(cwd, 'backend', 'corrections.json');
  }
  if (path.basename(cwd) === 'backend') {
    return path.join(cwd, 'corrections.json');
  }
  return path.join(cwd, 'corrections.json');
}

// POST /api/corrections
app.post('/api/corrections', (req, res) => {
  try {
    const { fieldType, oldValue, correctedValue, originalOcrText } = req.body;
    if (!fieldType || !oldValue || !correctedValue) {
      return res.status(400).json({ success: false, message: 'Invalid correction parameters.' });
    }

    const correctionsPath = getCorrectionsPath();
    let corrections = [];
    if (fs.existsSync(correctionsPath)) {
      try {
        corrections = JSON.parse(fs.readFileSync(correctionsPath, 'utf8'));
      } catch (err) {
        console.error("Error reading corrections.json:", err);
      }
    }

    // Check if duplicate entry already exists to avoid bloating
    const duplicate = corrections.find(c => 
      c.fieldType === fieldType && 
      c.oldValue === oldValue && 
      c.correctedValue === correctedValue &&
      c.originalOcrText === originalOcrText
    );

    if (!duplicate) {
      corrections.push({
        fieldType,
        oldValue,
        correctedValue,
        originalOcrText,
        timestamp: new Date().toISOString()
      });
      fs.writeFileSync(correctionsPath, JSON.stringify(corrections, null, 2));
    }

    res.json({ success: true, message: 'Correction saved successfully.' });
  } catch (error) {
    console.error("Error saving correction:", error);
    res.status(500).json({ success: false, message: 'Failed to save correction.' });
  }
});

// 1. POST /api/extract
app.post('/api/extract', (req, res) => {
  console.log("POST /api/extract received");
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'File too large. Please upload documents under 25MB.' });
      }
      return res.status(400).json({ success: false, message: err.message || 'File upload failed.' });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded. Please upload a scanned PDF or image.' });
      }

      const { originalname, mimetype, buffer } = req.file;
      console.log(`Executing Pro Backend OCR extraction for: ${originalname} (${mimetype}), Size: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB`);

      const result = await processFileForOcr(buffer, mimetype, originalname);

      if (result.rows.length === 0) {
        return res.status(422).json({
          success: false,
          message: 'Empty extracted data. We could not detect any valid customer records or amounts in this document. Please verify image quality or orientation.'
        });
      }

      res.json({
        success: true,
        message: 'Extraction completed successfully',
        fileName: originalname,
        pageCount: result.pageCount,
        rows: result.rows,
        totalExtracted: result.totalExtracted,
        needsReviewCount: result.needsReviewCount
      });
    } catch (ocrErr) {
      console.error('API /api/extract failure:', ocrErr);
      res.status(500).json({
        success: false,
        message: ocrErr.message || 'OCR extraction failed due to unreadable document formatting.',
        error: ocrErr.toString()
      });
    }
  });
});

// 2. POST /api/export/excel
// Required Columns: S.No, Page No, City, Phone Number, Amount, Status, Original OCR Text
app.post('/api/export/excel', (req, res) => {
  try {
    const { rows } = req.body;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No records available to export.' });
    }

    const sortedRows = [...rows].sort((a, b) => (a.pageNo || a.pageNumber || 1) - (b.pageNo || b.pageNumber || 1));

    const sheetData = [];
    let currentPage = null;

    sortedRows.forEach((row, idx) => {
      const pageNum = row.pageNo || row.pageNumber || 1;

      // Requirement: "Insert exactly 3 blank rows after each PDF page."
      if (currentPage !== null && currentPage !== pageNum) {
        sheetData.push({});
        sheetData.push({});
        sheetData.push({});
      }

      currentPage = pageNum;

      sheetData.push({
        'S.No': row.sNo || row.rowNumber || idx + 1,
        'Page No': pageNum,
        'City': row.city || '',
        'Phone Number': row.phoneNumber || '', // We will explicitly force cell text formatting below
        'Amount': Number(row.amount) || row.amount || 0,
        'Status': (row.status === 'OK' && !row.needsReview) ? 'OK' : 'Needs Review',
        'Original OCR Text': row.originalOcrText || ''
      });
    });

    const worksheet = xlsx.utils.json_to_sheet(sheetData);

    // Requirement Fulfillment: Phone number should be text format, Amount numeric
    const range = xlsx.utils.decode_range(worksheet['!ref'] || 'A1:G1');
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const phoneCellAddr = xlsx.utils.encode_cell({ r: R, c: 3 }); // Col D is Phone Number
      const amountCellAddr = xlsx.utils.encode_cell({ r: R, c: 4 }); // Col E is Amount

      const phoneCell = worksheet[phoneCellAddr];
      if (phoneCell && phoneCell.v) {
        phoneCell.t = 's'; // Force string/text format
        phoneCell.z = '@';
      }

      const amountCell = worksheet[amountCellAddr];
      if (amountCell && amountCell.v !== undefined) {
        amountCell.t = 'n'; // Force numeric format
        amountCell.z = '#,##0.00';
      }
    }

    // Freeze header row & add filter to header
    worksheet['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
    worksheet['!autofilter'] = { ref: `A1:G1` };

    // Auto adjust column width
    worksheet['!cols'] = [
      { wch: 8 },  // S.No
      { wch: 10 }, // Page No
      { wch: 24 }, // City
      { wch: 18 }, // Phone Number
      { wch: 16 }, // Amount
      { wch: 15 }, // Status
      { wch: 65 }  // Original OCR Text
    ];

    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Extracted Scan Data');

    const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="Extracted_Data.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(excelBuffer);
  } catch (error) {
    console.error('API /api/export/excel export error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate enterprise Excel workbook.' });
  }
});

// 3. POST /api/export/pdf
// Clean report. Columns: S.No, Page No, City, Phone Number, Amount, Status. Group data page-wise. Add generated date/time.
app.post('/api/export/pdf', (req, res) => {
  try {
    const { rows, title = 'Paisadu Data Extractor Executive Report' } = req.body;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No records available to export.' });
    }

    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Disposition', 'attachment; filename="Extracted_Data_Report.pdf"');
    res.setHeader('Content-Type', 'application/pdf');

    doc.pipe(res);

    // Header Banner
    doc.rect(0, 0, doc.page.width, 85).fill('#0f172a');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text(title, 40, 25);

    // Add generated date/time
    const timestampStr = `Generated on ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} at ${new Date().toLocaleTimeString('en-IN')} • Total Verified Records: ${rows.length}`;
    doc.fillColor('#94a3b8').font('Helvetica').fontSize(11).text(timestampStr, 40, 56);

    doc.moveDown(3);

    // Group page-wise
    const grouped = rows.reduce((acc, row) => {
      const p = row.pageNo || row.pageNumber || 1;
      if (!acc[p]) acc[p] = [];
      acc[p].push(row);
      return acc;
    }, {});

    const startX = 40;
    const availableWidth = doc.page.width - 80;
    const colWidths = [35, 40, 120, 110, 100, 110]; // S.No, Page No, City, Phone, Amount, Status. Total = 515.

    Object.keys(grouped).forEach((pageNum, gIdx) => {
      if (gIdx > 0) doc.moveDown(1.5);

      // Section label
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(15).text(`Page ${pageNum} Scanned Records`, startX);
      doc.moveDown(0.5);

      // Header Row
      let currentY = doc.y;
      doc.rect(startX, currentY, availableWidth, 24).fill('#f1f5f9');

      doc.fillColor('#334155').font('Helvetica-Bold').fontSize(9);
      doc.text('S.No', startX + 5, currentY + 7);
      doc.text('Page', startX + colWidths[0] + 5, currentY + 7);
      doc.text('City', startX + colWidths[0] + colWidths[1] + 5, currentY + 7);
      doc.text('Phone Number', startX + colWidths[0] + colWidths[1] + colWidths[2] + 5, currentY + 7);
      doc.text('Amount', startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, currentY + 7);
      doc.text('Status', startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 5, currentY + 7);

      doc.y = currentY + 24;

      // Body Rows
      grouped[pageNum].forEach((row, rIdx) => {
        if (doc.y > doc.page.height - 80) {
          doc.addPage();
          doc.y = 40;
        }

        currentY = doc.y;
        const rowHeight = 26;

        if (rIdx % 2 === 1) {
          doc.rect(startX, currentY, availableWidth, rowHeight).fill('#f8fafc');
        }

        const isNeedsReview = row.needsReview || row.status === 'Needs Review';
        if (isNeedsReview) {
          doc.rect(startX, currentY, availableWidth, rowHeight).fill('#fef2f2');
        }

        doc.fillColor(isNeedsReview ? '#991b1b' : '#0f172a').font('Helvetica').fontSize(9);

        doc.text(`${row.sNo || row.rowNumber || rIdx + 1}`, startX + 5, currentY + 7);
        doc.text(`P${row.pageNo || row.pageNumber || pageNum}`, startX + colWidths[0] + 5, currentY + 7);
        doc.text(row.city || '--', startX + colWidths[0] + colWidths[1] + 5, currentY + 7);
        doc.text(row.phoneNumber || '--', startX + colWidths[0] + colWidths[1] + colWidths[2] + 5, currentY + 7);

        doc.font('Helvetica-Bold').fillColor('#16a34a').fontSize(9);
        doc.text(`${row.amount || '0'}`, startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, currentY + 7);

        doc.font('Helvetica-Bold').fillColor(isNeedsReview ? '#dc2626' : '#16a34a').fontSize(9);
        doc.text(isNeedsReview ? 'Needs Review' : 'OK', startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 5, currentY + 7);

        doc.y = currentY + rowHeight;
      });
    });

    doc.end();
  } catch (error) {
    console.error('API /api/export/pdf error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to compile clean PDF executive report.' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Paisadu Data Extractor Enterprise Production Backend running successfully on http://localhost:${PORT}`);
});
