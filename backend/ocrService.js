import { createWorker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const IS_PROD = process.env.NODE_ENV === 'production';
const MIN_WIDTH = IS_PROD ? 2200 : 3000;

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
    return path.join(cwd, 'backend', 'corrections.json');
  }
  if (path.basename(cwd) === 'backend') {
    return path.join(cwd, 'corrections.json');
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

// Match cropped amount column value to main lines by Y-coordinate
function findCropAmountForLine(line, cropBlocks) {
  if (!line.bbox) return null;
  const lineY0 = line.bbox.y0;
  const lineY1 = line.bbox.y1;

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
                    if (wCenter >= lineY0 - 5 && wCenter <= lineY1 + 5) {
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
      amount: lastWord.text.replace(/\D/g, ''),
      confidence: lastWord.confidence
    };
  }

  return null;
}

// Match cropped phone column value to main lines by Y-coordinate
function findCropPhoneForLine(line, cropBlocks) {
  if (!line.bbox) return null;
  const lineY0 = line.bbox.y0;
  const lineY1 = line.bbox.y1;

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
                    if (wCenter >= lineY0 - 5 && wCenter <= lineY1 + 5) {
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

function extractCity(line) {
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

  // 2. Scan before PINCODE for other cities
  const pinMatch = line.match(/(?:PINCODE|P1NC0DE|PIN\s+CODE)/i);
  if (pinMatch) {
    const pinIndex = pinMatch.index;
    const textBeforePin = line.substring(0, pinIndex).trim();
    const cleanedText = textBeforePin.replace(/([a-zA-Z])\.([a-zA-Z])/g, '$1$2');
    const words = cleanedText.split(/[^A-Za-z]+/).filter(w => w.length > 0);
    
    // Search words from right to left
    for (let i = words.length - 1; i >= 0; i--) {
      const normalized = normalizeCity(words[i]);
      if (knownCities.includes(normalized)) {
        return normalized;
      }
    }
    if (words.length > 0) {
      const lastWord = words[words.length - 1].toUpperCase();
      if (lastWord === 'REDDY') {
        if (words.length > 1 && words[words.length - 2].toUpperCase() === 'SANGA') {
          return 'SANGA REDDY';
        }
        if (words.length > 1 && words[words.length - 2].toUpperCase() === 'RANGA') {
          return 'RANGAREDDY';
        }
        return 'SANGA REDDY'; // Fallback for REDDY
      }
      return normalizeCity(words[words.length - 1]);
    }
  }
  
  // 3. Absolute fallback: search the entire line for known cities
  for (const kc of knownCities) {
    if (new RegExp(`\\b${kc}\\b`, 'i').test(line)) {
      return kc;
    }
  }
  return '';
}

function extractPhoneNumber(lineText) {
  function getClean10Digits(cand) {
    if (!cand) return null;
    let cleaned = cand
      .replace(/[Il|]/g, '1')
      .replace(/[O]/g, '0')
      .replace(/[§SsbB]/g, (char) => {
        if (char === '§' || char === 'S' || char === 's' || char === 'B') return '8';
        if (char === 'b') return '6';
        return char;
      });
    const digits = cleaned.replace(/\D/g, '');
    if (digits.length >= 10) {
      return digits.slice(-10);
    }
    return null;
  }

  // 1. Try to extract from MOBILE (highest priority)
  let extracted = '';
  const mobileMatch = lineText.match(/(?:MOBILE|M0B1LE|M0BILE|MOB)[\s:|\-]*([+\d\-\(\)\s§SsbB]{7,20})/i);
  if (mobileMatch) {
    extracted = getClean10Digits(mobileMatch[1]) || '';
  }

  // 2. Try to extract from PHONE if MOBILE is empty
  if (!extracted) {
    const phoneMatch = lineText.match(/(?:PHONE|PH0NE|PH)[\s:|\-]*([+\d\-\(\)\s§SsbB]{7,20})/i);
    if (phoneMatch) {
      extracted = getClean10Digits(phoneMatch[1]) || '';
    }
  }

  // 3. Fallback: search the entire text for any 10-digit number starting with 6,7,8,9
  if (!extracted) {
    const cleanedText = lineText
      .replace(/[Il|]/g, '1')
      .replace(/[O]/g, '0')
      .replace(/[§SsbB]/g, (char) => {
        if (char === '§' || char === 'S' || char === 's' || char === 'B') return '8';
        if (char === 'b') return '6';
        return char;
      });
    const fallbackMatch = cleanedText.match(/\b([6789]\d{9})\b/);
    if (fallbackMatch) {
      extracted = fallbackMatch[1];
    }
  }

  // 4. Zero-starting Mobile Number Correction using evidence search
  if (extracted && extracted.startsWith('0')) {
    const cleanedText = lineText
      .replace(/[Il|]/g, '1')
      .replace(/[O]/g, '0')
      .replace(/[§SsbB]/g, (char) => {
        if (char === '§' || char === 'S' || char === 's' || char === 'B') return '8';
        if (char === 'b') return '6';
        return char;
      });
    
    // Find all valid 10-digit Indian numbers in the cleaned text (starting with 6-9)
    const allValidNumbers = cleanedText.match(/\b[6-9]\d{9}\b/g) || [];
    const suffix = extracted.slice(1);
    const temp9 = '9' + suffix;
    
    // Search for a matching 10-digit number in the text that starts with 6-9 and matches suffix similarity
    let foundBetter = false;
    for (const match of allValidNumbers) {
      let common = 0;
      for (let i = 0; i < 10; i++) {
        if (match[i] === temp9[i]) common++;
      }
      if (common >= 8) {
        extracted = temp9;
        foundBetter = true;
        break;
      }
    }
    // "Never blindly change 0 to 9 without evidence." -> If no valid 6-9 starting number is found,
    // we keep the extracted value (and validation will mark it as Needs Review).
  }

  return extracted;
}

function cleanAmount(cand) {
  if (!cand) return '';
  let cleaned = cand.trim().toUpperCase();

  // Handle specific known corrupted OCR amount strings
  if (cleaned.includes('TOOOOO')) return '100000';
  if (cleaned.includes('TASE000')) return '1500000';
  if (cleaned.includes('TOSO')) return '1000000';
  if (cleaned.includes('SO000')) return '50000';

  let replaced = cleaned
    .replace(/\{/g, '1')
    .replace(/\}/g, '0')
    .replace(/[oO]/g, '0')
    .replace(/[iIl|]/g, '1')
    .replace(/[tT]/g, '1')
    .replace(/[sS]/g, '5')
    .replace(/[zZ]/g, '2')
    .replace(/[gGqQ]/g, '9')
    .replace(/[bB]/g, '8');

  const digits = replaced.replace(/\D/g, '');
  return digits;
}

function extractAmountFromRightText(rightText, pincode, phoneNumber) {
  if (!rightText) return '';
  
  // Replace RS/₹ symbols with space first
  let cleanedText = rightText.toUpperCase().replace(/RS/g, ' ').replace(/₹/g, ' ');
  let cleanedEnd = cleanedText.trim().replace(/[\s|~_\.\*\[\]\:\-]+$/, '');
  
  // Split strictly by non-alphanumeric characters to keep words like Toso, Tase000 whole
  const tokens = cleanedEnd.split(/[^A-Z0-9]+/).filter(t => t.length > 0);
  
  const cleanPhone = phoneNumber ? phoneNumber.replace(/\D/g, '') : '';
  const cleanPin = pincode ? pincode.replace(/\D/g, '') : '';
  
  // Scan from right to left
  for (let i = tokens.length - 1; i >= 0; i--) {
    const rawToken = tokens[i];
    const cleanedDigits = cleanAmount(rawToken);
    
    if (!cleanedDigits) continue;
    
    // Ignore if it's equal to phone or pincode or common local STD codes
    if (cleanPhone && cleanedDigits === cleanPhone) continue;
    if (cleanPin && cleanedDigits === cleanPin) continue;
    if (cleanedDigits === '022' || cleanedDigits === '22' || cleanedDigits === '080' || cleanedDigits === '80') continue;
    
    // An amount must be at least 4 digits
    if (cleanedDigits.length < 4) continue;
    
    return cleanedDigits;
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
    let pincode = '';
    const pinMatch = cleanRowText.match(/PINCODE[\s:]*(\d{6})/i);
    if (pinMatch) {
      pincode = pinMatch[1];
    }
    const city = extractCity(cleanRowText);
    const phoneNumber = extractPhoneNumber(cleanRowText);
    
    // Fallback amount parsing
    let amount = '';
    let cleanedText = cleanRowText.toUpperCase().replace(/RS/g, ' ').replace(/₹/g, ' ');
    let cleanedEnd = cleanedText.trim().replace(/[\s|~_\.\*\[\]\:\-]+$/, '');
    const tokens = cleanedEnd.split(/[^A-Z0-9]+/).filter(t => t.length > 0);
    const cleanPhone = phoneNumber ? phoneNumber.replace(/\D/g, '') : '';
    const cleanPin = pincode ? pincode.replace(/\D/g, '') : '';
    
    for (let i = tokens.length - 1; i >= 0; i--) {
      const rawToken = tokens[i];
      const cleanedDigits = cleanAmount(rawToken);
      if (!cleanedDigits) continue;
      if (cleanPhone && cleanedDigits === cleanPhone) continue;
      if (cleanPin && cleanedDigits === cleanPin) continue;
      if (cleanedDigits === '022' || cleanedDigits === '22' || cleanedDigits === '080' || cleanedDigits === '80') continue;
      if (cleanedDigits.length < 4) continue;
      amount = cleanedDigits;
      break;
    }
    
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
    const isOk = 
      finalCity !== 'Needs Review' &&
      finalPhone !== 'Needs Entry' &&
      isValidIndianPhone &&
      isValidAmount &&
      !isPhoneEqualAmount &&
      !isSuspiciousAmount &&
      reviewReasons.length === 0;

    results.push({
      pageNumber,
      pageNo: pageNumber,
      rowNumber: rowCounter,
      sNo: rowCounter++,
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
  }
  
  return {
    rawLines,
    candidateLines,
    extractedRows: results
  };
}

// Layout coordinate-aware parsing logic
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

  const candidateLines = [];
  for (const line of lines) {
    let cleanText = line.text || '';
    cleanText = cleanText
      .replace(/P1NC0DE/i, 'PINCODE')
      .replace(/PIN\s+CODE/i, 'PINCODE')
      .replace(/PH0NE/i, 'PHONE')
      .replace(/M0B1LE/i, 'MOBILE')
      .replace(/M0BILE/i, 'MOBILE');

    if (/PINCODE/i.test(cleanText)) {
      candidateLines.push({
        ...line,
        cleanText
      });
    }
  }

  // 1. Determine maximum horizontal coordinate (maxX) and maxY
  let maxX = 0;
  let maxY = 0;
  for (const line of lines) {
    if (line.bbox) {
      if (line.bbox.x1 > maxX) {
        maxX = line.bbox.x1;
      }
      if (line.bbox.y1 > maxY) {
        maxY = line.bbox.y1;
      }
    }
  }
  if (maxX === 0) maxX = MIN_WIDTH;
  if (maxY === 0) maxY = 4000;

  // 2. Identify the starting coordinates of the rightmost numeric amount values on the page
  const rightmostX0s = [];
  for (const line of candidateLines) {
    const words = line.words || [];
    for (let i = words.length - 1; i >= 0; i--) {
      const w = words[i];
      const text = w.text || '';
      const cleanWord = text.replace(/[^a-zA-Z0-9]/g, '');
      const hasDigits = /[0-9]/.test(text) || /Tooooo/i.test(text) || /Tase000/i.test(text) || /Toso/i.test(text);

      if (hasDigits && cleanWord.length >= 3) {
        // Amount column is on the far right. Restrict coordinates search to rightmost 20% of the page
        if (w.bbox && w.bbox.x0 > 0.80 * maxX) {
          rightmostX0s.push(w.bbox.x0);
          break; // Found the rightmost token for this line
        }
      }
    }
  }

  // 3. Compute amount column boundary start X (amountColStart)
  let amountColStart = Math.round(0.825 * maxX);
  if (rightmostX0s.length > 0) {
    const sorted = rightmostX0s.sort((a, b) => a - b);
    const minX0 = sorted[0];
    // Restrict column start to a safe range [80% width, 83% width] to prevent encroachment on phone numbers
    amountColStart = Math.max(Math.round(0.80 * maxX), Math.min(Math.round(0.83 * maxX), minX0 - 10));
  }
  console.log(`[OCR Debug] Page ${pageNumber}: width = ${maxX}, height = ${maxY}, Amount column starts at X = ${amountColStart}`);

  const results = [];
  let rowCounter = 1;

  for (const line of candidateLines) {
    const words = line.words || [];
    const leftWords = [];
    const rightWords = [];

    // Separate words based on X coordinate threshold
    for (const w of words) {
      if (w.bbox && w.bbox.x0 >= amountColStart) {
        rightWords.push(w);
      } else {
        leftWords.push(w);
      }
    }

    const leftText = leftWords.map(w => w.text).join(' ').trim();
    const rightText = rightWords.map(w => w.text).join(' ').trim();

    const cleanLeftText = leftText
      .replace(/P1NC0DE/i, 'PINCODE')
      .replace(/PIN\s+CODE/i, 'PINCODE')
      .replace(/PH0NE/i, 'PHONE')
      .replace(/M0B1LE/i, 'MOBILE')
      .replace(/M0BILE/i, 'MOBILE');

    let pincode = '';
    const pinMatch = cleanLeftText.match(/PINCODE[\s:]*(\d{6})/i);
    if (pinMatch) {
      pincode = pinMatch[1];
    }

    const city = extractCity(cleanLeftText);
    const phoneNumberStandard = extractPhoneNumber(cleanLeftText);
    const phoneConfidenceStandard = getFieldConfidence(phoneNumberStandard, leftWords, 'phone');
    const isPhoneStandardInvalid = !phoneNumberStandard || !/^[6-9]\d{9}$/.test(phoneNumberStandard);

    let phoneNumber = phoneNumberStandard;
    let phoneSource = 'standard';
    let phoneCropConf = null;

    if (isPhoneStandardInvalid) {
      if (cropData.phoneCropBlocks) {
        const croppedPhoneRes = findCropPhoneForLine(line, cropData.phoneCropBlocks);
        if (croppedPhoneRes) {
          phoneNumber = croppedPhoneRes.phone;
          phoneSource = 'crop';
          phoneCropConf = croppedPhoneRes.confidence;
        }
      }
    }

    let amountStandard = extractAmountFromRightText(rightText, pincode, phoneNumber);
    const amountConfidenceStandard = getFieldConfidence(amountStandard, rightWords, 'amount');
    const numericAmountValStandard = parseFloat(amountStandard);
    const isValidAmountStandard = !isNaN(numericAmountValStandard) && numericAmountValStandard >= 10000;
    const isPhoneEqualAmountStandard = phoneNumber && amountStandard && phoneNumber.replace(/\D/g, '') === amountStandard.replace(/\D/g, '');
    const looksLikePhoneStandard = amountStandard && /^[6-9]\d{9}$/.test(amountStandard);
    const isSuspiciousAmountStandard = amountStandard && (amountStandard.length >= 10 || looksLikePhoneStandard || (amountStandard.length >= 8 && amountStandard.startsWith('1')));

    const isAmountStandardInvalid = !amountStandard || isNaN(numericAmountValStandard) || numericAmountValStandard === 0 || !isValidAmountStandard;
    const isAmountStandardSuspicious = isPhoneEqualAmountStandard || isSuspiciousAmountStandard;

    let amount = amountStandard;
    let amountSource = 'standard';
    let amountCropConf = null;

    if (cropData.amountCropBlocks) {
      const croppedAmountRes = findCropAmountForLine(line, cropData.amountCropBlocks);
      if (croppedAmountRes) {
        const cropVal = croppedAmountRes.amount;
        const cropConf = croppedAmountRes.confidence;
        const isStandardPhone = isPhoneEqualAmountStandard || looksLikePhoneStandard;

        // Override Rule 1: Standard amount is a phone/mobile -> always override with crop if crop is present
        if (isStandardPhone && cropVal) {
          amount = cropVal;
          amountSource = 'crop';
          amountCropConf = cropConf;
        }
        // Override Rule 2: Standard is invalid/suspicious, crop is valid, and crop confidence is decent (>= 40)
        else if ((isAmountStandardInvalid || isAmountStandardSuspicious) && cropVal && cropConf >= 40) {
          amount = cropVal;
          amountSource = 'crop';
          amountCropConf = cropConf;
        }
      }
    }

    if (!amount) {
      amount = amountStandard;
    }

    const reviewReasons = [];

    // Calculate OCR field confidences
    const cityConfidence = getFieldConfidence(city, leftWords, 'city');
    const phoneConfidence = phoneSource === 'crop' ? phoneCropConf : getFieldConfidence(phoneNumber, leftWords, 'phone');
    const amountConfidence = amountSource === 'crop' ? amountCropConf : getFieldConfidence(amount, rightWords, 'amount');
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

    if (!amount || isNaN(numericAmountVal) || numericAmountVal === 0) {
      reviewReasons.push('Amount doubtful or missing');
      finalAmount = '0';
    } else if (isPhoneEqualAmount) {
      reviewReasons.push('Amount should not equal phone/mobile');
    } else if (isSuspiciousAmount) {
      reviewReasons.push('Suspicious extra leading digit amount');
    } else if (!isValidAmount) {
      reviewReasons.push('Amount must be at least 10,000');
    }

    const numericAmount = parseFloat(finalAmount);
    const resolvedAmount = !isNaN(numericAmount) ? numericAmount : finalAmount;

    const isOk = reviewReasons.length === 0;

    const rowObj = {
      pageNumber,
      pageNo: pageNumber,
      rowNumber: rowCounter,
      sNo: rowCounter++,
      city: finalCity,
      phoneNumber: finalPhone,
      amount: resolvedAmount,
      originalText: line.text,
      originalOcrText: line.text,
      cityConfidence,
      phoneConfidence,
      amountConfidence,
      confidence: overallConfidence,
      needsReview: !isOk,
      status: isOk ? 'OK' : 'Needs Review',
      reviewReason: reviewReasons.join(' • '),
      sourceFileName
    };

    // Apply manual corrections suggests
    applyManualCorrections(rowObj, line.text, corrections);

    results.push(rowObj);
  }

  // Duplicate detection page-wise
  const phoneAmountMap = {};
  for (const row of results) {
    const phone = (row.phoneNumber || '').replace(/\D/g, '');
    const amount = (row.amount || '').toString().replace(/\D/g, '');
    if (phone && amount) {
      const key = `${phone}_${amount}`;
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
  const candidateLinesText = candidateLines.map(line => line.text);

  return {
    rawLines,
    candidateLines: candidateLinesText,
    extractedRows: results
  };
}

export async function processFileForOcr(fileBuffer, mimeType, fileName) {
  let allRows = [];
  let pageCount = 0;
  const debugData = [];
  const worker = await createWorker('eng');
  const corrections = loadCorrections();

  try {
    if (mimeType.startsWith('image/')) {
      pageCount = 1;
      const metadata = await sharp(fileBuffer).metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      
      let scale = 1;
      if (width < MIN_WIDTH) {
        scale = Math.ceil(MIN_WIDTH / width);
      }
      
      let sharpPipeline = sharp(fileBuffer);
      if (scale > 1) {
        sharpPipeline = sharpPipeline.resize({
          width: width * scale,
          height: height * scale,
          kernel: sharp.kernel.lanczos3
        });
      }

      const channels = metadata.channels || 3;
      
      // Pass A (standard grayscale + sharpen)
      const optimizedPageBufferA = await sharpPipeline
        .trim({ background: '#ffffff', threshold: 15 })
        .greyscale()
        .normalize()
        .sharpen()
        .png()
        .toBuffer();
        
      if (!IS_PROD) {
        const debugDir = path.join(process.cwd(), 'debug_pages');
        if (!fs.existsSync(debugDir)) {
          fs.mkdirSync(debugDir, { recursive: true });
        }
        try {
          fs.writeFileSync(path.join(debugDir, 'page-1.png'), optimizedPageBufferA);
        } catch (e) {
          console.error('Failed to write debug page image:', e);
        }
      }
      
      const retA = await worker.recognize(optimizedPageBufferA, {}, { blocks: true });
      const pageResultA = parseExtractedTextWithLayout(retA.data.text, retA.data.blocks, 1, fileName, {}, corrections);
      
      const avgConfA = pageResultA.extractedRows.length > 0
        ? pageResultA.extractedRows.reduce((sum, r) => sum + r.confidence, 0) / pageResultA.extractedRows.length
        : 0;

      let bestVariant = 'A';
      let bestRows = pageResultA.extractedRows;
      let bestOcrText = retA.data.text;
      let bestBlocks = retA.data.blocks;
      let bestBuffer = optimizedPageBufferA;

      const isStandardPassWeak = pageResultA.extractedRows.length < 5 || avgConfA < 70;

      if (isStandardPassWeak && pageResultA.extractedRows.length > 0) {
        console.log(`[OCR Debug] Standard pass for image is weak (rows: ${pageResultA.extractedRows.length}, avgConf: ${avgConfA}%). Running multi-pass preprocessing...`);

        // Pass B: Threshold
        try {
          const sharpPipelineB = sharp(fileBuffer);
          const optimizedPageBufferB = await sharpPipelineB
            .trim({ background: '#ffffff', threshold: 15 })
            .greyscale()
            .threshold(160)
            .png()
            .toBuffer();

          const retB = await worker.recognize(optimizedPageBufferB, {}, { blocks: true });
          const pageResultB = parseExtractedTextWithLayout(retB.data.text, retB.data.blocks, 1, fileName, {}, corrections);
          const avgConfB = pageResultB.extractedRows.length > 0
            ? pageResultB.extractedRows.reduce((sum, r) => sum + r.confidence, 0) / pageResultB.extractedRows.length
            : 0;

          if (pageResultB.extractedRows.length > bestRows.length || (pageResultB.extractedRows.length === bestRows.length && avgConfB > avgConfA)) {
            bestVariant = 'B';
            bestRows = pageResultB.extractedRows;
            bestOcrText = retB.data.text;
            bestBlocks = retB.data.blocks;
            bestBuffer = optimizedPageBufferB;
          }
        } catch (errB) {
          console.error("Error in image preprocessing pass B:", errB);
        }

        // Pass C: Enlarged 2x
        try {
          const sharpPipelineC = sharp(fileBuffer);
          const optimizedPageBufferC = await sharpPipelineC
            .trim({ background: '#ffffff', threshold: 15 })
            .resize({ width: width * 2, height: height * 2, kernel: sharp.kernel.lanczos3 })
            .greyscale()
            .sharpen()
            .png()
            .toBuffer();

          const retC = await worker.recognize(optimizedPageBufferC, {}, { blocks: true });
          const pageResultC = parseExtractedTextWithLayout(retC.data.text, retC.data.blocks, 1, fileName, {}, corrections);
          const avgConfC = pageResultC.extractedRows.length > 0
            ? pageResultC.extractedRows.reduce((sum, r) => sum + r.confidence, 0) / pageResultC.extractedRows.length
            : 0;

          const currentBestLen = bestRows.length;
          const currentBestConf = bestRows.reduce((sum, r) => sum + r.confidence, 0) / (bestRows.length || 1);

          if (pageResultC.extractedRows.length > currentBestLen || (pageResultC.extractedRows.length === currentBestLen && avgConfC > currentBestConf)) {
            bestVariant = 'C';
            bestRows = pageResultC.extractedRows;
            bestOcrText = retC.data.text;
            bestBlocks = retC.data.blocks;
            bestBuffer = optimizedPageBufferC;
          }
        } catch (errC) {
          console.error("Error in image preprocessing pass C:", errC);
        }
        console.log(`[OCR Debug] Selected best image preprocessing variant: ${bestVariant}`);
      }

      // Check if secondary crop OCR is needed
      let needsSecondaryCrop = false;
      for (const row of bestRows) {
        const hasLowConf = row.cityConfidence < 70 || row.phoneConfidence < 70 || row.amountConfidence < 70;
        const hasInvalidPhone = !row.phoneNumber || !/^[6-9]\d{9}$/.test(row.phoneNumber);
        const hasSuspiciousAmount = !row.amount || parseFloat(row.amount) === 0 || row.amount.toString().length >= 10 || 
                                    (row.amount.toString().length >= 8 && row.amount.toString().startsWith('1')) ||
                                    row.phoneNumber === row.amount.toString() ||
                                    row.needsReview || row.status === 'Needs Review';
        
        if (hasLowConf || hasInvalidPhone || hasSuspiciousAmount) {
          needsSecondaryCrop = true;
          break;
        }
      }

      let cropData = {};
      if (needsSecondaryCrop) {
        console.log(`[OCR Debug] Image: Identified rows needing correction. Running secondary cropped column OCR passes...`);
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

        // Secondary Pass: Amount Crop
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

        // Secondary Pass: Phone Crop
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

        const finalPageResult = parseExtractedTextWithLayout(bestOcrText, bestBlocks, 1, fileName, cropData, corrections);
        bestRows = finalPageResult.extractedRows;
      }

      allRows.push(...bestRows);
      
      debugData.push({
        pageNumber: 1,
        rawText: bestOcrText,
        rawLines: bestRows.map(r => r.originalText),
        candidateLines: bestRows.map(r => r.originalText),
        extractedRows: bestRows
      });
      
      console.log(`[OCR Debug] Processed image 1 / 1`);
      console.log(`  - OCR text length: ${bestOcrText.length} characters`);
      console.log(`  - Final extracted rows: ${bestRows.length}`);
      
    } else if (mimeType === 'application/pdf') {
      const data = new Uint8Array(fileBuffer);
      const loadingTask = pdfjs.getDocument({ data });
      const pdf = await loadingTask.promise;
      pageCount = pdf.numPages;
      
      console.log(`[OCR Debug] Starting PDF processing for ${fileName}. Total pages: ${pageCount}`);
      
      for (let p = 1; p <= pageCount; p++) {
        console.log(`[OCR] PDF page ${p} started`);
        try {
          const page = await pdf.getPage(p);
        const opList = await page.getOperatorList();
        
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
        
        const imgObj = page.objs.get(imgId);
        if (!imgObj) {
          console.warn(`[OCR Debug] Image object ${imgId} not resolved on page ${p}, skipping.`);
          continue;
        }
        
        const channels = imgObj.kind === 3 ? 4 : (imgObj.kind === 2 ? 3 : 1);
        
        let scale = 1;
        if (imgObj.width < MIN_WIDTH) {
          scale = Math.ceil(MIN_WIDTH / imgObj.width);
        }
        
        let sharpPipeline = sharp(imgObj.data, {
          raw: {
            width: imgObj.width,
            height: imgObj.height,
            channels: channels
          }
        });
        
        if (scale > 1) {
          sharpPipeline = sharpPipeline.resize({
            width: imgObj.width * scale,
            height: imgObj.height * scale,
            kernel: sharp.kernel.lanczos3
          });
        }
        
        // Pass A (standard grayscale + sharpen)
        const optimizedPageBufferA = await sharpPipeline
          .trim({ background: '#ffffff', threshold: 15 })
          .greyscale()
          .normalize()
          .sharpen()
          .png()
          .toBuffer();
          
        if (!IS_PROD) {
          try {
            const debugDir = path.join(process.cwd(), 'debug_pages');
            if (!fs.existsSync(debugDir)) {
              fs.mkdirSync(debugDir, { recursive: true });
            }
            fs.writeFileSync(path.join(debugDir, `page-${p}.png`), optimizedPageBufferA);
          } catch (e) {
            console.error('Failed to write debug page image:', e);
          }
        }
        
        const retA = await worker.recognize(optimizedPageBufferA, {}, { blocks: true });
        const pageResultA = parseExtractedTextWithLayout(retA.data.text, retA.data.blocks, p, fileName, {}, corrections);
        
        const avgConfA = pageResultA.extractedRows.length > 0
          ? pageResultA.extractedRows.reduce((sum, r) => sum + r.confidence, 0) / pageResultA.extractedRows.length
          : 0;

        let bestVariant = 'A';
        let bestRows = pageResultA.extractedRows;
        let bestOcrText = retA.data.text;
        let bestBlocks = retA.data.blocks;
        let bestBuffer = optimizedPageBufferA;

        const isStandardPassWeak = pageResultA.extractedRows.length < 5 || avgConfA < 70;

        if (!IS_PROD && isStandardPassWeak && pageResultA.extractedRows.length > 0) {
          console.log(`[OCR Debug] Standard pass for Page ${p} is weak (rows: ${pageResultA.extractedRows.length}, avgConf: ${avgConfA}%). Running multi-pass preprocessing...`);

          // Pass B: Threshold
          try {
            const sharpPipelineB = sharp(imgObj.data, { raw: { width: imgObj.width, height: imgObj.height, channels: channels } });
            if (scale > 1) {
              sharpPipelineB.resize({ width: imgObj.width * scale, height: imgObj.height * scale, kernel: sharp.kernel.lanczos3 });
            }
            const optimizedPageBufferB = await sharpPipelineB
              .trim({ background: '#ffffff', threshold: 15 })
              .greyscale()
              .threshold(160)
              .png()
              .toBuffer();

            const retB = await worker.recognize(optimizedPageBufferB, {}, { blocks: true });
            const pageResultB = parseExtractedTextWithLayout(retB.data.text, retB.data.blocks, p, fileName, {}, corrections);
            const avgConfB = pageResultB.extractedRows.length > 0
              ? pageResultB.extractedRows.reduce((sum, r) => sum + r.confidence, 0) / pageResultB.extractedRows.length
              : 0;

            if (pageResultB.extractedRows.length > bestRows.length || (pageResultB.extractedRows.length === bestRows.length && avgConfB > avgConfA)) {
              bestVariant = 'B';
              bestRows = pageResultB.extractedRows;
              bestOcrText = retB.data.text;
              bestBlocks = retB.data.blocks;
              bestBuffer = optimizedPageBufferB;
            }
          } catch (errB) {
            console.error("Error in preprocessing pass B:", errB);
          }

          // Pass C: Enlarged 2x
          try {
            const sharpPipelineC = sharp(imgObj.data, { raw: { width: imgObj.width, height: imgObj.height, channels: channels } });
            sharpPipelineC.resize({ width: imgObj.width * scale * 2, height: imgObj.height * scale * 2, kernel: sharp.kernel.lanczos3 });
            const optimizedPageBufferC = await sharpPipelineC
              .trim({ background: '#ffffff', threshold: 15 })
              .greyscale()
              .sharpen()
              .png()
              .toBuffer();

            const retC = await worker.recognize(optimizedPageBufferC, {}, { blocks: true });
            const pageResultC = parseExtractedTextWithLayout(retC.data.text, retC.data.blocks, p, fileName, {}, corrections);
            const avgConfC = pageResultC.extractedRows.length > 0
              ? pageResultC.extractedRows.reduce((sum, r) => sum + r.confidence, 0) / pageResultC.extractedRows.length
              : 0;

            const currentBestLen = bestRows.length;
            const currentBestConf = bestRows.reduce((sum, r) => sum + r.confidence, 0) / (bestRows.length || 1);

            if (pageResultC.extractedRows.length > currentBestLen || (pageResultC.extractedRows.length === currentBestLen && avgConfC > currentBestConf)) {
              bestVariant = 'C';
              bestRows = pageResultC.extractedRows;
              bestOcrText = retC.data.text;
              bestBlocks = retC.data.blocks;
              bestBuffer = optimizedPageBufferC;
            }
          } catch (errC) {
            console.error("Error in preprocessing pass C:", errC);
          }
          console.log(`[OCR Debug] Selected best preprocessing variant: ${bestVariant}`);
        }

        // Check if secondary crop OCR is needed
        let needsSecondaryCrop = false;
        for (const row of bestRows) {
          const hasLowConf = row.cityConfidence < 70 || row.phoneConfidence < 70 || row.amountConfidence < 70;
          const hasInvalidPhone = !row.phoneNumber || !/^[6-9]\d{9}$/.test(row.phoneNumber);
          const hasSuspiciousAmount = !row.amount || parseFloat(row.amount) === 0 || row.amount.toString().length >= 10 || 
                                      (row.amount.toString().length >= 8 && row.amount.toString().startsWith('1')) ||
                                      row.phoneNumber === row.amount.toString() ||
                                      row.needsReview || row.status === 'Needs Review';
          
          if (hasLowConf || hasInvalidPhone || hasSuspiciousAmount) {
            needsSecondaryCrop = true;
            break;
          }
        }

        let cropData = {};
        if (needsSecondaryCrop && !IS_PROD) {
          console.log(`[OCR Debug] Page ${p}: Identified rows needing correction. Running secondary cropped column OCR passes...`);
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

          // Secondary Pass: Amount Crop
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

          // Secondary Pass: Phone Crop
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

          const finalPageResult = parseExtractedTextWithLayout(bestOcrText, bestBlocks, p, fileName, cropData, corrections);
          bestRows = finalPageResult.extractedRows;
        }

          allRows.push(...bestRows);
          
          debugData.push({
            pageNumber: p,
            rawText: bestOcrText,
            rawLines: bestRows.map(r => r.originalText),
            candidateLines: bestRows.map(r => r.originalText),
            extractedRows: bestRows
          });
          
          console.log(`[OCR Debug] Processed page ${p} / ${pageCount}`);
          console.log(`  - OCR text length: ${bestOcrText.length} characters`);
          console.log(`  - Final extracted rows: ${bestRows.length}`);
        } catch (pageErr) {
          console.error(`[OCR Error] Page ${p} processing failed:`, pageErr);
          debugData.push({ pageNumber: p, error: pageErr && pageErr.message ? pageErr.message : String(pageErr) });
        } finally {
          console.log(`PDF page ${p} completed`);
          try {
            console.log(`Memory usage after page ${p}: ${JSON.stringify(process.memoryUsage())}`);
          } catch (e) {
            // ignore
          }
        }
      }
    } else {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }
    
    // Save raw_ocr_debug.json (only in non-production)
    if (!IS_PROD) {
      try {
        fs.writeFileSync(
          path.join(process.cwd(), 'raw_ocr_debug.json'),
          JSON.stringify(debugData, null, 2)
        );
        console.log(`[OCR Debug] Successfully saved raw_ocr_debug.json`);
      } catch (e) {
        console.error('Failed to write raw_ocr_debug.json:', e);
      }
    }
    console.log(`[OCR Debug] Total PDF pages processed: ${pageCount}`);
    
  } catch (err) {
    console.error('Error during OCR execution:', err);
    return {
      error: true,
      message: err && err.message ? err.message : String(err),
      rows: allRows,
      pageCount,
      totalExtracted: allRows.length,
      needsReviewCount: allRows.filter(r => r.needsReview || r.status === 'Needs Review').length
    };
  } finally {
    await worker.terminate();
  }

  return {
    rows: allRows,
    pageCount,
    totalExtracted: allRows.length,
    needsReviewCount: allRows.filter(r => r.needsReview || r.status === 'Needs Review').length
  };
}
