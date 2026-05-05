import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { invokeWasm } from "./wasm-loader.js";

let pdfRuntimePromise;

async function getPdfRuntime() {
  if (pdfRuntimePromise) {
    return pdfRuntimePromise;
  }

  pdfRuntimePromise = (async () => {
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();

  return pdfRuntimePromise;
}

function mimeFromFormat(format) {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function extFromFormat(format) {
  if (format === "jpg") return "jpeg";
  return format;
}

export async function mergePdfs(entries, onProgress = () => {}) {
  const out = await PDFDocument.create();

  for (let i = 0; i < entries.length; i += 1) {
    const sourceBytes = await entries[i].file.arrayBuffer();
    const source = await PDFDocument.load(sourceBytes);
    const pageIndices = source.getPageIndices();
    const pages = await out.copyPages(source, pageIndices);
    pages.forEach((page) => out.addPage(page));
    onProgress(Math.round(((i + 1) / entries.length) * 100));
  }

  const mergedBytes = await out.save();
  return new Blob([mergedBytes], { type: "application/pdf" });
}

function buildPerPageRanges(pageCount) {
  return Array.from({ length: pageCount }, (_, i) => [i, i]);
}

function parseCustomRanges(selection, pageCount) {
  if (!selection || !selection.trim()) {
    throw new Error("Enter page selections like 1-2,3,4-5.");
  }

  const tokens = selection
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!tokens.length) {
    throw new Error("Enter page selections like 1-2,3,4-5.");
  }

  return tokens.map((token) => {
    const match = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) {
      throw new Error(`Invalid page selection \"${token}\". Use numbers or ranges like 2-4.`);
    }

    let start = Number.parseInt(match[1], 10);
    let end = match[2] ? Number.parseInt(match[2], 10) : start;

    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new Error(`Invalid page selection \"${token}\".`);
    }

    if (start > end) {
      [start, end] = [end, start];
    }

    if (start < 1 || end > pageCount) {
      throw new Error(`Page selection \"${token}\" is out of range. This PDF has ${pageCount} pages.`);
    }

    return [start - 1, end - 1];
  });
}

function buildAllPagesRange(pageCount) {
  if (pageCount < 1) return [];
  return [[0, pageCount - 1]];
}

function expandRangesToIndices(ranges, pageCount, { dedupe = false } = {}) {
  const indices = [];
  const seen = new Set();

  for (const [start, end] of ranges) {
    for (let i = start; i <= end && i < pageCount; i += 1) {
      if (dedupe) {
        if (seen.has(i)) continue;
        seen.add(i);
      }
      indices.push(i);
    }
  }

  return indices;
}

function parseSelectionOrAll(selection, pageCount) {
  if (!selection || !selection.trim()) {
    return buildAllPagesRange(pageCount);
  }
  return parseCustomRanges(selection, pageCount);
}

export async function getPdfPageCount(entry) {
  const bytes = await entry.file.arrayBuffer();
  const source = await PDFDocument.load(bytes);
  return source.getPageCount();
}

export function summarizeCustomSplitSelection(selection, pageCount) {
  const ranges = parseCustomRanges(selection, pageCount);
  const pages = ranges.reduce((total, [start, end]) => total + (end - start + 1), 0);
  return {
    groups: ranges.length,
    pages
  };
}

export function buildAllPagesSelection(pageCount) {
  if (!Number.isFinite(pageCount) || pageCount < 1) return "";
  return Array.from({ length: pageCount }, (_, i) => `${i + 1}`).join(",");
}

export async function splitPdf(entry, options = {}, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();
  const mode = options.mode === "custom" ? "custom" : "per-page";
  const ranges = mode === "custom"
    ? parseCustomRanges(options.selection ?? "", pageCount)
    : buildPerPageRanges(pageCount);

  if (!ranges.length) {
    throw new Error("No pages selected for splitting.");
  }

  const results = [];

  for (let i = 0; i < ranges.length; i += 1) {
    const [start, end] = ranges[i];
    const target = await PDFDocument.create();
    const indices = [];
    for (let p = start; p <= end && p < source.getPageCount(); p += 1) {
      indices.push(p);
    }
    const pages = await target.copyPages(source, indices);
    pages.forEach((page) => target.addPage(page));
    results.push(new Blob([await target.save()], { type: "application/pdf" }));
    onProgress(Math.round(((i + 1) / ranges.length) * 100));
  }

  return results;
}

export async function extractPdfPages(entry, selection, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();
  const ranges = parseCustomRanges(selection ?? "", pageCount);
  const indices = expandRangesToIndices(ranges, pageCount, { dedupe: false });

  if (indices.length < 1) {
    throw new Error("No pages selected for extraction.");
  }

  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, indices);
  pages.forEach((page, i) => {
    target.addPage(page);
    onProgress(Math.round(((i + 1) / pages.length) * 100));
  });

  return new Blob([await target.save()], { type: "application/pdf" });
}

export async function removePdfPages(entry, selection, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();
  const ranges = parseCustomRanges(selection ?? "", pageCount);
  const removeSet = new Set(expandRangesToIndices(ranges, pageCount, { dedupe: true }));
  const keepIndices = source.getPageIndices().filter((index) => !removeSet.has(index));

  if (keepIndices.length < 1) {
    throw new Error("Cannot remove all pages. Keep at least one page.");
  }

  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, keepIndices);
  pages.forEach((page, i) => {
    target.addPage(page);
    onProgress(Math.round(((i + 1) / pages.length) * 100));
  });

  return new Blob([await target.save()], { type: "application/pdf" });
}

export async function rotatePdfPages(entry, selection, angle = 90, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const doc = await PDFDocument.load(bytes);
  const pageCount = doc.getPageCount();
  const ranges = parseSelectionOrAll(selection ?? "", pageCount);
  const indices = expandRangesToIndices(ranges, pageCount, { dedupe: true });

  if (indices.length < 1) {
    throw new Error("No pages selected for rotation.");
  }

  const normalizedAngle = Number.parseInt(angle, 10);
  if (![90, 180, 270].includes(normalizedAngle)) {
    throw new Error("Rotation angle must be 90, 180, or 270.");
  }

  for (let i = 0; i < indices.length; i += 1) {
    const page = doc.getPage(indices[i]);
    const current = page.getRotation()?.angle ?? 0;
    page.setRotation(degrees((current + normalizedAngle) % 360));
    onProgress(Math.round(((i + 1) / indices.length) * 100));
  }

  return new Blob([await doc.save()], { type: "application/pdf" });
}

function numberingPositionCoords(page, textWidth, fontSize, position, margin) {
  const width = page.getWidth();
  const height = page.getHeight();

  const leftX = margin;
  const centerX = Math.max(margin, (width - textWidth) / 2);
  const rightX = Math.max(margin, width - textWidth - margin);
  const topY = Math.max(margin, height - fontSize - margin);
  const middleY = Math.max(margin, (height - fontSize) / 2);
  const bottomY = margin;

  switch (position) {
    case "top-left":
      return { x: leftX, y: topY };
    case "top-right":
      return { x: rightX, y: topY };
    case "middle-center":
      return { x: centerX, y: middleY };
    case "bottom-left":
      return { x: leftX, y: bottomY };
    case "bottom-right":
      return { x: rightX, y: bottomY };
    case "bottom-center":
    default:
      return { x: centerX, y: bottomY };
  }
}

export async function addPdfPageNumbers(entry, options = {}, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const doc = await PDFDocument.load(bytes);
  const pageCount = doc.getPageCount();

  const selection = options.selection ?? "";
  const ranges = parseSelectionOrAll(selection, pageCount);
  const indices = expandRangesToIndices(ranges, pageCount, { dedupe: true });
  if (indices.length < 1) {
    throw new Error("No pages selected for numbering.");
  }

  const startNumber = Number.parseInt(options.startNumber ?? "1", 10);
  if (!Number.isFinite(startNumber) || startNumber < 1) {
    throw new Error("Start number must be 1 or greater.");
  }

  const fontSize = Number.parseInt(options.fontSize ?? "12", 10);
  const margin = Number.parseInt(options.margin ?? "20", 10);
  const position = options.position ?? "bottom-center";
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < indices.length; i += 1) {
    const page = doc.getPage(indices[i]);
    const label = `${startNumber + i}`;
    const textWidth = font.widthOfTextAtSize(label, fontSize);
    const coords = numberingPositionCoords(page, textWidth, fontSize, position, margin);

    page.drawText(label, {
      x: coords.x,
      y: coords.y,
      size: fontSize,
      font,
      color: rgb(0.16, 0.16, 0.16)
    });

    onProgress(Math.round(((i + 1) / indices.length) * 100));
  }

  return new Blob([await doc.save()], { type: "application/pdf" });
}

export async function compressPdf(entry, _quality = 0.75, onProgress = () => {}) {
  onProgress(30);
  const bytes = await entry.file.arrayBuffer();

  const wasmCompressed = await invokeWasm("pdf", "wasmCompressPDF", new Uint8Array(bytes), Math.round(_quality * 100));
  if (wasmCompressed instanceof Uint8Array) {
    onProgress(100);
    return new Blob([wasmCompressed], { type: "application/pdf" });
  }

  const doc = await PDFDocument.load(bytes);
  onProgress(70);

  // Placeholder strategy: re-save document for structural cleanup.
  const compressed = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  onProgress(100);
  return new Blob([compressed], { type: "application/pdf" });
}

export async function pdfToImages(entry, format = "png", onProgress = () => {}) {
  const { getDocument } = await getPdfRuntime();
  const bytes = await entry.file.arrayBuffer();
  const loadingTask = getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const results = [];
  const ext = extFromFormat(format);
  const mime = mimeFromFormat(ext);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.9));
    if (blob) {
      results.push({
        name: `${entry.name.replace(/\.pdf$/i, "")}-page-${pageNum}.${ext}`,
        blob
      });
    }
    onProgress(Math.round((pageNum / pdf.numPages) * 100));
  }

  return results;
}

export async function renderPdfPreviewPage(entry, options = {}) {
  const { getDocument } = await getPdfRuntime();
  const bytes = await entry.file.arrayBuffer();
  const loadingTask = getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const requestedPage = Number.parseInt(options.page ?? "1", 10);
  const pageNum = Math.max(1, Math.min(totalPages, Number.isFinite(requestedPage) ? requestedPage : 1));
  const scale = Number.isFinite(options.scale) ? options.scale : 1.2;

  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return {
    page: pageNum,
    totalPages,
    width: canvas.width,
    height: canvas.height,
    dataUrl: canvas.toDataURL("image/png")
  };
}

export async function reorderPdfPages(entry, orderedPages, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();

  if (!Array.isArray(orderedPages) || orderedPages.length !== pageCount) {
    throw new Error("Page order must include every page exactly once.");
  }

  const indices = orderedPages.map((pageNum) => {
    const parsed = Number.parseInt(pageNum, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > pageCount) {
      throw new Error(`Invalid page number in order: ${pageNum}.`);
    }
    return parsed - 1;
  });

  const unique = new Set(indices);
  if (unique.size !== pageCount) {
    throw new Error("Page order must not contain duplicates.");
  }

  const out = await PDFDocument.create();
  const pages = await out.copyPages(source, indices);
  pages.forEach((page, i) => {
    out.addPage(page);
    onProgress(Math.round(((i + 1) / pages.length) * 100));
  });

  return new Blob([await out.save()], { type: "application/pdf" });
}

// ---------------------------------------------------------------------------
// PDF Unlocker
// ---------------------------------------------------------------------------

/**
 * Attempt to unlock / remove restrictions from a PDF.
 *
 * Strategy:
 *  1. Try pdf-lib load → if it succeeds the PDF has no user-password (only
 *     owner restrictions at most).  Re-saving strips the encryption metadata.
 *  2. If pdf-lib throws (user-password protected), fall through to pdfjs which
 *     can decrypt with a supplied password.  Each page is rendered to Canvas
 *     and embedded as a PNG image in a new, unrestricted pdf-lib PDF.
 *
 * @param {import("../js/detect.js").EnrichedFile} entry
 * @param {string} [password=""]  User password (leave empty to try without)
 * @param {(n: number) => void}   [onProgress]
 * @returns {Promise<Blob>}  Unlocked PDF blob
 */
export async function unlockPdf(entry, password = "", onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();

  // ── Strategy 1: pdf-lib (owner-restricted or unprotected) ──────────────
  try {
    const doc = await PDFDocument.load(bytes);
    onProgress(90);
    const out = await doc.save();
    onProgress(100);
    return new Blob([out], { type: "application/pdf" });
  } catch (e) {
    // If pdf-lib fails for any reason other than password protection,
    // still try the pdfjs path, which is more permissive.
  }

  // ── Strategy 2: pdfjs with password → render → re-create ───────────────
  const { getDocument } = await getPdfRuntime();
  onProgress(5);

  const loadOptions = { data: new Uint8Array(bytes) };
  if (password) loadOptions.password = password;

  let pdf;
  try {
    pdf = await getDocument(loadOptions).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") {
      if (!password) {
        throw Object.assign(new Error("This PDF is password-protected. Enter the password to unlock it."), { needsPassword: true });
      }
      throw new Error("Incorrect password. Please try again.");
    }
    throw new Error(`Could not open PDF: ${e?.message ?? e}`);
  }

  const newDoc = await PDFDocument.create();

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress(Math.round(5 + (pageNum / pdf.numPages) * 85));

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const pngDataUrl = canvas.toDataURL("image/png");
    const pngResponse = await fetch(pngDataUrl);
    const pngBytes = await pngResponse.arrayBuffer();
    const pngImage = await newDoc.embedPng(pngBytes);

    // Logical page size = half of the 2× canvas (original viewport)
    const logW = viewport.width / 2;
    const logH = viewport.height / 2;
    const newPage = newDoc.addPage([logW, logH]);
    newPage.drawImage(pngImage, { x: 0, y: 0, width: logW, height: logH });
  }

  onProgress(95);
  const out = await newDoc.save();
  onProgress(100);
  return new Blob([out], { type: "application/pdf" });
}
