import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";
import type { SheetWord } from "@/lib/ref-sheet-layout";

interface OcrWord {
  text?: string;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

interface OcrBlock {
  paragraphs?: Array<{
    lines?: Array<{ words?: OcrWord[] | null }> | null;
  }> | null;
}

const globalForOcr = globalThis as unknown as {
  refSheetWorker?: Promise<Worker>;
};

function workerPath(): string {
  return path.join(
    process.cwd(),
    "node_modules/tesseract.js/src/worker-script/node/index.js",
  );
}

function getWorker(): Promise<Worker> {
  if (!globalForOcr.refSheetWorker) {
    globalForOcr.refSheetWorker = createWorker("eng", 1, {
      workerPath: workerPath(),
      cachePath: path.join(process.cwd(), "data", "tesseract"),
    }).catch((error: unknown) => {
      globalForOcr.refSheetWorker = undefined;
      throw error;
    });
  }

  return globalForOcr.refSheetWorker;
}

export interface RecognizedRefSheet {
  text: string;
  words: SheetWord[];
}

function collectWords(blocks: OcrBlock[] | null): SheetWord[] {
  if (!blocks) {
    return [];
  }

  const words: SheetWord[] = [];

  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          if (!word.text?.trim() || !word.bbox) {
            continue;
          }

          words.push({
            text: word.text,
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1,
          });
        }
      }
    }
  }

  return words;
}

async function recognize(image: Buffer, blocks: boolean): Promise<RecognizedRefSheet> {
  const worker = await getWorker();

  try {
    const result = await worker.recognize(
      image,
      {},
      blocks ? { text: true, blocks: true } : { text: true },
    );

    return {
      text: result.data.text,
      words: blocks ? collectWords(result.data.blocks as OcrBlock[] | null) : [],
    };
  } catch (error) {
    globalForOcr.refSheetWorker = undefined;
    await worker.terminate().catch(() => undefined);
    throw error;
  }
}

export async function recognizeRefSheet(image: Buffer): Promise<string> {
  const page = await recognize(image, false);

  return page.text;
}

export async function recognizeRefSheetPage(image: Buffer): Promise<RecognizedRefSheet> {
  return recognize(image, true);
}
