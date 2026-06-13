import fs from 'fs';
import path from 'path';
import { processFileForOcr } from './ocrService.js';

async function main() {
  const filePath = process.argv[2] || 'C:/Users/USER/Downloads/11.pdf';
  
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found at path: ${filePath}`);
    process.exit(1);
  }
  
  console.log(`Starting extraction test for file: ${filePath}`);
  const ext = path.extname(filePath).toLowerCase();
  let mimeType = 'application/pdf';
  if (ext === '.png') {
    mimeType = 'image/png';
  } else if (ext === '.jpg' || ext === '.jpeg') {
    mimeType = 'image/jpeg';
  }
  
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const result = await processFileForOcr(fileBuffer, mimeType, path.basename(filePath));
    
    console.log('\n--- EXTRACTION SUMMARY ---');
    console.log(`Total Pages Processed: ${result.pageCount}`);
    console.log(`Total Rows Extracted: ${result.totalExtracted}`);
    console.log(`Needs Review Count: ${result.needsReviewCount}`);
    
    // Group rows by page for output
    const grouped = {};
    result.rows.forEach(row => {
      const p = row.pageNo || row.pageNumber || 1;
      if (!grouped[p]) grouped[p] = [];
      grouped[p].push(row);
    });
    
    // Check if raw_ocr_debug.json was created
    const debugJsonPath = path.join(process.cwd(), 'raw_ocr_debug.json');
    if (fs.existsSync(debugJsonPath)) {
      try {
        const debugData = JSON.parse(fs.readFileSync(debugJsonPath, 'utf8'));
        console.log('\n--- PAGE-WISE STATISTICS (from raw_ocr_debug.json) ---');
        debugData.forEach(pageInfo => {
          const pNum = pageInfo.pageNumber;
          const pageRows = grouped[pNum] || [];
          console.log(`\nPage ${pNum}:`);
          console.log(`  - OCR text length: ${pageInfo.rawText.length} characters`);
          console.log(`  - Raw lines detected: ${pageInfo.rawLines.length}`);
          console.log(`  - Candidate lines (with PINCODE): ${pageInfo.candidateLines.length}`);
          console.log(`  - Final extracted rows: ${pageRows.length}`);
          
          console.log(`  - First 5 extracted rows:`);
          pageRows.slice(0, 5).forEach((r, idx) => {
            console.log(`    [Row ${idx+1}] City: ${r.city}, Phone: ${r.phoneNumber}, Amount: ${r.amount}, Status: ${r.status}`);
          });
        });
      } catch (err) {
        console.error('Failed to parse raw_ocr_debug.json:', err.message);
      }
    } else {
      console.warn('Warning: raw_ocr_debug.json was not generated.');
    }
  } catch (error) {
    console.error('Extraction test failed:', error);
    process.exit(1);
  }
}

main();
