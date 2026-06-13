import { createWorker } from 'tesseract.js';
import fs from 'fs';
import path from 'path';

async function test() {
  const worker = await createWorker('eng');
  try {
    const imgPath = path.join(process.cwd(), 'debug_pages/page-1.png');
    console.log("Recognizing...");
    const ret = await worker.recognize(imgPath, {}, { blocks: true });
    
    console.log("Analyzing line-by-line word coords...");
    const lines = [];
    if (ret.data.blocks) {
      for (const block of ret.data.blocks) {
        if (block.paragraphs) {
          for (const para of block.paragraphs) {
            if (para.lines) {
              for (const line of para.lines) {
                if (/PINCODE/i.test(line.text)) {
                  lines.push(line);
                }
              }
            }
          }
        }
      }
    }
    
    console.log(`Found ${lines.length} candidate lines.`);
    lines.forEach((line, lineIdx) => {
      const words = line.words || [];
      console.log(`Line ${lineIdx + 1}:`);
      console.log(`  Full Text: ${line.text.trim()}`);
      words.forEach((w, wIdx) => {
        // If the word contains only numbers or matches typical amount (e.g. including '|' or commas or Rs/₹)
        const clean = w.text.replace(/[^0-9]/g, '');
        if (clean.length >= 4) {
          console.log(`    Word [${wIdx}]: "${w.text}" (bbox: x0=${w.bbox.x0}, x1=${w.bbox.x1}, y0=${w.bbox.y0}, y1=${w.bbox.y1})`);
        }
      });
    });
  } catch (e) {
    console.error(e);
  } finally {
    await worker.terminate();
  }
}

test();
