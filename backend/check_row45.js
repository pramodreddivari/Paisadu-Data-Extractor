import { createWorker } from 'tesseract.js';
import fs from 'fs';
import path from 'path';

async function test() {
  const worker = await createWorker('eng');
  try {
    const imgPath = path.join(process.cwd(), 'debug_pages/page-2.png');
    const ret = await worker.recognize(imgPath, {}, { blocks: true });
    
    let line45 = null;
    let count = 0;
    if (ret.data.blocks) {
      for (const block of ret.data.blocks) {
        if (block.paragraphs) {
          for (const para of block.paragraphs) {
            if (para.lines) {
              for (const line of para.lines) {
                if (/PINCODE/i.test(line.text)) {
                  count++;
                  if (count === 45) {
                    line45 = line;
                    break;
                  }
                }
              }
            }
          }
        }
      }
    }
    
    if (line45) {
      console.log("Line 45 text:", line45.text.trim());
      console.log("Line 45 bbox:", line45.bbox);
      console.log("Line 45 words:");
      line45.words.forEach((w, idx) => {
        console.log(`  Word [${idx}] "${w.text}" (x0=${w.bbox.x0}, x1=${w.bbox.x1})`);
      });
    } else {
      console.log("Line 45 not found. Total candidate lines:", count);
    }
  } catch (e) {
    console.error(e);
  } finally {
    await worker.terminate();
  }
}

test();
