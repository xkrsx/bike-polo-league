import sharp from "sharp";
import type { SheetRegion } from "@/lib/ref-sheet-layout";
import { imageTypeForUpload, MAX_REF_SHEET_BYTES } from "@/lib/ref-sheet-storage";

export class RefSheetImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefSheetImageError";
  }
}

function isHeic(mimeType: string): boolean {
  return mimeType === "image/heic" || mimeType === "image/heif";
}

async function sharpJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "none", pages: 1 })
    .rotate()
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function heicJpeg(input: Buffer): Promise<Buffer> {
  const { default: convert } = await import("heic-convert");
  const output = await convert({
    buffer: input,
    format: "JPEG",
    quality: 0.9,
  });

  return Buffer.from(output);
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

export async function bufferToJpeg(input: Buffer, mimeType: string): Promise<Buffer> {
  try {
    const jpeg = await sharpJpeg(input);

    if (jpeg.length > 0 && isJpeg(jpeg)) {
      return jpeg;
    }
  } catch (error) {
    console.error(error);

    if (!isHeic(mimeType)) {
      throw new RefSheetImageError("Could not read this photo. Export it as JPG and try again.");
    }
  }

  if (!isHeic(mimeType)) {
    throw new RefSheetImageError("Could not read this photo. Export it as JPG and try again.");
  }

  try {
    return await heicJpeg(input);
  } catch (error) {
    console.error(error);
    throw new RefSheetImageError("Could not read this HEIC photo. Export it as JPG and try again.");
  }
}

export interface RefSheetCrop {
  region: SheetRegion;
  jpeg: Buffer;
}

const GUTTER_MIN_CONTRAST = 18;
const GUTTER_MIN_BRIGHTNESS = 160;

function axisMeans(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  axis: "x" | "y",
): number[] {
  const length = axis === "x" ? width : height;
  const means = new Array<number>(length).fill(0);
  const stride = Math.max(1, channels);

  if (axis === "x") {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;

      for (let y = 0; y < height; y += 1) {
        sum += data[(y * width + x) * stride] ?? 0;
      }

      means[x] = sum / height;
    }

    return means;
  }

  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    const offset = y * width * stride;

    for (let x = 0; x < width; x += 1) {
      sum += data[offset + x * stride] ?? 0;
    }

    means[y] = sum / width;
  }

  return means;
}

function findBrightGutter(means: number[]): number | null {
  const count = means.length;
  const from = Math.floor(count * 0.32);
  const to = Math.ceil(count * 0.68);
  const window = Math.max(3, Math.round(count * 0.03));
  let bestCenter = -1;
  let bestContrast = 0;

  for (let start = from; start + window <= to; start += 1) {
    let bright = 0;

    for (let index = start; index < start + window; index += 1) {
      bright += means[index] ?? 0;
    }

    bright /= window;

    const sideWidth = window * 3;
    const leftFrom = Math.max(0, start - sideWidth);
    const rightTo = Math.min(count, start + window + sideWidth);
    let side = 0;
    let sideCount = 0;

    for (let index = leftFrom; index < start; index += 1) {
      side += means[index] ?? 0;
      sideCount += 1;
    }

    for (let index = start + window; index < rightTo; index += 1) {
      side += means[index] ?? 0;
      sideCount += 1;
    }

    if (sideCount === 0) {
      continue;
    }

    const contrast = bright - side / sideCount;

    if (bright >= GUTTER_MIN_BRIGHTNESS && contrast > bestContrast) {
      bestContrast = contrast;
      bestCenter = start + Math.floor(window / 2);
    }
  }

  if (bestCenter < 0 || bestContrast < GUTTER_MIN_CONTRAST) {
    return null;
  }

  return bestCenter;
}

/**
 * A full ref sheet is four cards separated by a light gutter.
 * Returns null when the photo is one card, so the caller sends it whole
 * instead of slicing names in half.
 */
export async function cropRefSheetQuadrants(jpeg: Buffer): Promise<RefSheetCrop[] | null> {
  const base = await sharp(jpeg, { failOn: "none" }).rotate().jpeg({ quality: 90 }).toBuffer();
  const meta = await sharp(base).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (width < 240 || height < 240) {
    return null;
  }

  const sampleWidth = Math.min(width, 720);
  const { data, info } = await sharp(base)
    .resize({ width: sampleWidth, withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gutterX = findBrightGutter(axisMeans(data, info.width, info.height, info.channels, "x"));
  const gutterY = findBrightGutter(axisMeans(data, info.width, info.height, info.channels, "y"));

  if (gutterX === null || gutterY === null) {
    return null;
  }

  const splitX = Math.round((gutterX / info.width) * width);
  const splitY = Math.round((gutterY / info.height) * height);

  if (splitX < width * 0.2 || splitX > width * 0.8 || splitY < height * 0.2 || splitY > height * 0.8) {
    return null;
  }

  const boxes: Array<{ region: SheetRegion; left: number; top: number; width: number; height: number }> =
    [
      { region: "top-left", left: 0, top: 0, width: splitX, height: splitY },
      { region: "bottom-left", left: 0, top: splitY, width: splitX, height: height - splitY },
      { region: "top-right", left: splitX, top: 0, width: width - splitX, height: splitY },
      {
        region: "bottom-right",
        left: splitX,
        top: splitY,
        width: width - splitX,
        height: height - splitY,
      },
    ];

  return Promise.all(
    boxes.map(async (box): Promise<RefSheetCrop> => ({
      region: box.region,
      jpeg: await sharp(base).extract(box).jpeg({ quality: 85 }).toBuffer(),
    })),
  );
}

export async function refSheetFileToJpeg(file: File): Promise<Buffer> {
  const mimeType = imageTypeForUpload(file);

  if (!mimeType) {
    throw new RefSheetImageError("Upload a HEIC, PNG, JPG, WEBP, or GIF photo of the ref sheet.");
  }

  if (file.size <= 0) {
    throw new RefSheetImageError("Upload a photo of the ref sheet.");
  }

  if (file.size > MAX_REF_SHEET_BYTES) {
    throw new RefSheetImageError("Ref sheet photos must be 8 MB or smaller.");
  }

  return bufferToJpeg(Buffer.from(await file.arrayBuffer()), mimeType);
}
