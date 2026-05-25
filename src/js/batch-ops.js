import { compressImage } from "./image-tools.js";
import { compressPdf } from "./pdf-tools.js";
import { pdfToImages } from "./pdf-tools.js";
import { pdfToDjvu, imagesToDjvu, djvuToPdf, djvuToImages } from "./djvu-tools.js";

export const BATCH_OPERATION_IDS = {
  IMAGE_COMPRESS: "image_compress",
  IMAGE_TO_DJVU: "image_to_djvu",
  PDF_COMPRESS: "pdf_compress",
  PDF_TO_IMAGES: "pdf_to_images",
  PDF_TO_DJVU: "pdf_to_djvu",
  DJVU_TO_PDF: "djvu_to_pdf",
  DJVU_TO_IMAGES: "djvu_to_images",
};

function toSafeProgress(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function fileStem(name = "file") {
  return `${name}`.replace(/\.[^/.]+$/, "") || "file";
}

function extFromMime(type = "") {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  if (type === "image/avif") return "avif";
  if (type === "image/png") return "png";
  if (type === "application/pdf") return "pdf";
  if (type === "image/vnd.djvu" || type === "image/djvu" || type === "application/vnd.djvu" || type === "application/x-djvu") return "djvu";
  return "bin";
}

function buildOutputName(entry, suffix, blob) {
  const stem = fileStem(entry?.name || "file");
  const ext = extFromMime(blob?.type || "");
  return `${stem}-${suffix}.${ext}`;
}

function updateOverallProgress(index, total, fileProgress, onProgress) {
  const completedFiles = Math.max(0, index);
  const boundedFileProgress = toSafeProgress(fileProgress);
  const weighted = ((completedFiles + boundedFileProgress / 100) / Math.max(1, total)) * 100;
  onProgress(toSafeProgress(weighted));
}

async function runImageCompressBatch(entries, options) {
  const {
    imageMode = "balanced",
    onProgress = () => {},
    onItemUpdate = () => {},
  } = options;

  const outputs = [];
  const items = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    onItemUpdate({ id: entry.id, status: "running", index: i });

    try {
      const blob = await compressImage(entry, { mode: imageMode });
      const output = {
        name: buildOutputName(entry, "batch-compressed", blob),
        blob,
      };
      outputs.push(output);
      items.push({ id: entry.id, status: "success", outputName: output.name });
      onItemUpdate({ id: entry.id, status: "success", outputName: output.name, index: i });
    } catch (error) {
      const message = error?.message || "Image compression failed";
      items.push({ id: entry.id, status: "error", error: message });
      onItemUpdate({ id: entry.id, status: "error", error: message, index: i });
    }

    updateOverallProgress(i + 1, entries.length, 0, onProgress);
  }

  return { outputs, items };
}

async function runPdfCompressBatch(entries, options) {
  const {
    pdfQuality = 0.75,
    onProgress = () => {},
    onItemUpdate = () => {},
  } = options;

  const outputs = [];
  const items = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    onItemUpdate({ id: entry.id, status: "running", index: i });

    try {
      const blob = await compressPdf(entry, pdfQuality, (fileProgress) => {
        updateOverallProgress(i, entries.length, fileProgress, onProgress);
      });

      const output = {
        name: buildOutputName(entry, "batch-compressed", blob),
        blob,
      };
      outputs.push(output);
      items.push({ id: entry.id, status: "success", outputName: output.name });
      onItemUpdate({ id: entry.id, status: "success", outputName: output.name, index: i });
    } catch (error) {
      const message = error?.message || "PDF compression failed";
      items.push({ id: entry.id, status: "error", error: message });
      onItemUpdate({ id: entry.id, status: "error", error: message, index: i });
    }

    updateOverallProgress(i + 1, entries.length, 0, onProgress);
  }

  return { outputs, items };
}

async function runPdfToImagesBatch(entries, options) {
  const {
    pdfImageFormat = "png",
    onProgress = () => {},
    onItemUpdate = () => {},
  } = options;

  const outputs = [];
  const items = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    onItemUpdate({ id: entry.id, status: "running", index: i });

    try {
      const pageImages = await pdfToImages(entry, pdfImageFormat, (fileProgress) => {
        updateOverallProgress(i, entries.length, fileProgress, onProgress);
      });

      outputs.push(...pageImages);
      items.push({ id: entry.id, status: "success", outputName: `${pageImages.length} image file${pageImages.length === 1 ? "" : "s"}` });
      onItemUpdate({
        id: entry.id,
        status: "success",
        outputName: `${pageImages.length} image file${pageImages.length === 1 ? "" : "s"}`,
        index: i,
      });
    } catch (error) {
      const message = error?.message || "PDF to images conversion failed";
      items.push({ id: entry.id, status: "error", error: message });
      onItemUpdate({ id: entry.id, status: "error", error: message, index: i });
    }

    updateOverallProgress(i + 1, entries.length, 0, onProgress);
  }

  return { outputs, items };
}

async function runPdfToDjvuBatch(entries, options) {
  const {
    onProgress = () => {},
    onItemUpdate = () => {},
  } = options;

  const outputs = [];
  const items = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    onItemUpdate({ id: entry.id, status: "running", index: i });

    try {
      const blob = await pdfToDjvu(entry, (fileProgress) => {
        updateOverallProgress(i, entries.length, fileProgress, onProgress);
      });

      const output = {
        name: `${fileStem(entry?.name || "file")}.djvu`,
        blob,
      };
      outputs.push(output);
      items.push({ id: entry.id, status: "success", outputName: output.name });
      onItemUpdate({ id: entry.id, status: "success", outputName: output.name, index: i });
    } catch (error) {
      const message = error?.message || "PDF to DjVu conversion failed";
      items.push({ id: entry.id, status: "error", error: message });
      onItemUpdate({ id: entry.id, status: "error", error: message, index: i });
    }

    updateOverallProgress(i + 1, entries.length, 0, onProgress);
  }

  return { outputs, items };
}

async function runImageToDjvuBatch(entries, options) {
  const {
    onProgress = () => {},
    onItemUpdate = () => {},
  } = options;

  const outputs = [];
  const items = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    onItemUpdate({ id: entry.id, status: "running", index: i });

    try {
      const blob = await imagesToDjvu([entry], (fileProgress) => {
        updateOverallProgress(i, entries.length, fileProgress, onProgress);
      });

      const output = {
        name: `${fileStem(entry?.name || "file")}.djvu`,
        blob,
      };
      outputs.push(output);
      items.push({ id: entry.id, status: "success", outputName: output.name });
      onItemUpdate({ id: entry.id, status: "success", outputName: output.name, index: i });
    } catch (error) {
      const message = error?.message || "Image to DjVu conversion failed";
      items.push({ id: entry.id, status: "error", error: message });
      onItemUpdate({ id: entry.id, status: "error", error: message, index: i });
    }

    updateOverallProgress(i + 1, entries.length, 0, onProgress);
  }

  return { outputs, items };
}

async function runDjvuToPdfBatch(entries, options) {
  const {
    onProgress = () => {},
    onItemUpdate = () => {},
  } = options;

  const outputs = [];
  const items = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    onItemUpdate({ id: entry.id, status: "running", index: i });

    try {
      const blob = await djvuToPdf(entry, (fileProgress) => {
        updateOverallProgress(i, entries.length, fileProgress, onProgress);
      });

      const output = {
        name: `${fileStem(entry?.name || "file")}.pdf`,
        blob,
      };
      outputs.push(output);
      items.push({ id: entry.id, status: "success", outputName: output.name });
      onItemUpdate({ id: entry.id, status: "success", outputName: output.name, index: i });
    } catch (error) {
      const message = error?.message || "DjVu to PDF conversion failed";
      items.push({ id: entry.id, status: "error", error: message });
      onItemUpdate({ id: entry.id, status: "error", error: message, index: i });
    }

    updateOverallProgress(i + 1, entries.length, 0, onProgress);
  }

  return { outputs, items };
}

async function runDjvuToImagesBatch(entries, options) {
  const {
    pdfImageFormat = "png",
    onProgress = () => {},
    onItemUpdate = () => {},
  } = options;

  const outputs = [];
  const items = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    onItemUpdate({ id: entry.id, status: "running", index: i });

    try {
      const pageImages = await djvuToImages(entry, pdfImageFormat, (fileProgress) => {
        updateOverallProgress(i, entries.length, fileProgress, onProgress);
      });

      outputs.push(...pageImages);
      items.push({ id: entry.id, status: "success", outputName: `${pageImages.length} image file${pageImages.length === 1 ? "" : "s"}` });
      onItemUpdate({
        id: entry.id,
        status: "success",
        outputName: `${pageImages.length} image file${pageImages.length === 1 ? "" : "s"}`,
        index: i,
      });
    } catch (error) {
      const message = error?.message || "DjVu to images conversion failed";
      items.push({ id: entry.id, status: "error", error: message });
      onItemUpdate({ id: entry.id, status: "error", error: message, index: i });
    }

    updateOverallProgress(i + 1, entries.length, 0, onProgress);
  }

  return { outputs, items };
}

export async function runBatchOperation(entries, operation, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { outputs: [], items: [] };
  }

  const op = operation || BATCH_OPERATION_IDS.IMAGE_COMPRESS;
  if (op === BATCH_OPERATION_IDS.IMAGE_COMPRESS) {
    return runImageCompressBatch(entries, options);
  }

  if (op === BATCH_OPERATION_IDS.IMAGE_TO_DJVU) {
    return runImageToDjvuBatch(entries, options);
  }

  if (op === BATCH_OPERATION_IDS.PDF_COMPRESS) {
    return runPdfCompressBatch(entries, options);
  }

  if (op === BATCH_OPERATION_IDS.PDF_TO_IMAGES) {
    return runPdfToImagesBatch(entries, options);
  }

  if (op === BATCH_OPERATION_IDS.PDF_TO_DJVU) {
    return runPdfToDjvuBatch(entries, options);
  }

  if (op === BATCH_OPERATION_IDS.DJVU_TO_PDF) {
    return runDjvuToPdfBatch(entries, options);
  }

  if (op === BATCH_OPERATION_IDS.DJVU_TO_IMAGES) {
    return runDjvuToImagesBatch(entries, options);
  }

  throw new Error(`Unsupported batch operation: ${op}`);
}
