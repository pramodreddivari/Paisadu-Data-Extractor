import fs from 'fs';
import path from 'path';

const debugJsonPath = path.join(process.cwd(), 'raw_ocr_debug.json');
const debugData = JSON.parse(fs.readFileSync(debugJsonPath, 'utf8'));

const grouped = {};
debugData.forEach(pageInfo => {
  grouped[pageInfo.pageNumber] = pageInfo.extractedRows;
});

const targets = [
  { p: 1, r: 8, desc: "Phone 0036375477 -> 9036375477" },
  { p: 1, r: 15, desc: "Phone Needs Entry -> 8825945025 (or closest OCR)" },
  { p: 1, r: 16, desc: "Amount 0 -> 100000" },
  { p: 1, r: 18, desc: "Amount 13028000 -> 5028000 (extracted as OCR 13028000, Needs Review)" },
  { p: 1, r: 22, desc: "Phone 0786252873 -> 9786252873" },
  { p: 2, r: 1, desc: "Amount 0 -> 50000" },
  { p: 2, r: 45, desc: "Amount phone/mobile -> 1000000" },
  { p: 2, r: 46, desc: "Phone 5222340000 -> 9340420522" },
  { p: 3, r: 41, desc: "City REDDY -> SANGA REDDY" },
  { p: 3, r: 42, desc: "City REDDY -> SANGA REDDY" },
  { p: 3, r: 49, desc: "Phone 0493003922 -> 9493005922 (or closest OCR)" },
  { p: 3, r: 50, desc: "Phone 0000223443 -> 9000223443 (keep as is if no evidence, Needs Review)" },
  { p: 3, r: 51, desc: "Amount 0 -> 1500000" },
  { p: 4, r: 5, desc: "Amount 13500000 -> 3500000 (OCR is 13500000, Needs Review)" },
  { p: 4, r: 22, desc: "Amount 11813500 -> 1813500 (OCR is 11813500, Needs Review)" }
];

console.log("--- SPECIFIC ROWS VERIFICATION ---");
targets.forEach(t => {
  const row = grouped[t.p] ? grouped[t.p][t.r - 1] : null;
  if (row) {
    console.log(`Page ${t.p} Row ${t.r} (${t.desc}):`);
    console.log(`  Extracted City:   ${row.city}`);
    console.log(`  Extracted Phone:  ${row.phoneNumber}`);
    console.log(`  Extracted Amount: ${row.amount}`);
    console.log(`  Row Status:       ${row.status}`);
    console.log(`  Review Reason:    ${row.reviewReason || 'None'}`);
  } else {
    console.log(`Page ${t.p} Row ${t.r} NOT FOUND`);
  }
});
