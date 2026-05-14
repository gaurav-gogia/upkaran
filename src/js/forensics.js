/**
 * forensics.js — Offline file inspection: hashes, metadata, EXIF, structure.
 * No external network requests are made. All analysis runs client-side.
 */

import { PDFDocument } from "pdf-lib";
import { strFromU8, unzipSync } from "fflate";
import { measureAsync } from "./perf-profile.js";

const HASH_WORKER_MIN_BYTES = 256 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// MD5 — pure JS (Web Crypto does not support MD5)
// ─────────────────────────────────────────────────────────────────────────────

const _MD5_T = Array.from({ length: 64 }, (_, i) => (Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
const _MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

function md5Hex(bytes) {
  const len = bytes.length;
  const bitLen = len * 8;
  const padLen = (len % 64) < 56 ? 56 - (len % 64) : 120 - (len % 64);
  const padded = new Uint8Array(len + padLen + 8);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(len + padLen,     bitLen & 0xffffffff, true);
  dv.setUint32(len + padLen + 4, Math.floor(bitLen / 2 ** 32), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let blk = 0; blk < padded.length; blk += 64) {
    const W = Array.from({ length: 16 }, (_, i) => dv.getUint32(blk + i * 4, true));
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let F, g;
      if      (i < 16) { F = (b & c) | (~b & d);  g = i; }
      else if (i < 32) { F = (d & b) | (~d & c);  g = (5 * i + 1) % 16; }
      else if (i < 48) { F = b ^ c ^ d;            g = (3 * i + 5) % 16; }
      else             { F = c ^ (b | ~d);          g = (7 * i) % 16; }
      F = ((F >>> 0) + a + _MD5_T[i] + W[g]) >>> 0;
      a = d; d = c; c = b;
      b = (b + ((F << _MD5_S[i]) | (F >>> (32 - _MD5_S[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }

  const r = new Uint8Array(16);
  const rv = new DataView(r.buffer);
  rv.setUint32(0, a0, true); rv.setUint32(4, b0, true);
  rv.setUint32(8, c0, true); rv.setUint32(12, d0, true);
  return Array.from(r).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// Hashing
// ─────────────────────────────────────────────────────────────────────────────

async function hexDigest(buffer, algo) {
  const h = await crypto.subtle.digest(algo, buffer);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function computeHashesMainThread(buffer) {
  const [sha256, sha1] = await Promise.all([
    hexDigest(buffer, "SHA-256"),
    hexDigest(buffer, "SHA-1"),
  ]);
  return { md5: md5Hex(new Uint8Array(buffer)), sha1, sha256 };
}

function hashWorkerSupported() {
  return typeof Worker !== "undefined";
}

async function computeHashesWithWorker(buffer) {
  const worker = new Worker(new URL("./workers/hash.worker.js", import.meta.url), { type: "module" });
  const requestId = `hash-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Keep the original buffer intact for parallel type-specific analysis.
  const transferBuffer = buffer.slice(0);

  try {
    return await new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const message = event.data || {};
        if (message.id !== requestId) return;

        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);

        if (message.ok) {
          resolve(message.hashes);
          return;
        }

        reject(new Error(message.error || "Hash worker failed"));
      };

      const onError = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        reject(new Error("Hash worker crashed"));
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);

      worker.postMessage(
        {
          type: "compute",
          id: requestId,
          buffer: transferBuffer,
        },
        [transferBuffer]
      );
    });
  } finally {
    worker.terminate();
  }
}

export async function computeHashes(buffer, options = {}) {
  const useWorker = options.useWorker !== false;
  const workerMinBytes = Math.max(0, Number(options.workerMinBytes) || HASH_WORKER_MIN_BYTES);

  if (useWorker && hashWorkerSupported() && buffer.byteLength >= workerMinBytes) {
    try {
      return await computeHashesWithWorker(buffer);
    } catch {
      // Fall back to main-thread hashing if worker initialization or execution fails.
    }
  }

  return computeHashesMainThread(buffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// TIFF / JPEG EXIF parser
// ─────────────────────────────────────────────────────────────────────────────

const _TIFF_TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8];

function _tiffRead(view, le, tiffStart, type, count, valueFieldPos) {
  const sz = (_TIFF_TYPE_SIZE[type] || 1) * count;
  const dataOff = sz <= 4
    ? valueFieldPos
    : tiffStart + view.getUint32(valueFieldPos, le);

  try {
    switch (type) {
      case 2: { // ASCII
        let s = "";
        for (let i = 0; i < count; i++) {
          const c = view.getUint8(dataOff + i);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        return s.trim();
      }
      case 1: case 7: // BYTE, UNDEFINED
        return count === 1
          ? view.getUint8(dataOff)
          : Array.from({ length: count }, (_, i) => view.getUint8(dataOff + i));
      case 3: // SHORT
        return count === 1
          ? view.getUint16(dataOff, le)
          : Array.from({ length: count }, (_, i) => view.getUint16(dataOff + i * 2, le));
      case 4: // LONG
        return count === 1
          ? view.getUint32(dataOff, le)
          : Array.from({ length: count }, (_, i) => view.getUint32(dataOff + i * 4, le));
      case 5: { // RATIONAL
        const r = (i) => ({ n: view.getUint32(dataOff + i * 8, le), d: view.getUint32(dataOff + i * 8 + 4, le) });
        return count === 1 ? r(0) : Array.from({ length: count }, (_, i) => r(i));
      }
      case 9: // SLONG
        return count === 1
          ? view.getInt32(dataOff, le)
          : Array.from({ length: count }, (_, i) => view.getInt32(dataOff + i * 4, le));
      case 10: { // SRATIONAL
        const r = (i) => ({ n: view.getInt32(dataOff + i * 8, le), d: view.getInt32(dataOff + i * 8 + 4, le) });
        return count === 1 ? r(0) : Array.from({ length: count }, (_, i) => r(i));
      }
      default: return null;
    }
  } catch { return null; }
}

function _parseIFD(view, le, tiffStart, ifdRelOffset) {
  const off = tiffStart + ifdRelOffset;
  const count = view.getUint16(off, le);
  const tags = {};
  for (let i = 0; i < count; i++) {
    const e = off + 2 + i * 12;
    const tag   = view.getUint16(e,     le);
    const type  = view.getUint16(e + 2, le);
    const cnt   = view.getUint32(e + 4, le);
    try { tags[tag] = _tiffRead(view, le, tiffStart, type, cnt, e + 8); } catch { /* skip */ }
  }
  return tags;
}

function _rat(r) { return r && r.d ? r.n / r.d : 0; }

function _flashDesc(v) {
  if (v == null) return null;
  return (v & 1) ? `Flash fired${(v >> 1 & 3) === 2 ? " (return detected)" : ""}` : "No flash";
}

const _EXPOSURE_PROGRAM = ["Not defined","Manual","Normal","Aperture priority","Shutter priority","Creative","Action","Portrait","Landscape"];
const _METERING_MODE    = {0:"Unknown",1:"Average",2:"Center weighted",3:"Spot",4:"Multi-spot",5:"Multi-segment",6:"Partial"};

function _parseTiffExif(view, tiffStart) {
  const bom = view.getUint16(tiffStart, false);
  if (bom !== 0x4949 && bom !== 0x4D4D) return null;
  const le = bom === 0x4949;
  if (view.getUint16(tiffStart + 2, le) !== 42) return null;

  const ifd0Rel = view.getUint32(tiffStart + 4, le);
  const ifd0 = _parseIFD(view, le, tiffStart, ifd0Rel);
  const result = {};

  const str = (v) => (typeof v === "string" && v ? v : null);

  // IFD0 basic tags
  if (ifd0[0x010F]) result.make        = str(ifd0[0x010F]);
  if (ifd0[0x0110]) result.model       = str(ifd0[0x0110]);
  if (ifd0[0x0132]) result.dateTime    = str(ifd0[0x0132]);
  if (ifd0[0x013B]) result.artist      = str(ifd0[0x013B]);
  if (ifd0[0x010E]) result.description = str(ifd0[0x010E]);
  if (ifd0[0x013C]) result.hostComputer = str(ifd0[0x013C]);
  if (ifd0[0x013D]) result.software    = str(ifd0[0x013D]);
  if (ifd0[0x8298]) result.copyright   = str(ifd0[0x8298]);

  // Exif sub-IFD
  if (ifd0[0x8769] != null) {
    const exif = _parseIFD(view, le, tiffStart, ifd0[0x8769]);
    if (exif[0x9003]) result.dateTimeOriginal  = str(exif[0x9003]);
    if (exif[0x9004]) result.dateTimeDigitized = str(exif[0x9004]);
    if (exif[0x8827] != null) result.iso = Array.isArray(exif[0x8827]) ? exif[0x8827][0] : exif[0x8827];
    if (exif[0x829A]) { const r = exif[0x829A]; result.exposureTime = r?.d ? `${r.n}/${r.d} s` : null; }
    if (exif[0x829D]) { const r = exif[0x829D]; result.fNumber = r?.d ? +(_rat(r)).toFixed(1) : null; }
    if (exif[0x920A]) { const r = exif[0x920A]; result.focalLength = r?.d ? +(_rat(r)).toFixed(1) : null; }
    if (exif[0xA405] != null) result.focalLength35mm = exif[0xA405];
    if (exif[0x9209] != null) result.flash          = _flashDesc(exif[0x9209]);
    if (exif[0xA001] != null) result.colorSpace      = exif[0xA001] === 1 ? "sRGB" : "Uncalibrated";
    if (exif[0xA002] != null) result.pixelWidth      = exif[0xA002];
    if (exif[0xA003] != null) result.pixelHeight     = exif[0xA003];
    if (exif[0xA403] != null) result.whiteBalance     = exif[0xA403] === 0 ? "Auto" : "Manual";
    if (exif[0x8822] != null) result.exposureProgram  = _EXPOSURE_PROGRAM[exif[0x8822]] ?? `Program ${exif[0x8822]}`;
    if (exif[0x9207] != null) result.meteringMode     = _METERING_MODE[exif[0x9207]] ?? `Mode ${exif[0x9207]}`;
    if (exif[0x9204]) { const r = exif[0x9204]; result.exposureBias = r?.d ? `${(_rat(r)).toFixed(1)} EV` : null; }
    if (exif[0xA002] == null && exif[0xA003] == null && exif[0xA002]) {
      // pixelX/Y not found but ExifIFD existed — leave as-is
    }
    if (exif[0x9201]) { // ShutterSpeedValue SRATIONAL → APEX
      const r = exif[0x9201];
      if (r?.d) result.shutterSpeedApex = +(_rat(r)).toFixed(2);
    }
  }

  // GPS sub-IFD
  if (ifd0[0x8825] != null) {
    const gps = _parseIFD(view, le, tiffStart, ifd0[0x8825]);
    const g = {};
    const ref = (v) => (typeof v === "string" ? v : null);
    g.latRef = ref(gps[0x0001]);
    g.lonRef = ref(gps[0x0003]);

    const dms = (arr) => {
      if (!Array.isArray(arr) || arr.length < 3) return null;
      return _rat(arr[0]) + _rat(arr[1]) / 60 + _rat(arr[2]) / 3600;
    };

    const lat = dms(gps[0x0002]);
    const lon = dms(gps[0x0004]);
    if (lat != null) g.latitude  = g.latRef === "S" ? -lat : lat;
    if (lon != null) g.longitude = g.lonRef === "W" ? -lon : lon;

    if (gps[0x0006]) {
      const alt = _rat(gps[0x0006]);
      g.altitude    = +alt.toFixed(1);
      g.altitudeRef = gps[0x0005] === 1 ? "Below sea level" : "Above sea level";
    }
    if (gps[0x001D]) g.date = ref(gps[0x001D]);
    if (gps[0x0007] && Array.isArray(gps[0x0007])) {
      const [h, m, s] = gps[0x0007].map(_rat);
      g.time = `${String(Math.floor(h)).padStart(2,"0")}:${String(Math.floor(m)).padStart(2,"0")}:${String(Math.floor(s)).padStart(2,"0")} UTC`;
    }
    if (gps[0x0012]) g.mapDatum = ref(gps[0x0012]);
    if (Object.keys(g).length > 0) result.gps = g;
  }

  return Object.keys(result).length ? result : null;
}

/** Parse EXIF from a JPEG ArrayBuffer. Returns null if not found. */
export function parseJpegExif(buffer) {
  const bytes = new Uint8Array(buffer);
  const view  = new DataView(buffer);
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null; // not JPEG

  let off = 2;
  while (off < bytes.length - 1) {
    if (bytes[off] !== 0xFF) break;
    off++;
    const marker = bytes[off++];
    if (marker === 0xD8 || marker === 0xD9 || marker === 0x01) continue; // no payload markers

    if (off + 1 >= bytes.length) break;
    const segLen = view.getUint16(off, false); // big-endian, includes the 2 length bytes

    if (marker === 0xE1 && segLen > 8) { // APP1
      const ds = off + 2;
      if (
        bytes[ds]   === 0x45 && bytes[ds+1] === 0x78 && // E x
        bytes[ds+2] === 0x69 && bytes[ds+3] === 0x66 && // i f
        bytes[ds+4] === 0x00 && bytes[ds+5] === 0x00    // \0 \0
      ) {
        try { return _parseTiffExif(view, ds + 6); } catch { return null; }
      }
    }
    off += segLen;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PNG metadata parser
// ─────────────────────────────────────────────────────────────────────────────

const _PNG_COLOR_TYPE = {0:"Grayscale",2:"RGB",3:"Indexed",4:"Grayscale+Alpha",6:"RGB+Alpha"};

export function parsePngMeta(buffer) {
  const bytes = new Uint8Array(buffer);
  const view  = new DataView(buffer);

  // PNG signature
  if (view.getUint32(0, false) !== 0x89504E47 || view.getUint32(4, false) !== 0x0D0A1A0A) return null;

  const result = { width: 0, height: 0, bitDepth: 0, colorType: "", text: {} };
  let off = 8;

  while (off + 12 <= bytes.length) {
    const chunkLen  = view.getUint32(off, false);
    const typeCode  = (view.getUint32(off + 4, false) >>> 0).toString(16).padStart(8, "0");
    const typeStr   = String.fromCharCode(bytes[off+4], bytes[off+5], bytes[off+6], bytes[off+7]);
    const dataStart = off + 8;

    if (typeStr === "IHDR") {
      result.width     = view.getUint32(dataStart, false);
      result.height    = view.getUint32(dataStart + 4, false);
      result.bitDepth  = bytes[dataStart + 8];
      result.colorType = _PNG_COLOR_TYPE[bytes[dataStart + 9]] ?? `Type ${bytes[dataStart + 9]}`;
      result.interlaced = bytes[dataStart + 12] === 1;
    } else if (typeStr === "tEXt" && chunkLen > 1) {
      const chunk = bytes.slice(dataStart, dataStart + chunkLen);
      const nul   = chunk.indexOf(0);
      if (nul >= 0) {
        const key = new TextDecoder().decode(chunk.slice(0, nul));
        const val = new TextDecoder().decode(chunk.slice(nul + 1));
        result.text[key] = val;
      }
    } else if (typeStr === "iTXt" && chunkLen > 5) {
      // keyword\0 compressionFlag(1) compressionMethod(1) languageTag\0 translatedKeyword\0 text
      const chunk = bytes.slice(dataStart, dataStart + chunkLen);
      const nul   = chunk.indexOf(0);
      if (nul >= 0) {
        const key   = new TextDecoder().decode(chunk.slice(0, nul));
        const compressed = chunk[nul + 1] === 1;
        if (!compressed) {
          let rest = nul + 4; // skip compFlag, compMethod, langTag\0
          while (rest < chunk.length && chunk[rest] !== 0) rest++; rest++; // skip translatedKeyword\0
          const val = new TextDecoder("utf-8",{fatal:false}).decode(chunk.slice(rest));
          result.text[key] = val;
        }
      }
    } else if (typeStr === "IEND") {
      break;
    }

    off += 12 + chunkLen; // 4 len + 4 type + chunkLen data + 4 CRC
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Image dimensions (via createImageBitmap – works for JPEG/PNG/WebP/GIF/HEIC)
// ─────────────────────────────────────────────────────────────────────────────

async function _imageDimensions(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const dims = { width: bmp.width, height: bmp.height };
    bmp.close();
    return dims;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP central directory parser (no decompression)
// ─────────────────────────────────────────────────────────────────────────────

const _COMPRESSION_METHOD = {
  0: "Stored", 8: "Deflate", 9: "Deflate64", 12: "BZip2", 14: "LZMA",
};

export function parseZipDirectory(buffer) {
  const bytes = new Uint8Array(buffer);
  const view  = new DataView(buffer);
  const len   = bytes.length;

  // Find EOCD by scanning backwards
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 65_558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const totalEntries = view.getUint16(eocd + 10, true);
  let   cdOff        = view.getUint32(eocd + 16, true);

  // Handle ZIP64
  if (cdOff === 0xFFFFFFFF) {
    const eocd64loc = eocd - 20;
    if (eocd64loc >= 0 && view.getUint32(eocd64loc, true) === 0x07064b50) {
      const eocd64off = Number(view.getBigUint64(eocd64loc + 8, true));
      cdOff = Number(view.getBigUint64(eocd64off + 48, true));
    }
  }

  const entries = [];
  let off = cdOff;
  for (let i = 0; i < totalEntries && off + 46 <= len; i++) {
    if (view.getUint32(off, true) !== 0x02014b50) break;
    const method          = view.getUint16(off + 10, true);
    const compressedSize  = view.getUint32(off + 20, true);
    const uncompressedSize= view.getUint32(off + 24, true);
    const nameLen         = view.getUint16(off + 28, true);
    const extraLen        = view.getUint16(off + 30, true);
    const commentLen      = view.getUint16(off + 32, true);
    const name            = new TextDecoder("utf-8",{fatal:false}).decode(bytes.slice(off + 46, off + 46 + nameLen));
    entries.push({
      path: name,
      compressedSize,
      uncompressedSize,
      method: _COMPRESSION_METHOD[method] ?? `Method ${method}`,
    });
    off += 46 + nameLen + extraLen + commentLen;
  }

  const totalUncompressed = entries.reduce((s, e) => s + e.uncompressedSize, 0);
  const totalCompressed   = entries.reduce((s, e) => s + e.compressedSize,   0);
  const ratio = totalUncompressed > 0
    ? (((totalUncompressed - totalCompressed) / totalUncompressed) * 100).toFixed(1) + "%"
    : "—";

  return { entries, totalEntries: entries.length, totalUncompressed, totalCompressed, ratio };
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF analysis (via pdf-lib)
// ─────────────────────────────────────────────────────────────────────────────

async function _analyzePdf(buffer) {
  let doc, encrypted = false, encryptError = null;
  try {
    doc = await PDFDocument.load(buffer, { updateMetadata: false });
  } catch (e) {
    encrypted = true;
    encryptError = e.message;
  }

  const result = { encrypted, encryptError, pageCount: null, metadata: {}, permissions: {} };

  if (doc) {
    result.pageCount = doc.getPageCount();
    const safeStr = (fn) => { try { return fn() ?? null; } catch { return null; } };
    result.metadata = {
      title      : safeStr(() => doc.getTitle()),
      author     : safeStr(() => doc.getAuthor()),
      subject    : safeStr(() => doc.getSubject()),
      keywords   : safeStr(() => doc.getKeywords()),
      creator    : safeStr(() => doc.getCreator()),
      producer   : safeStr(() => doc.getProducer()),
      createdAt  : safeStr(() => doc.getCreationDate()?.toISOString()),
      modifiedAt : safeStr(() => doc.getModificationDate()?.toISOString()),
    };

    // Try to read /Encrypt dictionary for permission bits
    try {
      const encrypt = doc.context.lookup(doc.context.trailerInfo.Encrypt);
      if (encrypt) {
        const P = encrypt.get && encrypt.get(doc.context.PDFName?.of("P"));
        if (P && typeof P.asNumber === "function") {
          const flags = P.asNumber();
          result.permissions = {
            printAllowed    : !!(flags & (1 << 2)),
            copyAllowed     : !!(flags & (1 << 4)),
            modifyAllowed   : !!(flags & (1 << 3)),
            annotateAllowed : !!(flags & (1 << 5)),
            formsAllowed    : !!(flags & (1 << 8)),
          };
        }
      }
    } catch { /* /Encrypt not present or inaccessible */ }

    // Count embedded files
    try {
      const names = doc.catalog.lookupMaybe
        ? doc.catalog.lookupMaybe(doc.context.PDFName?.of("Names"))
        : null;
      result.embeddedFileCount = names ? "Check manually" : 0;
    } catch { result.embeddedFileCount = null; }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Office documents: DOCX / PPTX / XLSX (OOXML = ZIP + XML)
// ─────────────────────────────────────────────────────────────────────────────

function _xmlText(xmlString, selector) {
  try {
    const doc = new DOMParser().parseFromString(xmlString, "application/xml");
    return doc.querySelector(selector)?.textContent?.trim() ?? null;
  } catch { return null; }
}

function _xmlAll(xmlString, selector) {
  try {
    const doc = new DOMParser().parseFromString(xmlString, "application/xml");
    return Array.from(doc.querySelectorAll(selector)).map((el) => el.textContent.trim()).filter(Boolean);
  } catch { return []; }
}

async function _analyzeOffice(buffer, ext) {
  const files = unzipSync(new Uint8Array(buffer));
  const get   = (path) => files[path] ? strFromU8(files[path]) : null;

  const coreXml = get("docProps/core.xml");
  const appXml  = get("docProps/app.xml");

  const core = {};
  if (coreXml) {
    core.title          = _xmlText(coreXml, "title");
    core.subject        = _xmlText(coreXml, "subject");
    core.creator        = _xmlText(coreXml, "creator");
    core.lastModifiedBy = _xmlText(coreXml, "lastModifiedBy");
    core.description    = _xmlText(coreXml, "description");
    core.keywords       = _xmlText(coreXml, "keywords");
    core.revision       = _xmlText(coreXml, "revision");
    core.created        = _xmlText(coreXml, "created");
    core.modified       = _xmlText(coreXml, "modified");
    core.category       = _xmlText(coreXml, "category");
  }

  const app = {};
  if (appXml) {
    app.application     = _xmlText(appXml, "Application");
    app.appVersion      = _xmlText(appXml, "AppVersion");
    if (ext === "docx") {
      app.pages      = _xmlText(appXml, "Pages");
      app.words      = _xmlText(appXml, "Words");
      app.characters = _xmlText(appXml, "Characters");
      app.paragraphs = _xmlText(appXml, "Paragraphs");
    }
    if (ext === "pptx") {
      app.slides = _xmlText(appXml, "Slides");
      app.notes  = _xmlText(appXml, "Notes");
    }
    if (ext === "xlsx") {
      app.worksheets = _xmlText(appXml, "Worksheets");
      app.sheetNames = _xmlAll(appXml, "SheetNames vt\\:lpstr, SheetNames *").join(", ");
    }
  }

  // Count embedded media
  const mediaKeys = Object.keys(files).filter((k) => k.startsWith("word/media/") || k.startsWith("ppt/media/") || k.startsWith("xl/media/"));

  return { core, app, embeddedMediaCount: mediaKeys.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Text / code / CSV-TSV analysis
// ─────────────────────────────────────────────────────────────────────────────

function _detectEncoding(bytes) {
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return "UTF-8 (BOM)";
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return "UTF-16 LE (BOM)";
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return "UTF-16 BE (BOM)";
  // Heuristic: if high bytes are rare, it's likely UTF-8
  let highCount = 0;
  const sample = Math.min(bytes.length, 4096);
  for (let i = 0; i < sample; i++) { if (bytes[i] > 0x7E) highCount++; }
  return highCount / sample < 0.05 ? "UTF-8" : "Binary / Unknown";
}

function _analyzeText(buffer, kind, ext) {
  const bytes = new Uint8Array(buffer);
  const encoding = _detectEncoding(bytes);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const lines = text.split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim()).length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  const base = { lineCount: lines.length, nonEmptyLines: nonEmpty, charCount: text.length, wordCount, encoding };

  if (kind === "data" && (ext === "csv" || ext === "tsv")) {
    const delimiter = ext === "tsv" ? "\t" : (text.indexOf("\t") > text.indexOf(",") ? "\t" : ",");
    const firstLine = lines.find((l) => l.trim());
    const colCount  = firstLine ? firstLine.split(delimiter).length : 0;
    const headers   = firstLine ? firstLine.split(delimiter).map((h) => h.replace(/^"(.*)"$/, "$1").trim()) : [];
    return { ...base, csvMeta: { delimiter: delimiter === "\t" ? "Tab" : "Comma", colCount, rowCount: nonEmpty, headers } };
  }

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Archive detection helpers
// ─────────────────────────────────────────────────────────────────────────────

const _ARCHIVE_EXTS = new Set(["zip","jar","apk","docx","pptx","xlsx","gz","tgz","tar","7z","rar","bz2","xz","zst"]);

function _isGzip(bytes) { return bytes[0] === 0x1F && bytes[1] === 0x8B; }
function _isTar(bytes)  {
  // TAR magic at offset 257: "ustar"
  if (bytes.length < 265) return false;
  return bytes[257]===0x75 && bytes[258]===0x73 && bytes[259]===0x74 && bytes[260]===0x61 && bytes[261]===0x72;
}
function _isZip(bytes)  { return bytes[0] === 0x50 && bytes[1] === 0x4B; }

// ─────────────────────────────────────────────────────────────────────────────
// Main analyzeFile entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyze a file entry and return a structured forensics result.
 * @param {{ file: File, kind: string, name: string, type: string, size: number }} entry
 * @returns {Promise<Object>} Forensics result
 */
export async function analyzeFile(entry) {
  const { file, kind, name, type, size } = entry;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  const buffer = await file.arrayBuffer();
  const bytes  = new Uint8Array(buffer);

  // Hashes in parallel with type-specific analysis.
  let hashDurationMs = 0;
  let specificDurationMs = 0;

  const hashTask = measureAsync(
    "forensics.hashes",
    () => computeHashes(buffer),
    { kind, sizeBytes: size || 0 }
  ).then(({ result, durationMs }) => {
    hashDurationMs = Math.round(durationMs);
    return result;
  });

  const specificTask = measureAsync(
    "forensics.specific_analysis",
    async () => {
      try {
        if (kind === "pdf") {
          return { _type: "pdf", ...(await _analyzePdf(buffer)) };
        }

        if (kind === "image") {
          const dims = await _imageDimensions(file);
          const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
          const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
          const exif = isJpeg ? parseJpegExif(buffer) : null;
          const pngMeta = isPng ? parsePngMeta(buffer) : null;

          return {
            _type: "image",
            dims: dims ?? (pngMeta ? { width: pngMeta.width, height: pngMeta.height } : null),
            exif,
            pngMeta,
          };
        }

        if (kind === "document" && ["docx", "pptx", "xlsx"].includes(ext)) {
          return { _type: "office", ...(await _analyzeOffice(buffer, ext)) };
        }

        if (kind === "document" || kind === "code" || kind === "data") {
          return { _type: "text", ..._analyzeText(buffer, kind, ext) };
        }

        // Archives: kind "other" with known archive extension, or ZIP magic bytes
        if (_isZip(bytes)) {
          const zipData = parseZipDirectory(buffer);
          return { _type: "zip", zipData };
        }

        if (_isGzip(bytes)) {
          return { _type: "gzip" };
        }

        if (_isTar(bytes)) {
          return { _type: "tar" };
        }

        return { _type: "unknown" };
      } catch (e) {
        return { _type: "error", error: e.message };
      }
    },
    { kind, ext: ext || "", sizeBytes: size || 0 }
  ).then(({ result, durationMs }) => {
    specificDurationMs = Math.round(durationMs);
    return result;
  });

  const [hashes, specific] = await Promise.all([hashTask, specificTask]);

  return {
    name,
    size,
    kind,
    mimeType: type,
    lastModified: file.lastModified,
    hashes,
    perf: {
      hashMs: hashDurationMs,
      specificMs: specificDurationMs,
    },
    ...specific,
  };
}
