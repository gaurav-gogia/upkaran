import { PDFDocument } from "pdf-lib";
import DjVuDocument from "djvujs-dist/library/src/DjVuDocument.js";
import IWImageWriter from "djvujs-dist/library/src/iw44/IWImageWriter.js";

if (typeof globalThis.Exception !== "function") {
  globalThis.Exception = class Exception extends Error {
    constructor(message = "") {
      super(message);
      this.name = "Exception";
    }
  };
}

let pdfRuntimePromise;

async function getPdfRuntime() {
  if (pdfRuntimePromise) return pdfRuntimePromise;

  pdfRuntimePromise = (async () => {
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();

  return pdfRuntimePromise;
}

function fileStem(name = "file") {
  return `${name}`.replace(/\.[^/.]+$/, "") || "file";
}

function extFromFormat(format = "png") {
  return format === "jpg" ? "jpeg" : format;
}

function mimeFromFormat(format = "png") {
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function toProgress(progress) {
  const n = Number(progress);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function isZemitError(error) {
  return /ZPEncoder::zemit\(\) error/i.test(error?.message || "");
}

function resizeImageData(imageData, maxSide = null) {
  if (!maxSide || maxSide <= 0) {
    return imageData;
  }

  const width = imageData.width;
  const height = imageData.height;
  const largest = Math.max(width, height);
  if (largest <= maxSide) {
    return imageData;
  }

  const ratio = maxSide / largest;
  const targetWidth = Math.max(1, Math.floor(width * ratio));
  const targetHeight = Math.max(1, Math.floor(height * ratio));

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
  if (!srcCtx) return imageData;
  srcCtx.putImageData(imageData, 0, 0);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = targetWidth;
  outCanvas.height = targetHeight;
  const outCtx = outCanvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
  if (!outCtx) return imageData;
  outCtx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);
  return outCtx.getImageData(0, 0, targetWidth, targetHeight);
}

function createDjvuWriter(slices = 90) {
  const writer = new IWImageWriter(slices, 0, 0);
  writer.startMultiPageDocument();
  return writer;
}

async function imageBlobToImageData(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
  if (!ctx) {
    bitmap.close();
    throw new Error("Unable to prepare image canvas.");
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function imageDataToBlob(imageData, format = "png") {
  const ext = extFromFormat(format);
  const mime = mimeFromFormat(ext);
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;

  const ctx = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
  if (!ctx) {
    throw new Error("Unable to prepare image output canvas.");
  }

  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.92));
  if (!blob) {
    throw new Error("Failed to encode image output.");
  }
  return blob;
}

async function imageEntryToImageData(entry) {
  return imageBlobToImageData(entry.file);
}

export async function imagesToDjvu(entries, onProgress = () => {}) {
  if (!Array.isArray(entries) || entries.length < 1) {
    throw new Error("Add one or more images to convert to DjVu.");
  }

  const sourceImages = [];
  for (let i = 0; i < entries.length; i += 1) {
    sourceImages.push(await imageEntryToImageData(entries[i]));
  }

  const profiles = [
    { slices: 90, maxSide: null },
    { slices: 64, maxSide: 3200 },
    { slices: 48, maxSide: 2400 },
  ];

  let lastError = null;
  for (const profile of profiles) {
    try {
      const writer = createDjvuWriter(profile.slices);
      for (let i = 0; i < sourceImages.length; i += 1) {
        const pageImage = resizeImageData(sourceImages[i], profile.maxSide);
        writer.addPageToDocument(pageImage);
        onProgress(toProgress(((i + 1) / sourceImages.length) * 100));
      }

      const buffer = writer.endMultiPageDocument();
      onProgress(100);
      return new Blob([buffer], { type: "image/vnd.djvu" });
    } catch (error) {
      lastError = error;
      if (!isZemitError(error)) {
        throw error;
      }
    }
  }

  throw new Error(lastError?.message || "DjVu encoding failed after fallback attempts.");
}

export async function djvuToImages(entry, format = "png", onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const doc = new DjVuDocument(bytes);
  const pageCount = doc.getPagesQuantity();
  const ext = extFromFormat(format);
  const outputs = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const imageData = page.getImageData(true);
    const blob = await imageDataToBlob(imageData, ext);
    outputs.push({
      name: `${fileStem(entry.name)}-page-${pageNum}.${ext}`,
      blob
    });

    onProgress(toProgress((pageNum / pageCount) * 100));
  }

  return outputs;
}

export async function djvuToPdf(entry, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const doc = new DjVuDocument(bytes);
  const pageCount = doc.getPagesQuantity();
  const out = await PDFDocument.create();

  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const imageData = page.getImageData(true);
    const pngBlob = await imageDataToBlob(imageData, "png");
    const pngBytes = await pngBlob.arrayBuffer();
    const embedded = await out.embedPng(pngBytes);
    const pdfPage = out.addPage([embedded.width, embedded.height]);
    pdfPage.drawImage(embedded, {
      x: 0,
      y: 0,
      width: embedded.width,
      height: embedded.height
    });

    onProgress(toProgress((pageNum / pageCount) * 100));
  }

  const outBytes = await out.save();
  onProgress(100);
  return new Blob([outBytes], { type: "application/pdf" });
}

export async function pdfToDjvu(entry, onProgress = () => {}) {
  const { getDocument } = await getPdfRuntime();
  const bytes = await entry.file.arrayBuffer();

  const profiles = [
    { scale: 1.8, slices: 90, maxSide: null },
    { scale: 1.4, slices: 64, maxSide: 3200 },
    { scale: 1.1, slices: 48, maxSide: 2400 },
  ];

  let lastError = null;

  for (const profile of profiles) {
    try {
      const loadingTask = getDocument({ data: bytes });
      const pdf = await loadingTask.promise;
      const writer = createDjvuWriter(profile.slices);

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: profile.scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const ctx = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
        if (!ctx) {
          throw new Error("Unable to prepare PDF render canvas.");
        }

        await page.render({ canvasContext: ctx, viewport }).promise;
        const imageData = resizeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), profile.maxSide);
        writer.addPageToDocument(imageData);
        onProgress(toProgress((pageNum / pdf.numPages) * 100));
      }

      const buffer = writer.endMultiPageDocument();
      const djvuBlob = new Blob([buffer], { type: "image/vnd.djvu" });
      onProgress(100);
      return djvuBlob;
    } catch (error) {
      lastError = error;
      if (!isZemitError(error)) {
        throw error;
      }
    }
  }

  throw new Error(lastError?.message || "PDF to DjVu conversion failed after fallback attempts.");
}
