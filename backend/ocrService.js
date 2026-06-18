import { createWorker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import os from 'os';

const IS_PROD = process.env.NODE_ENV === 'production';
const MIN_WIDTH = IS_PROD ? 1200 : 3000;
const PROD_PDF_MAX_RSS_MB = Number(process.env.OCR_MAX_RSS_MB || 430);

// Major Indian cities list for verification and precise boundary detection
const knownCities = [
  'HYDERABAD', 'BANGALORE', 'BENGALURU', 'CHENNAI', 'MUMBAI', 
  'DELHI', 'NEW DELHI', 'KOLKATA', 'PUNE', 'GURUGRAM', 'GURGAON', 
  'NOIDA', 'JAIPUR', 'AHMEDABAD', 'COIMBATORE', 'KOCHI', 'CHANDIGARH',
  'SECUNDERABAD', 'THANE', 'VISAKHAPATNAM', 'SURAT', 'VADODARA', 'INDORE',
  'PATNA', 'BHOPAL', 'LUCKNOW', 'AGRA', 'VARANASI', 'MADURAI', 'MYSORE',
  'TIRUCHIRAPPALLI', 'VIJAYAWADA', 'GUWAHATI', 'TIRUPATI', 'THIRUVANANTHAPURAM',
  'NAVI MUMBAI', 'GHAZIABAD', 'FARIDABAD', 'RAJKOT', 'AMRITSAR',
  'RANGAREDDY', 'SANGA REDDY', 'MEDCHAL', 'PEDDAPALLI'
];

function getCorrectionsPath() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'backend'))) {
    return path.join(cwd, 'corrections.json');
  }
  if (path.basename(cwd) === 'backend') {
    return path.join(path.dirname(cwd), 'corrections.json');
  }
  return path.join(cwd, 'corrections.json');
}

// Correction database loading
function loadCorrections() {
  const correctionsPath = getCorrectionsPath();
  if (fs.existsSync(correctionsPath)) {
    try {
      return JSON.parse(fs.readFileSync(correctionsPath, 'utf8'));
    } catch (err) {
      console.error("Error reading corrections.json:", err);
    }
  }
  return [];
}

function getMemorySnapshot() {
  const memory = process.memoryUsage();
  return {
    rssMb: Math.round(memory.rss / 1024 / 1024),
    heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    externalMb: Math.round(memory.external / 1024 / 1024),
    arrayBuffersMb: Math.round(memory.arrayBuffers / 1024 / 1024)
  };
}

function logMemory(label) {
  console.log(`[OCR Memory] ${label}: ${JSON.stringify(getMemorySnapshot())}`);
}

function isProductionPdfMemoryUnsafe() {
  return IS_PROD && getMemorySnapshot().rssMb >= PROD_PDF_MAX_RSS_MB;
}

// Token Jaccard similarity for learning suggestions
function getContextSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  const words1 = text1.toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length > 0);
  const words2 = text2.toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length > 0);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  let intersection = 0;
  const set2 = new Set(words2);
  for (const w of words1) {
    if (set2.has(w)) intersection++;
  }
  
  return intersection / Math.max(words1.length, words2.length);
}

// Map manual corrections suggestion/auto-correct
function applyManualCorrections(row, originalText, corrections) {
  if (!corrections || corrections.length === 0) return;

  const fields = ['city', 'phone', 'amount'];
  const rowFieldKeys = {
    city: 'city',
    phone: 'phoneNumber',
    amount: 'amount'
  };

  for (const field of fields) {
    const fieldName = rowFieldKeys[field];
    const extractedValue = (row[fieldName] ?? '').toString().trim();
    
    // Find matching corrections for this field and oldValue
    const matches = corrections.filter(c => c.fieldType === field && c.oldValue.trim() === extractedValue);
    
    let bestMatch = null;
    let highestSim = 0;
    
    for (const corr of matches) {
      const sim = getContextSimilarity(originalText, corr.originalOcrText);
      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = corr;
      }
    }

    if (bestMatch && highestSim >= 0.70) {
      if (highestSim >= 0.90 && row.confidence >= 75) {
        // High confidence context & OCR -> Auto-correct!
        const prevVal = row[fieldName];
        if (field === 'amount') {
          row[fieldName] = parseFloat(bestMatch.correctedValue) || bestMatch.correctedValue;
        } else {
          row[fieldName] = bestMatch.correctedValue;
        }
        console.log(`[Corrections Learning] Auto-corrected ${field} from "${prevVal}" to "${row[fieldName]}"`);
        row.needsReview = false;
        row.status = 'OK';
        row.reviewReason = '';
      } else {
        // Lower confidence context -> Suggestion!
        if (!row.suggestions) row.suggestions = {};
        row.suggestions[fieldName] = bestMatch.correctedValue;
        
        row.needsReview = true;
        row.status = 'Needs Review';
        const msg = `Suggested ${field}: ${bestMatch.correctedValue} (based on history)`;
        if (!row.reviewReason.includes(msg)) {
          row.reviewReason = row.reviewReason 
            ? `${row.reviewReason} • ${msg}`
            : msg;
        }
      }
    }
  }
}

// Calculate OCR confidence score of fields
function getFieldConfidence(fieldValue, words, type) {
  if (!fieldValue || !words || words.length === 0) return 80;

  const cleanVal = fieldValue.toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleanVal) return 80;

  let matchingWords = [];

  if (type === 'city') {
    const parts = cleanVal.split(/[^A-Z0-9]+/);
    for (const w of words) {
      const wClean = (w.text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (wClean.length > 0 && parts.some(p => p.includes(wClean) || wClean.includes(p))) {
        matchingWords.push(w);
      }
    }
  } else if (type === 'phone') {
    for (const w of words) {
      const wClean = (w.text || '').replace(/\D/g, '');
      if (wClean.length >= 3 && cleanVal.includes(wClean)) {
        matchingWords.push(w);
      }
    }
  } else if (type === 'amount') {
    for (const w of words) {
      const wClean = (w.text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (wClean.length >= 3 && (cleanVal.includes(wClean) || wClean.includes(cleanVal) || /TOSO|TOOOOO|TASE000|SO000/i.test(wClean))) {
        matchingWords.push(w);
      }
    }
  }

  if (matchingWords.length > 0) {
    const sum = matchingWords.reduce((acc, w) => acc + (w.confidence || 0), 0);
    return Math.round(sum / matchingWords.length);
  }

  const allSum = words.reduce((acc, w) => acc + (w.confidence || 0), 0);
  return Math.round(allSum / words.length) || 80;
}

// Levenshtein distance helper for fuzzy matching
function getLevenshteinDistance(a, b) {
  const tmp = [];
  for (let i = 0; i <= a.length; i++) {
    tmp[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    tmp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1, // deletion
        tmp[i][j - 1] + 1, // insertion
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      );
    }
  }
  return tmp[a.length][b.length];
}

// Normalize common OCR digit mistakes (e.g. O->0, I/l->1, S->5, B->8)
function normalizeOcrDigits(text) {
  if (!text) return '';
  return text
    .replace(/[Oo]/g, '0')
    .replace(/[Ii|ltT\[\]]/g, '1')
    .replace(/[S§s]/g, '5')
    .replace(/[Zz]/g, '2')
    .replace(/[gGqQ]/g, '9')
    .replace(/B/g, '8')
    .replace(/b/g, '6')
    .replace(/\s+/g, '');
}

// Estimate quality based on dimensions and OCR confidence
function estimateQuality(meta, ocrConfidence) {
  const width = meta.width || 0;
  const height = meta.height || 0;
  const isLowRes = width < 1500 || height < 1500;
  const isBlurry = ocrConfidence < 70;
  const isSkewed = false; // Placeholder

  let rating = 'High';
  if (isLowRes && isBlurry) rating = 'Low';
  else if (isLowRes || isBlurry) rating = 'Medium';

  return {
    width,
    height,
    orientation: width > height ? 'Landscape' : 'Portrait',
    isLowResolution: isLowRes,
    isBlurry,
    isSkewed,
    qualityRating: rating
  };
}

// Generate preprocessed buffer based on variant mode and scale factor
async function getPreprocessedBuffer(inputBufferOrRaw, rawMeta, variant, scale) {
  let pipeline;
  if (rawMeta) {
    pipeline = sharp(inputBufferOrRaw, {
      raw: {
        width: rawMeta.width,
        height: rawMeta.height,
        channels: rawMeta.channels
      }
    });
  } else {
    pipeline = sharp(inputBufferOrRaw);
  }

  // Handle scaling (resize)
  if (scale > 1) {
    const meta = rawMeta ? null : await pipeline.metadata();
    const w = rawMeta ? rawMeta.width : (meta ? meta.width : 1200) || 1200;
    const h = rawMeta ? rawMeta.height : (meta ? meta.height : 1600) || 1600;
    pipeline = pipeline.resize({
      width: w * scale,
      height: h * scale,
      kernel: sharp.kernel.lanczos3
    });
  }

  if (variant === 'A') {
    // Pass A: Grayscale + Sharpen + Normalize
    return await pipeline
      .greyscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();
  } else if (variant === 'B') {
    // Pass B: Grayscale + Threshold (160) + Denoise
    return await pipeline
      .greyscale()
      .threshold(160)
      .median(1)
      .png()
      .toBuffer();
  } else if (variant === 'C') {
    // Pass C: Enlarged 2x + Grayscale + Sharpen + Normalize
    const meta = rawMeta ? null : await pipeline.metadata();
    const w = rawMeta ? rawMeta.width : (meta ? meta.width : 1200) || 1200;
    const h = rawMeta ? rawMeta.height : (meta ? meta.height : 1600) || 1600;
    return await pipeline
      .resize({
        width: w * 2,
        height: h * 2,
        kernel: sharp.kernel.lanczos3
      })
      .greyscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();
  } else if (variant === 'D') {
    // Pass D: Grayscale + Contrast Adjustment + Normalize
    return await pipeline
      .greyscale()
      .linear(1.2, -20)
      .png()
      .toBuffer();
  }

  return await pipeline.png().toBuffer();
}

// Compute quality score for selecting best primary OCR pass
function scoreOcrResult(result) {
  if (!result || !result.extractedRows) return -999;
  const rows = result.extractedRows;
  let score = rows.length * 15;
  let okRows = 0;
  let validPhones = 0;
  let validAmounts = 0;
  let matchedCities = 0;
  let totalConf = 0;

  for (const r of rows) {
    if (r.status === 'OK') okRows++;
    if (r.phoneNumber && /^[6-9]\d{9}$/.test(r.phoneNumber)) validPhones++;
    if (r.amount && parseFloat(r.amount) >= 10000) validAmounts++;
    if (r.city && r.city !== 'Needs Review' && r.city !== 'Needs Entry') matchedCities++;
    totalConf += r.confidence || 0;
  }

  score += okRows * 20;
  score += validPhones * 15;
  score += validAmounts * 15;
  score += matchedCities * 10;
  score += rows.length > 0 ? (totalConf / rows.length) : 0;
  return score;
}

// Split multi-column customer table layouts horizontally
function splitMultiColumnGroup(group) {
  const pinWords = group.words.filter(w => /PINCODE|P1NC0DE|PIN\s+CODE/i.test(w.text || ''));
  if (pinWords.length <= 1) {
    return [{
      bbox: group.bbox,
      text: group.words.map(w => w.text).join(' ').trim(),
      words: group.words
    }];
  }

  // Sort pinWords horizontally by X coordinate
  pinWords.sort((a, b) => (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0));

  const subGroups = [];
  let lastSplitX = 0;

  for (let i = 0; i < pinWords.length; i++) {
    const currentPinX = pinWords[i].bbox?.x0 ?? 0;
    let splitX = 999999;
    if (i < pinWords.length - 1) {
      const nextPinX = pinWords[i + 1].bbox?.x0 ?? 0;
      splitX = (currentPinX + nextPinX) / 2;
    }

    const subWords = group.words.filter(w => {
      const x0 = w.bbox?.x0 ?? 0;
      return x0 >= lastSplitX && x0 < splitX;
    });

    if (subWords.length > 0) {
      subWords.sort((a, b) => (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0));
      const subText = subWords.map(w => w.text).join(' ').trim();

      const subX0 = Math.min(...subWords.map(w => w.bbox?.x0 ?? 0));
      const subX1 = Math.max(...subWords.map(w => w.bbox?.x1 ?? 0));
      const subY0 = Math.min(...subWords.map(w => w.bbox?.y0 ?? group.bbox.y0));
      const subY1 = Math.max(...subWords.map(w => w.bbox?.y1 ?? group.bbox.y1));

      subGroups.push({
        bbox: { x0: subX0, x1: subX1, y0: subY0, y1: subY1 },
        text: subText,
        words: subWords
      });
    }
    lastSplitX = splitX;
  }
  return subGroups;
}

// Extract best valid mobile and find other candidates
function extractAllPhoneNumbers(lineText) {
  if (!lineText) return { best: '', others: [] };
  const cleanLine = lineText.toUpperCase();
  const candRegex = /[0-9OolIL|tTS§sbB\s\-\(\)\+]{7,22}/g;
  const matches = cleanLine.match(candRegex) || [];

  const phoneCandidates = [];
  const pincodeMatch = lineText.match(/(?:PINCODE|P1NC0DE|PIN\s+CODE)?\s*\b(\d{6})\b/i);
  const pincode = pincodeMatch ? pincodeMatch[1] : '';

  for (const rawCand of matches) {
    const cleaned = normalizeOcrDigits(rawCand);
    const digits = cleaned.replace(/\D/g, '');
    if (digits.length >= 10) {
      const phone10 = digits.slice(-10);
      if (/^[6-9]\d{9}$/.test(phone10)) {
        if (!pincode || !phone10.includes(pincode)) {
          if (!phoneCandidates.includes(phone10)) {
            phoneCandidates.push(phone10);
          }
        }
      }
    }
  }

  if (phoneCandidates.length === 0) {
    return { best: '', others: [] };
  }

  let bestPhone = phoneCandidates[0];
  let minDistance = 999;
  const keywords = ['MOBILE', 'PHONE', 'MOB', 'PH', 'M0B1LE', 'M0BILE', 'PH0NE'];
  for (const kw of keywords) {
    const kwIdx = cleanLine.indexOf(kw);
    if (kwIdx !== -1) {
      for (const cand of phoneCandidates) {
        const candIdx = cleanLine.indexOf(cand);
        if (candIdx !== -1) {
          const dist = Math.abs(candIdx - kwIdx);
          if (dist < minDistance) {
            minDistance = dist;
            bestPhone = cand;
          }
        }
      }
    }
  }

  const others = phoneCandidates.filter(p => p !== bestPhone);
  return { best: bestPhone, others };
}

// Process a single PDF page render or direct image upload with preprocessors
async function processPageImage(inputBufferOrRaw, rawMeta, pageNumber, fileName, isTruncated, corrections, worker) {
  let width = 0;
  let height = 0;
  let channels = 3;

  if (rawMeta) {
    width = rawMeta.width;
    height = rawMeta.height;
    channels = rawMeta.channels;
  } else {
    try {
      const meta = await sharp(inputBufferOrRaw).metadata();
      width = meta.width || 1200;
      height = meta.height || 1600;
      channels = meta.channels || 3;
    } catch (e) {
      console.warn("Failed to get image metadata:", e);
      width = 1200;
      height = 1600;
    }
  }

  let scale = 1;
  if (width < MIN_WIDTH) {
    scale = Math.ceil(MIN_WIDTH / width);
  }

  console.log(`[OCR Debug] Page ${pageNumber}: Running primary OCR Pass A...`);
  const bufferA = await getPreprocessedBuffer(inputBufferOrRaw, rawMeta, 'A', scale);

  if (!IS_PROD) {
    const debugDir = path.join(os.tmpdir(), 'paisadu_debug_pages');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    try {
      fs.writeFileSync(path.join(debugDir, `page-${pageNumber}.png`), bufferA);
    } catch (e) {
      console.error('Failed to write debug page image:', e);
    }
  }

  const retA = await worker.recognize(bufferA, {}, { blocks: true });
  const resultA = parseExtractedTextWithLayout(retA.data.text, retA.data.blocks, pageNumber, fileName, { isTruncated }, corrections);
  const scoreA = scoreOcrResult(resultA);
  const avgConfA = retA.data.confidence || 0;

  let bestVariant = 'A';
  let bestRows = resultA.extractedRows;
  let bestOcrText = retA.data.text;
  let bestBlocks = retA.data.blocks;
  let bestBuffer = bufferA;
  let bestScore = scoreA;
  let bestConf = avgConfA;

  const isStandardPassWeak = resultA.extractedRows.length === 0 || avgConfA < 75;

  if (isStandardPassWeak) {
    console.log(`[OCR Debug] Page ${pageNumber}: Standard pass is weak (rows: ${resultA.extractedRows.length}, avgConf: ${avgConfA}%, score: ${scoreA}). Running fallback passes...`);
    const variants = ['B', 'C', 'D'];
    for (const v of variants) {
      try {
        console.log(`[OCR Debug] Page ${pageNumber}: Running Pass ${v}...`);
        const buf = await getPreprocessedBuffer(inputBufferOrRaw, rawMeta, v, scale);
        const ret = await worker.recognize(buf, {}, { blocks: true });
        const res = parseExtractedTextWithLayout(ret.data.text, ret.data.blocks, pageNumber, fileName, { isTruncated }, corrections);
        const score = scoreOcrResult(res);
        const conf = ret.data.confidence || 0;

        console.log(`[OCR Debug] Pass ${v} result: rows=${res.extractedRows.length}, conf=${conf}%, score=${score}`);
        if (score > bestScore || (score === bestScore && conf > bestConf)) {
          bestVariant = v;
          bestRows = res.extractedRows;
          bestOcrText = ret.data.text;
          bestBlocks = ret.data.blocks;
          bestBuffer = buf;
          bestScore = score;
          bestConf = conf;
        }
      } catch (err) {
        console.error(`Error in preprocessing variant ${v}:`, err);
      }
    }
    console.log(`[OCR Debug] Page ${pageNumber}: Selected best variant ${bestVariant} (score: ${bestScore})`);
  }

  let needsSecondaryCrop = false;
  for (const row of bestRows) {
    const hasLowConf = row.cityConfidence < 70 || row.phoneConfidence < 70 || row.amountConfidence < 70;
    const hasInvalidPhone = !row.phoneNumber || !/^[6-9]\d{9}$/.test(row.phoneNumber);
    const hasSuspiciousAmount = !row.amount || parseFloat(row.amount) === 0 || row.amount.toString().length >= 10 ||
                                (row.amount.toString().length >= 8 && row.amount.toString().startsWith('1')) ||
                                row.phoneNumber === row.amount.toString() ||
                                row.needsReview || row.status !== 'OK';

    if (hasLowConf || hasInvalidPhone || hasSuspiciousAmount) {
      needsSecondaryCrop = true;
      break;
    }
  }

  let cropData = { isTruncated };
  if (needsSecondaryCrop && !isTruncated) {
    console.log(`[OCR Debug] Page ${pageNumber}: Running secondary cropped column OCR passes...`);
    let maxX = 0;
    let maxY = 0;
    if (bestBlocks) {
      for (const block of bestBlocks) {
        if (block.paragraphs) {
          for (const para of block.paragraphs) {
            if (para.lines) {
              for (const line of para.lines) {
                if (line.bbox) {
                  if (line.bbox.x1 > maxX) maxX = line.bbox.x1;
                  if (line.bbox.y1 > maxY) maxY = line.bbox.y1;
                }
              }
            }
          }
        }
      }
    }
    if (maxX === 0) maxX = MIN_WIDTH;
    if (maxY === 0) maxY = 4000;

    const candidateLines = [];
    if (bestBlocks) {
      for (const block of bestBlocks) {
        if (block.paragraphs) {
          for (const para of block.paragraphs) {
            if (para.lines) {
              for (const line of para.lines) {
                if (/PINCODE/i.test(line.text)) {
                  candidateLines.push(line);
                }
              }
            }
          }
        }
      }
    }

    const rightmostX0s = [];
    let phoneX0s = [];
    let phoneX1s = [];

    for (const line of candidateLines) {
      const words = line.words || [];
      for (let i = words.length - 1; i >= 0; i--) {
        const w = words[i];
        const text = w.text || '';
        const cleanWord = text.replace(/[^a-zA-Z0-9]/g, '');
        const hasDigits = /[0-9]/.test(text) || /Tooooo/i.test(text) || /Tase000/i.test(text) || /Toso/i.test(text);

        if (hasDigits && cleanWord.length >= 3) {
          if (w.bbox && w.bbox.x0 > 0.80 * maxX) {
            rightmostX0s.push(w.bbox.x0);
            break;
          }
        }
      }

      words.forEach(w => {
        const text = w.text || '';
        if (/PHONE|MOBILE|PH|MOB/i.test(text) || (/^[6-9]\d{9}$/.test(text.replace(/\D/g, '')))) {
          if (w.bbox) {
            phoneX0s.push(w.bbox.x0);
            phoneX1s.push(w.bbox.x1);
          }
        }
      });
    }

    let amountColStart = Math.round(0.825 * maxX);
    if (rightmostX0s.length > 0) {
      const sorted = rightmostX0s.sort((a, b) => a - b);
      const minX0 = sorted[0];
      amountColStart = Math.max(Math.round(0.80 * maxX), Math.min(Math.round(0.83 * maxX), minX0 - 10));
    }

    let phoneColStart = Math.round(0.50 * maxX);
    let phoneColEnd = Math.round(0.80 * maxX);
    if (phoneX0s.length > 0 && phoneX1s.length > 0) {
      phoneColStart = Math.max(0, Math.min(...phoneX0s) - 20);
      phoneColEnd = Math.min(maxX, Math.max(...phoneX1s) + 20);
    }
    if (phoneColEnd >= amountColStart) {
      phoneColEnd = amountColStart - 20;
    }

    try {
      let cropLeft = Math.max(0, Math.min(amountColStart + 10, maxX - 10));
      let cropWidth = Math.max(10, maxX - cropLeft);
      const amountCropBuffer = await sharp(bestBuffer)
        .extract({ left: cropLeft, top: 0, width: cropWidth, height: maxY })
        .toBuffer();

      await worker.setParameters({ tessedit_char_whitelist: '0123456789\n\r ' });
      const amtCropRet = await worker.recognize(amountCropBuffer, {}, { blocks: true });
      cropData.amountCropBlocks = amtCropRet.data.blocks;
    } catch (cropAmtErr) {
      console.error("Secondary crop amount OCR failure:", cropAmtErr);
    }

    try {
      let cropLeft = Math.max(0, phoneColStart);
      let cropWidth = Math.max(10, phoneColEnd - phoneColStart);
      const phoneCropBuffer = await sharp(bestBuffer)
        .extract({ left: cropLeft, top: 0, width: cropWidth, height: maxY })
        .toBuffer();

      await worker.setParameters({ tessedit_char_whitelist: '0123456789\n\r ' });
      const phoneCropRet = await worker.recognize(phoneCropBuffer, {}, { blocks: true });
      cropData.phoneCropBlocks = phoneCropRet.data.blocks;
    } catch (cropPhoneErr) {
      console.error("Secondary crop phone OCR failure:", cropPhoneErr);
    }

    await worker.setParameters({ tessedit_char_whitelist: '' });

    const finalPageResult = parseExtractedTextWithLayout(bestOcrText, bestBlocks, pageNumber, fileName, cropData, corrections);
    bestRows = finalPageResult.extractedRows;
  }

  const quality = estimateQuality({ width: width * scale, height: height * scale }, bestConf);

  return {
    rows: bestRows,
    ocrText: bestOcrText,
    ocrBlocks: bestBlocks,
    variant: bestVariant,
    confidence: bestConf,
    qualityRating: quality.qualityRating,
    qualityMeta: {
      width: width * scale,
      height: height * scale,
      orientation: quality.orientation,
      isLowResolution: quality.isLowResolution,
      isBlurry: quality.isBlurry,
      isSkewed: quality.isSkewed,
      isTruncated,
      preprocessingMode: bestVariant,
      ocrConfidence: bestConf,
      qualityRating: quality.qualityRating
    }
  };
}

// Match cropped amount column value to grouped row by Y-coordinate
function findCropAmountForGroup(group, cropBlocks) {
  const rowY0 = group.bbox.y0;
  const rowY1 = group.bbox.y1;
  const matches = [];

  if (cropBlocks) {
    for (const block of cropBlocks) {
      if (block.paragraphs) {
        for (const para of block.paragraphs) {
          if (para.lines) {
            for (const clink of para.lines) {
              if (clink.words) {
                for (const w of clink.words) {
                  if (w.bbox) {
                    const wCenter = (w.bbox.y0 + w.bbox.y1) / 2;
                    if (wCenter >= rowY0 - 10 && wCenter <= rowY1 + 10) {
                      matches.push(w);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => a.bbox.x0 - b.bbox.x0);

  for (let i = matches.length - 1; i >= 0; i--) {
    const text = matches[i].text.replace(/\D/g, '');
    if (text.length >= 4) {
      return {
        amount: text,
        confidence: matches[i].confidence
      };
    }
  }

  const combined = matches.map(w => w.text.replace(/\D/g, '')).join('');
  if (combined.length >= 4) {
    const lastWord = matches[matches.length - 1];
    return {
      amount: combined,
      confidence: lastWord.confidence
    };
  }

  return null;
}

// Match cropped phone column value to grouped row by Y-coordinate
function findCropPhoneForGroup(group, cropBlocks) {
  const rowY0 = group.bbox.y0;
  const rowY1 = group.bbox.y1;
  const matches = [];

  if (cropBlocks) {
    for (const block of cropBlocks) {
      if (block.paragraphs) {
        for (const para of block.paragraphs) {
          if (para.lines) {
            for (const clink of para.lines) {
              if (clink.words) {
                for (const w of clink.words) {
                  if (w.bbox) {
                    const wCenter = (w.bbox.y0 + w.bbox.y1) / 2;
                    if (wCenter >= rowY0 - 10 && wCenter <= rowY1 + 10) {
                      matches.push(w);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => a.bbox.x0 - b.bbox.x0);

  for (let i = matches.length - 1; i >= 0; i--) {
    const digits = matches[i].text.replace(/\D/g, '');
    if (digits.length >= 10) {
      const candidate = digits.slice(-10);
      if (/^[6-9]/.test(candidate)) {
        return {
          phone: candidate,
          confidence: matches[i].confidence
        };
      }
    }
  }

  const combinedDigits = matches.map(w => w.text.replace(/\D/g, '')).join('');
  const match = combinedDigits.match(/[6-9]\d{9}/);
  if (match) {
    return {
      phone: match[0],
      confidence: Math.round(matches.reduce((sum, w) => sum + w.confidence, 0) / matches.length)
    };
  }

  return null;
}

function normalizeCity(cityWord) {
  if (!cityWord) return '';
  const w = cityWord.toUpperCase().replace(/[^A-Z]/g, '');
  if (w.includes('BANG') || w.includes('BENG') || w.includes('BLR')) {
    return 'BANGALORE';
  }
  if (w.includes('HYD')) {
    return 'HYDERABAD';
  }
  if (w.includes('CHEN') || w.includes('CHIN')) {
    return 'CHENNAI';
  }
  if (w.includes('SECUNDER') || w.includes('SECBAD')) {
    return 'SECUNDERABAD';
  }
  if (w.includes('MUMB') || w.includes('BOMB')) {
    return 'MUMBAI';
  }
  if (w.includes('DELH')) {
    return 'DELHI';
  }
  if (w === 'REDDY') {
    return 'SANGA REDDY';
  }
  if (w === 'RANGAREDDY' || w === 'RANGA') {
    return 'RANGAREDDY';
  }
  if (w === 'SANGA') {
    return 'SANGA REDDY';
  }
  return w;
}

// Fuzzy match city names as fallback
function extractCityFuzzy(text) {
  if (!text) return '';
  const cleanText = text.toUpperCase().replace(/[^A-Z\s]/g, ' ');
  const words = cleanText.split(/\s+/).filter(w => w.length >= 3);
  
  // Fuzzy match single words
  let bestCity = '';
  let minDistance = 999;
  
  for (const word of words) {
    for (const city of knownCities) {
      if (city.includes(' ')) continue;
      const dist = getLevenshteinDistance(word, city);
      const limit = city.length > 6 ? 2 : 1;
      if (dist <= limit && dist < minDistance) {
        minDistance = dist;
        bestCity = city;
      }
    }
  }

  // Fuzzy match multi-word cities using bigrams
  if (minDistance > 1) {
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i+1]}`;
      for (const city of knownCities) {
        if (!city.includes(' ')) continue;
        const dist = getLevenshteinDistance(bigram, city);
        if (dist <= 2 && dist < minDistance) {
          minDistance = dist;
          bestCity = city;
        }
      }
    }
  }

  if (bestCity && minDistance <= 2) {
    return bestCity;
  }

  return '';
}

function extractCity(line) {
  if (!line) return '';
  const upperLine = line.toUpperCase();
  
  // 1. Explicit multi-word/special cities checks first (priority)
  if (upperLine.includes('SANGA REDDY') || /SANGA\s+REDDY/i.test(line)) {
    return 'SANGA REDDY';
  }
  if (upperLine.includes('RANGA REDDY') || /RANGA\s*REDDY/i.test(line)) {
    return 'RANGAREDDY';
  }
  if (upperLine.includes('NEW DELHI')) {
    return 'NEW DELHI';
  }
  if (upperLine.includes('NAVI MUMBAI')) {
    return 'NAVI MUMBAI';
  }

  // 2. Try to find a known city (exact or fuzzy) in the entire line first
  for (const kc of knownCities) {
    const regex = new RegExp(`\\b${kc}\\b`, 'i');
    if (regex.test(upperLine)) {
      return kc;
    }
  }

  const fuzzyMatched = extractCityFuzzy(upperLine);
  if (fuzzyMatched) {
    return fuzzyMatched;
  }

  // 3. Scan before PINCODE for other custom/unknown cities
  const pinMatch = line.match(/(?:PINCODE|P1NC0DE|PIN\s+CODE)/i);
  if (pinMatch) {
    const pinIndex = pinMatch.index;
    const textBeforePin = line.substring(0, pinIndex).trim();
    const cleanedText = textBeforePin.replace(/([a-zA-Z])\.([a-zA-Z])/g, '$1$2');
    const words = cleanedText.split(/[^A-Za-z]+/).filter(w => w.length > 0);
    
    if (words.length > 0) {
      const lastWord = words[words.length - 1].toUpperCase();
      if (lastWord === 'REDDY') {
        if (words.length > 1 && words[words.length - 2].toUpperCase() === 'SANGA') {
          return 'SANGA REDDY';
        }
        if (words.length > 1 && words[words.length - 2].toUpperCase() === 'RANGA') {
          return 'RANGAREDDY';
        }
        return 'SANGA REDDY';
      }
      return normalizeCity(words[words.length - 1]);
    }
  }

  return '';
}

function extractPhoneNumber(lineText) {
  if (!lineText) return '';
  const cleanLine = lineText.toUpperCase();
  
  // Find sequences of digits/normalizable chars that look like phone numbers
  const candRegex = /[0-9OolIL|tTS§sbB\s\-\(\)\+]{7,22}/g;
  const matches = cleanLine.match(candRegex) || [];
  
  const phoneCandidates = [];
  for (const rawCand of matches) {
    const cleaned = normalizeOcrDigits(rawCand);
    const digits = cleaned.replace(/\D/g, '');
    if (digits.length >= 10) {
      const phone10 = digits.slice(-10);
      if (/^[6-9]\d{9}$/.test(phone10)) {
        phoneCandidates.push(phone10);
      }
    }
  }

  // Extract pincode to ignore
  let pincode = '';
  const pinMatch = lineText.match(/(?:PINCODE|P1NC0DE|PIN\s+CODE)?\s*\b(\d{6})\b/i);
  if (pinMatch) {
    pincode = pinMatch[1];
  }

  // Filter candidates
  const validCandidates = phoneCandidates.filter(cand => {
    if (pincode && cand.includes(pincode)) return false;
    return true;
  });

  if (validCandidates.length > 0) {
    let bestPhone = validCandidates[0];
    let minDistance = 999;
    const keywords = ['MOBILE', 'PHONE', 'MOB', 'PH', 'M0B1LE', 'M0BILE', 'PH0NE'];
    for (const kw of keywords) {
      const kwIdx = cleanLine.indexOf(kw);
      if (kwIdx !== -1) {
        for (const cand of validCandidates) {
          const candIdx = cleanLine.indexOf(cand);
          if (candIdx !== -1) {
            const dist = Math.abs(candIdx - kwIdx);
            if (dist < minDistance) {
              minDistance = dist;
              bestPhone = cand;
            }
          }
        }
      }
    }
    return bestPhone;
  }

  return '';
}

// Improved Amount Extraction Logic
function extractAmount(text, extractedPhone = '') {
  if (!text) return '';
  const upperText = text.toUpperCase();

  // Extract pincode to ignore
  let pincode = '';
  const pinMatch = text.match(/(?:PINCODE|P1NC0DE|PIN\s+CODE)?\s*\b(\d{6})\b/i);
  if (pinMatch) {
    pincode = pinMatch[1];
  }

  // Extract dates to ignore
  const dateMatches = text.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g) || [];
  const dateNumbers = dateMatches.map(d => d.replace(/\D/g, ''));

  // Normalize currency labels and format
  const cleanText = text
    .replace(/[₹]/g, ' RS ')
    .replace(/RS\./gi, ' RS ')
    .replace(/RS/gi, ' RS ')
    .toUpperCase();

  // Match standard numbers with optional commas and decimals
  const numRegex = /\b\d{1,3}(?:,\d{2,3})*(?:\.\d{2})?\b|\b\d{4,9}\b/g;
  const matches = cleanText.match(numRegex) || [];
  
  const candidates = [];
  for (const match of matches) {
    const rawVal = match.trim();
    let cleanVal = rawVal.replace(/,/g, '');
    if (cleanVal.includes('.')) {
      cleanVal = cleanVal.split('.')[0];
    }
    
    cleanVal = normalizeOcrDigits(cleanVal).replace(/\D/g, '');
    const numValue = parseFloat(cleanVal);
    
    if (isNaN(numValue) || numValue < 1000) continue;

    // Filter exclusions
    if (pincode && cleanVal === pincode) continue;
    if (extractedPhone && cleanVal === extractedPhone) continue;
    if (dateNumbers.some(d => d.includes(cleanVal) || cleanVal.includes(d))) continue;
    if (cleanVal.length === 10 && /^[6-9]/.test(cleanVal)) continue;

    // Heuristics scoring
    const idx = cleanText.indexOf(rawVal);
    let score = 0;
    
    if (idx !== -1) {
      const surroundingText = cleanText.substring(Math.max(0, idx - 30), Math.min(cleanText.length, idx + rawVal.length + 30));
      if (/RS|₹|AMT|AMOUNT|LOAN|SALARY|EMI|BALANCE|DISBURSAL|SANCTION/i.test(surroundingText)) {
        score += 100;
      }
      const relativePos = idx / cleanText.length;
      score += relativePos * 50;
    }

    candidates.push({
      amount: cleanVal,
      value: numValue,
      score: score
    });
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.value - a.value;
    });
    return candidates[0].amount;
  }

  return '';
}

// Fallback old text-only parsing logic (used if blocks coordinates fail)
function parseExtractedText(rawText, pageNumber = 1, sourceFileName = 'UploadedScan') {
  const cleanRawText = rawText
    .replace(/P1NC0DE/i, 'PINCODE')
    .replace(/PIN\s+CODE/i, 'PINCODE')
    .replace(/PH0NE/i, 'PHONE')
    .replace(/M0B1LE/i, 'MOBILE')
    .replace(/M0BILE/i, 'MOBILE');

  const rawLines = cleanRawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const candidateLines = rawLines.filter(line => /PINCODE/i.test(line));
  const results = [];
  let rowCounter = 1;

  for (const rowText of candidateLines) {
    const cleanRowText = rowText.replace(/\s{2,}/g, ' ').trim();
    const city = extractCity(cleanRowText);
    const phoneNumber = extractPhoneNumber(cleanRowText);
    const amount = extractAmount(cleanRowText, phoneNumber);
    
    let confidence = 100;
    const reviewReasons = [];
    
    let finalCity = city;
    if (!city || city.length < 2) {
      confidence -= 35;
      reviewReasons.push('City not detected');
      finalCity = 'Needs Review';
    }
    
    let finalPhone = phoneNumber;
    const isValidIndianPhone = phoneNumber && /^[6-9]\d{9}$/.test(phoneNumber);
    if (!phoneNumber) {
      confidence -= 35;
      reviewReasons.push('10-digit phone/mobile doubtful or missing');
      finalPhone = 'Needs Entry';
    } else if (!isValidIndianPhone) {
      confidence -= 35;
      reviewReasons.push('Phone number must be a 10-digit Indian number starting with 6, 7, 8, or 9');
    }
    
    let finalAmount = amount;
    const numericAmountVal = parseFloat(amount);
    const isValidAmount = !isNaN(numericAmountVal) && numericAmountVal >= 10000;
    const isPhoneEqualAmount = phoneNumber && amount && phoneNumber.replace(/\D/g, '') === amount.replace(/\D/g, '');
    const looksLikePhone = amount && /^[6-9]\d{9}$/.test(amount);
    const isSuspiciousAmount = amount && (amount.length >= 10 || looksLikePhone || (amount.length >= 8 && amount.startsWith('1')));

    if (!amount || isNaN(numericAmountVal) || numericAmountVal === 0) {
      confidence -= 35;
      reviewReasons.push('Amount doubtful or missing');
      finalAmount = '0';
    } else if (isPhoneEqualAmount) {
      confidence -= 35;
      reviewReasons.push('Amount should not equal phone/mobile');
    } else if (isSuspiciousAmount) {
      confidence -= 35;
      reviewReasons.push('Suspicious extra leading digit amount');
    } else if (!isValidAmount) {
      confidence -= 35;
      reviewReasons.push('Amount must be at least 10,000');
    }
    
    const numericAmount = parseFloat(finalAmount);
    const resolvedAmount = !isNaN(numericAmount) ? numericAmount : finalAmount;
    const isOk = reviewReasons.length === 0;

    results.push({
      pageNumber,
      pageNo: pageNumber,
      rowNumber: rowCounter,
      sNo: rowCounter,
      city: finalCity,
      phoneNumber: finalPhone,
      amount: resolvedAmount,
      originalText: rowText,
      originalOcrText: rowText,
      confidence: Math.max(confidence, 20),
      needsReview: !isOk,
      status: isOk ? 'OK' : 'Needs Review',
      reviewReason: reviewReasons.join(' • '),
      sourceFileName
    });
    rowCounter++;
  }
  
  return {
    rawLines,
    candidateLines,
    extractedRows: results
  };
}

// Layout coordinate-aware parsing logic with Y-coordinate grouping
function parseExtractedTextWithLayout(rawText, blocks, pageNumber = 1, sourceFileName = 'UploadedScan', cropData = {}, corrections = []) {
  const lines = [];
  if (blocks && Array.isArray(blocks)) {
    for (const block of blocks) {
      if (block.paragraphs) {
        for (const para of block.paragraphs) {
          if (para.lines) {
            for (const line of para.lines) {
              lines.push(line);
            }
          }
        }
      }
    }
  }

  // Fallback to text parsing if layout hierarchy was not populated
  if (lines.length === 0) {
    console.warn(`[OCR Debug] No lines found in layout blocks on page ${pageNumber}, using text fallback.`);
    return parseExtractedText(rawText, pageNumber, sourceFileName);
  }

  // Determine maximum dimensions
  let maxX = 0;
  let maxY = 0;
  for (const line of lines) {
    if (line.bbox) {
      if (line.bbox.x1 > maxX) maxX = line.bbox.x1;
      if (line.bbox.y1 > maxY) maxY = line.bbox.y1;
    }
  }
  if (maxX === 0) maxX = MIN_WIDTH;
  if (maxY === 0) maxY = 4000;

  // Group lines based on vertical overlap (Y-coordinate proximity)
  const sortedLines = [...lines].filter(l => l.bbox).sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const groupedRows = [];
  for (const line of sortedLines) {
    const y0 = line.bbox.y0;
    const y1 = line.bbox.y1;
    const height = y1 - y0;
    if (height <= 0) continue;

    let matchedGroup = null;
    for (const group of groupedRows) {
      const overlap = Math.min(group.bbox.y1, y1) - Math.max(group.bbox.y0, y0);
      const minH = Math.min(group.bbox.y1 - group.bbox.y0, y1 - y0);
      // Group lines sharing at least 45% of vertical height
      if (overlap > 0 && (overlap / minH) >= 0.45) {
        matchedGroup = group;
        break;
      }
    }

    if (matchedGroup) {
      matchedGroup.lines.push(line);
      matchedGroup.bbox.y0 = Math.min(matchedGroup.bbox.y0, y0);
      matchedGroup.bbox.y1 = Math.max(matchedGroup.bbox.y1, y1);
    } else {
      groupedRows.push({
        bbox: { y0, y1 },
        lines: [line]
      });
    }
  }

  // Reconstruct row candidates from groups, splitting if multi-column
  const candidateGroups = [];
  for (const group of groupedRows) {
    const allWords = [];
    for (const line of group.lines) {
      if (line.words) {
        allWords.push(...line.words);
      }
    }
    // Sort words horizontally left-to-right
    allWords.sort((a, b) => (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0));
    
    const tempGroup = {
      bbox: group.bbox,
      words: allWords
    };

    const splitGroups = splitMultiColumnGroup(tempGroup);
    for (const sg of splitGroups) {
      if (/PINCODE/i.test(sg.text)) {
        candidateGroups.push(sg);
      }
    }
  }

  const results = [];
  let rowCounter = 1;

  for (const group of candidateGroups) {
    const cleanText = group.text
      .replace(/P1NC0DE/i, 'PINCODE')
      .replace(/PIN\s+CODE/i, 'PINCODE')
      .replace(/PH0NE/i, 'PHONE')
      .replace(/M0B1LE/i, 'MOBILE')
      .replace(/M0BILE/i, 'MOBILE');

    const city = extractCity(cleanText);
    
    // Extract phone numbers using extractAllPhoneNumbers
    const phoneResultStandard = extractAllPhoneNumbers(cleanText);
    let phoneNumber = phoneResultStandard.best;
    let otherPhones = phoneResultStandard.others;
    let phoneSource = 'standard';
    let phoneCropConf = null;

    const isPhoneStandardInvalid = !phoneNumber || !/^[6-9]\d{9}$/.test(phoneNumber);
    if (isPhoneStandardInvalid && cropData.phoneCropBlocks) {
      const croppedPhoneRes = findCropPhoneForGroup(group, cropData.phoneCropBlocks);
      if (croppedPhoneRes) {
        phoneNumber = croppedPhoneRes.phone;
        phoneSource = 'crop';
        phoneCropConf = croppedPhoneRes.confidence;
        if (phoneResultStandard.best && phoneResultStandard.best !== phoneNumber && !otherPhones.includes(phoneResultStandard.best)) {
          otherPhones.push(phoneResultStandard.best);
        }
      }
    }

    const amountStandard = extractAmount(cleanText, phoneNumber);
    let amount = amountStandard;
    let amountSource = 'standard';
    let amountCropConf = null;

    if (cropData.amountCropBlocks) {
      const croppedAmountRes = findCropAmountForGroup(group, cropData.amountCropBlocks);
      if (croppedAmountRes) {
        const cropVal = croppedAmountRes.amount;
        const cropConf = croppedAmountRes.confidence;
        const isStandardPhone = phoneNumber && amountStandard && phoneNumber.replace(/\D/g, '') === amountStandard.replace(/\D/g, '');
        const looksLikePhoneStandard = amountStandard && /^[6-9]\d{9}$/.test(amountStandard);

        if ((isStandardPhone || looksLikePhoneStandard) && cropVal) {
          amount = cropVal;
          amountSource = 'crop';
          amountCropConf = cropConf;
        } else if ((!amountStandard || parseFloat(amountStandard) === 0 || parseFloat(amountStandard) < 10000) && cropVal && cropConf >= 40) {
          amount = cropVal;
          amountSource = 'crop';
          amountCropConf = cropConf;
        }
      }
    }

    const reviewReasons = [];

    // Confidence calculations
    const cityConfidence = getFieldConfidence(city, group.words, 'city');
    const phoneConfidence = phoneSource === 'crop' ? phoneCropConf : getFieldConfidence(phoneNumber, group.words, 'phone');
    const amountConfidence = amountSource === 'crop' ? amountCropConf : getFieldConfidence(amount, group.words, 'amount');
    const overallConfidence = Math.round((cityConfidence + phoneConfidence + amountConfidence) / 3);

    let finalCity = city;
    if (!city || city.length < 2) {
      reviewReasons.push('City not detected');
      finalCity = 'Needs Review';
    }

    let finalPhone = phoneNumber;
    const isValidIndianPhone = phoneNumber && /^[6-9]\d{9}$/.test(phoneNumber);
    if (!phoneNumber) {
      reviewReasons.push('10-digit phone/mobile doubtful or missing');
      finalPhone = 'Needs Entry';
    } else if (!isValidIndianPhone) {
      reviewReasons.push('Phone number must be a 10-digit Indian number starting with 6, 7, 8, or 9');
    }

    let finalAmount = amount;
    const numericAmountVal = parseFloat(amount);
    const isValidAmount = !isNaN(numericAmountVal) && numericAmountVal >= 10000;
    const isPhoneEqualAmount = phoneNumber && amount && phoneNumber.replace(/\D/g, '') === amount.replace(/\D/g, '');
    const looksLikePhone = amount && /^[6-9]\d{9}$/.test(amount);
    const isSuspiciousAmount = amount && (amount.length >= 10 || looksLikePhone || (amount.length >= 8 && amount.startsWith('1')));

    // Determine row status (OK, Source Truncated / Missing Amount, Low OCR Confidence, Needs Review)
    let status = 'OK';

    if (!amount || isNaN(numericAmountVal) || numericAmountVal === 0) {
      status = 'Source Truncated / Missing Amount';
      reviewReasons.push(cropData.isTruncated ? 'Amount missing due to truncated page scan' : 'Amount doubtful or missing');
      finalAmount = '0';
    } else if (isPhoneEqualAmount) {
      status = 'Needs Review';
      reviewReasons.push('Amount should not equal phone/mobile');
    } else if (isSuspiciousAmount) {
      status = 'Needs Review';
      reviewReasons.push('Suspicious extra leading digit amount');
    } else if (!isValidAmount) {
      status = 'Needs Review';
      reviewReasons.push('Amount must be at least 10,000');
    }

    // Demote to Needs Review if city or phone is missing/invalid
    if (status === 'OK') {
      if (!city || city.length < 2 || !phoneNumber || !isValidIndianPhone) {
        status = 'Needs Review';
      }
    }

    // Demote to Low OCR Confidence if overall confidence is under 60
    if (status === 'OK' && overallConfidence < 60) {
      status = 'Low OCR Confidence';
      reviewReasons.push('Low OCR extraction confidence');
    } else if (status === 'Needs Review' && overallConfidence < 60) {
      status = 'Low OCR Confidence';
      reviewReasons.push('Low OCR extraction confidence');
    }

    const numericAmount = parseFloat(finalAmount);
    const resolvedAmount = !isNaN(numericAmount) ? numericAmount : finalAmount;
    const isOk = status === 'OK';

    const rowObj = {
      pageNumber,
      pageNo: pageNumber,
      rowNumber: rowCounter,
      sNo: rowCounter,
      city: finalCity,
      phoneNumber: finalPhone,
      amount: resolvedAmount,
      originalText: group.text,
      originalOcrText: group.text,
      cityConfidence,
      phoneConfidence,
      amountConfidence,
      confidence: overallConfidence,
      needsReview: !isOk,
      status: status,
      reviewReason: reviewReasons.join(' • '),
      sourceFileName,
      otherPhoneCandidates: otherPhones
    };

    applyManualCorrections(rowObj, group.text, corrections);
    results.push(rowObj);
    rowCounter++;
  }

  // Duplicate checks page-wise
  const phoneAmountMap = {};
  for (const row of results) {
    const phone = (row.phoneNumber || '').replace(/\D/g, '');
    const amt = (row.amount || '').toString().replace(/\D/g, '');
    if (phone && amt) {
      const key = `${phone}_${amt}`;
      if (!phoneAmountMap[key]) {
        phoneAmountMap[key] = [];
      }
      phoneAmountMap[key].push(row);
    }
  }

  for (const key in phoneAmountMap) {
    if (phoneAmountMap[key].length > 1) {
      for (const row of phoneAmountMap[key]) {
        const msg = 'Possible Duplicate (same phone & amount on page)';
        if (!row.reviewReason.includes(msg)) {
          row.reviewReason = row.reviewReason ? `${row.reviewReason} • ${msg}` : msg;
        }
      }
    }
  }

  const rawLines = lines.map(line => line.text);
  const candidateLinesText = candidateGroups.map(g => g.text);

  return {
    rawLines,
    candidateLines: candidateLinesText,
    extractedRows: results
  };
}export async function processFileForOcr(fileBuffer, mimeType, fileName, onProgress) {
  let allRows = [];
  let pageCount = 0;
  const debugData = [];
  const worker = await createWorker('eng');
  const corrections = loadCorrections();

  try {
    if (mimeType.startsWith('image/')) {
      pageCount = 1;
      if (typeof onProgress === 'function') {
        onProgress({
          currentPage: 0,
          totalPages: 1,
          message: 'Image processing started'
        });
      }

      // Detect truncation on direct image upload
      let isTruncated = false;
      try {
        const meta = await sharp(fileBuffer).metadata();
        const width = meta.width || 1200;
        const height = meta.height || 1600;
        const aspect = height / width;
        // Heuristic: if very narrow, it might be truncated
        if (aspect > 1.45) {
          isTruncated = true;
        }
      } catch (e) {
        console.warn("Failed to check image metadata for truncation:", e);
      }

      const pageRes = await processPageImage(fileBuffer, null, 1, fileName, isTruncated, corrections, worker);
      allRows.push(...pageRes.rows);

      debugData.push({
        inputType: 'image',
        pageNumber: 1,
        ...pageRes.qualityMeta,
        rawText: pageRes.ocrText,
        rawLines: pageRes.rows.map(r => r.originalText),
        candidateLines: pageRes.rows.map(r => r.originalText),
        extractedRows: pageRes.rows
      });

      console.log(`[OCR Debug] Processed direct image 1 / 1. Rows: ${pageRes.rows.length}, status: ${pageRes.qualityRating}`);

      if (typeof onProgress === 'function') {
        onProgress({
          currentPage: 1,
          totalPages: 1,
          message: 'Completed processing image'
        });
      }

    } else if (mimeType === 'application/pdf') {
      const data = new Uint8Array(fileBuffer);
      const loadingTask = pdfjs.getDocument({ data });
      const pdf = await loadingTask.promise;
      pageCount = pdf.numPages;
      const pageStats = [];
      if (typeof onProgress === 'function') {
        onProgress({
          currentPage: 0,
          totalPages: pageCount,
          message: `PDF loaded. ${pageCount} pages found.`
        });
      }

      console.log(`[OCR Debug] Starting PDF processing for ${fileName}. Total pages: ${pageCount}`);

      // Query page viewports to find maximum page width for truncation checking
      let maxPdfPageWidth = 0;
      const pageViewports = [];
      for (let p = 1; p <= pageCount; p++) {
        try {
          const pg = await pdf.getPage(p);
          const vp = pg.getViewport({ scale: 1 });
          pageViewports.push({ p, width: vp.width, height: vp.height });
          if (vp.width > maxPdfPageWidth) {
            maxPdfPageWidth = vp.width;
          }
          pg.cleanup?.();
        } catch (vpErr) {
          console.warn(`[OCR Debug] Failed to get viewport for page ${p}:`, vpErr);
        }
      }

      for (let p = 1; p <= pageCount; p++) {
        console.log(`[OCR] PDF page ${p} started`);
        logMemory(`before page ${p}`);
        if (typeof onProgress === 'function') {
          onProgress({
            currentPage: p,
            totalPages: pageCount,
            message: `Processing page ${p} of ${pageCount}`
          });
        }

        let page = null;
        let opList = null;
        let imgObj = null;

        try {
          page = await pdf.getPage(p);
          opList = await page.getOperatorList();

          let imgId = null;
          const OPS = pdfjs.OPS;
          for (let i = 0; i < opList.fnArray.length; i++) {
            if (opList.fnArray[i] === OPS.paintImageXObject) {
              imgId = opList.argsArray[i][0];
              break;
            }
          }

          if (!imgId) {
            console.warn(`[OCR Debug] No image object found on page ${p}, skipping.`);
            continue;
          }

          imgObj = page.objs.get(imgId);
          if (!imgObj) {
            console.warn(`[OCR Debug] Image object ${imgId} not resolved on page ${p}, skipping.`);
            continue;
          }

          const channels = imgObj.kind === 3 ? 4 : (imgObj.kind === 2 ? 3 : 1);
          
          // Determine if this specific page is truncated
          const isTruncated = pageViewports.find(v => v.p === p)?.width < 0.90 * maxPdfPageWidth;
          if (isTruncated) {
            console.log(`[OCR Debug] Page ${p} width is narrower than document maximum. Tagged as TRUNCATED.`);
          }

          const pageRes = await processPageImage(
            imgObj.data,
            { width: imgObj.width, height: imgObj.height, channels },
            p,
            fileName,
            isTruncated,
            corrections,
            worker
          );

          allRows.push(...pageRes.rows);

          if (IS_PROD) {
            pageStats.push({
              pageNumber: p,
              extractedRows: pageRes.rows.length,
              ocrTextLength: pageRes.ocrText.length
            });
          } else {
            debugData.push({
              inputType: 'pdf',
              pageNumber: p,
              ...pageRes.qualityMeta,
              rawText: pageRes.ocrText,
              rawLines: pageRes.rows.map(r => r.originalText),
              candidateLines: pageRes.rows.map(r => r.originalText),
              extractedRows: pageRes.rows
            });
          }

          console.log(`[OCR Debug] Processed page ${p} / ${pageCount}. Rows: ${pageRes.rows.length}`);

          if (isProductionPdfMemoryUnsafe()) {
            const warning = `Production PDF OCR stopped after page ${p} because memory reached ${getMemorySnapshot().rssMb} MB RSS. Returning partial result.`;
            console.warn(`[OCR Warning] ${warning}`);
            if (typeof onProgress === 'function') {
              onProgress({
                currentPage: p,
                totalPages: pageCount,
                message: warning
              });
            }
            try {
              await loadingTask.destroy();
            } catch (destroyErr) {
              console.warn('[OCR Memory] PDF destroy failed after partial result:', destroyErr);
            }
            return {
              rows: allRows,
              pageCount,
              totalExtracted: allRows.length,
              needsReviewCount: allRows.filter(r => r.needsReview || r.status !== 'OK').length,
              warning,
              partial: true,
              pageStats
            };
          }

        } catch (pageErr) {
          console.error(`[OCR Error] Page ${p} processing failed:`, pageErr);
          if (IS_PROD) {
            pageStats.push({ pageNumber: p, error: pageErr?.message || String(pageErr) });
          } else {
            debugData.push({ pageNumber: p, error: pageErr?.message || String(pageErr) });
          }
        } finally {
          if (typeof onProgress === 'function') {
            onProgress({
              currentPage: p,
              totalPages: pageCount,
              message: `Completed page ${p} of ${pageCount}`
            });
          }
          try {
            page?.cleanup?.();
          } catch (cleanupErr) {
            console.warn(`[OCR Memory] Page ${p} cleanup failed:`, cleanupErr);
          }
          page = null;
          opList = null;
          imgObj = null;
          logMemory(`after page ${p}`);
          if (global.gc) {
            global.gc();
          }
        }
      }
    } else {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    // Save raw_ocr_debug.json
    if (!IS_PROD) {
      try {
        fs.writeFileSync(
          path.join(os.tmpdir(), 'paisadu_raw_ocr_debug.json'),
          JSON.stringify(debugData, null, 2)
        );
        console.log(`[OCR Debug] Successfully saved raw_ocr_debug.json`);
      } catch (e) {
        console.error('Failed to write raw_ocr_debug.json:', e);
      }
    }
    console.log(`[OCR Debug] Total pages/images processed: ${pageCount}`);

  } catch (err) {
    console.error('Error during OCR execution:', err);
    return {
      error: true,
      message: err?.message || String(err),
      rows: allRows,
      pageCount,
      totalExtracted: allRows.length,
      needsReviewCount: allRows.filter(r => r.needsReview || r.status !== 'OK').length
    };
  } finally {
    await worker.terminate();
  }

  return {
    rows: allRows,
    pageCount,
    totalExtracted: allRows.length,
    needsReviewCount: allRows.filter(r => r.needsReview || r.status !== 'OK').length
  };
}
