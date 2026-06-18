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
    const inputType = mimeType === 'application/pdf' ? 'PDF' : 'Image';
    
    // Group rows by page for output
    const grouped = {};
    result.rows.forEach(row => {
      const p = row.pageNo || row.pageNumber || 1;
      if (!grouped[p]) grouped[p] = [];
      grouped[p].push(row);
    });

    const totalRows = result.rows.length;
    const okRows = result.rows.filter(r => r.status === 'OK').length;
    const reviewRows = result.rows.filter(r => r.status === 'Needs Review').length;
    const truncatedRows = result.rows.filter(r => r.status === 'Source Truncated / Missing Amount').length;
    const lowConfRows = result.rows.filter(r => r.status === 'Low OCR Confidence').length;
    const accuracy = totalRows > 0 ? ((okRows / totalRows) * 100).toFixed(1) : '0.0';
    const adjustedAccuracy = (totalRows - truncatedRows) > 0 
      ? ((okRows / (totalRows - truncatedRows)) * 100).toFixed(1) 
      : '0.0';

    console.log('\n=========================================');
    console.log('--- EXTRACTION SUMMARY ---');
    console.log(`Input Type:          ${inputType}`);
    console.log(`Total Pages/Images:  ${result.pageCount}`);
    console.log(`Total Rows Found:    ${totalRows}`);
    console.log(`OK Rows:             ${okRows}`);
    console.log(`Needs Review:        ${reviewRows}`);
    console.log(`Source Truncated:    ${truncatedRows}`);
    console.log(`Low OCR Confidence:  ${lowConfRows}`);
    console.log(`Raw Accuracy:        ${accuracy}%`);
    console.log(`Adjusted Accuracy:   ${adjustedAccuracy}% (excluding truncated fields)`);
    console.log('=========================================');

    // Parse failure reasons
    const reasonsMap = {};
    result.rows.forEach(r => {
      if (r.reviewReason) {
        r.reviewReason.split(' • ').forEach(reason => {
          reasonsMap[reason] = (reasonsMap[reason] || 0) + 1;
        });
      }
    });

    const sortedReasons = Object.entries(reasonsMap).sort((a, b) => b[1] - a[1]);
    if (sortedReasons.length > 0) {
      console.log('\n--- TOP FAILURE REASONS ---');
      sortedReasons.slice(0, 5).forEach(([reason, count]) => {
        console.log(`  - ${reason}: ${count} occurrences`);
      });
    }

    // Check if raw_ocr_debug.json was created in os.tmpdir()
    const os = await import('os');
    const debugJsonPath = path.join(os.tmpdir(), 'paisadu_raw_ocr_debug.json');
    if (fs.existsSync(debugJsonPath)) {
      try {
        const debugData = JSON.parse(fs.readFileSync(debugJsonPath, 'utf8'));
        if (inputType === 'PDF') {
          console.log('\n--- PDF PAGE-WISE STATISTICS (from raw_ocr_debug.json) ---');
          debugData.forEach(pageInfo => {
            const pNum = pageInfo.pageNumber;
            const pageRows = grouped[pNum] || [];
            console.log(`\nPage ${pNum}:`);
            console.log(`  - Dimensions:       ${pageInfo.width}x${pageInfo.height} (${pageInfo.orientation})`);
            console.log(`  - Quality Rating:   ${pageInfo.qualityRating} (OCR Conf: ${pageInfo.ocrConfidence}%)`);
            console.log(`  - Preprocess Mode:  ${pageInfo.preprocessingMode}`);
            console.log(`  - Truncation State: ${pageInfo.isTruncated ? 'TRUNCATED' : 'Complete'}`);
            console.log(`  - Extracted Rows:   ${pageRows.length}`);
            
            console.log(`  - First 5 rows preview:`);
            pageRows.slice(0, 5).forEach((r, idx) => {
              console.log(`    [Row ${idx+1}] City: ${r.city}, Phone: ${r.phoneNumber}, Amount: ${r.amount}, Status: ${r.status}`);
            });
          });
        } else {
          console.log('\n--- IMAGE QUALITY SUMMARY (from raw_ocr_debug.json) ---');
          const imgInfo = debugData[0];
          console.log(`  - Resolution:       ${imgInfo.width}x${imgInfo.height} (${imgInfo.orientation})`);
          console.log(`  - Quality Rating:   ${imgInfo.qualityRating} (OCR Conf: ${imgInfo.ocrConfidence}%)`);
          console.log(`  - Preprocess Mode:  ${imgInfo.preprocessingMode}`);
          console.log(`  - Truncation State: ${imgInfo.isTruncated ? 'TRUNCATED' : 'Complete'}`);
          console.log(`  - Total Extracted:  ${totalRows} rows`);
        }
      } catch (err) {
        console.error('Failed to parse raw_ocr_debug.json:', err.message);
      }
    } else {
      console.warn('Warning: raw_ocr_debug.json was not found in temp directory.');
    }
  } catch (error) {
    console.error('Extraction test failed:', error);
    process.exit(1);
  }
}

main();
