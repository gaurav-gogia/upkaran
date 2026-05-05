import { invokeWasm } from "./wasm-loader.js";
import { gzipSync, zipSync } from "fflate";

function normalizeName(name = "file") {
  return name.replace(/[\\/:*?"<>|]+/g, "_");
}

async function toBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

function u8ToBlob(u8, mime = "application/octet-stream") {
  if (u8 instanceof Uint8Array) {
    return new Blob([u8], { type: mime });
  }
  return null;
}

function octal(value, width) {
  const raw = value.toString(8);
  return raw.padStart(width - 1, "0") + "\0";
}

function writeString(view, offset, value, maxLength) {
  const bytes = new TextEncoder().encode(value);
  const len = Math.min(bytes.length, maxLength);
  for (let i = 0; i < len; i += 1) {
    view[offset + i] = bytes[i];
  }
}

function buildTarEntry(name, bytes) {
  const header = new Uint8Array(512);
  writeString(header, 0, name, 100);
  writeString(header, 100, octal(0o644, 8), 8);
  writeString(header, 108, octal(0, 8), 8);
  writeString(header, 116, octal(0, 8), 8);
  writeString(header, 124, octal(bytes.length, 12), 12);
  writeString(header, 136, octal(Math.floor(Date.now() / 1000), 12), 12);
  writeString(header, 148, "        ", 8);
  writeString(header, 156, "0", 1);
  writeString(header, 257, "ustar\0", 6);
  writeString(header, 263, "00", 2);

  let checksum = 0;
  for (let i = 0; i < header.length; i += 1) {
    checksum += header[i];
  }
  writeString(header, 148, octal(checksum, 8), 8);

  const padLen = (512 - (bytes.length % 512 || 512)) % 512;
  const padded = new Uint8Array(bytes.length + padLen);
  padded.set(bytes, 0);
  return [header, padded];
}

export async function compressGzip(entry) {
  const input = await toBytes(entry.file);

  // Prefer WASM for large binaries when available.
  const wasmResult = await invokeWasm("compress", "wasmGzipBytes", input);
  if (wasmResult instanceof Uint8Array) {
    return u8ToBlob(wasmResult, "application/gzip");
  }

  const compressed = gzipSync(input);
  return u8ToBlob(compressed, "application/gzip");
}

export async function createZipBatch(entries) {
  const payload = {};
  for (const entry of entries) {
    payload[normalizeName(entry.name)] = await toBytes(entry.file);
  }

  const wasmResult = await invokeWasm("compress", "wasmZipBatch", payload);
  if (wasmResult instanceof Uint8Array) {
    return u8ToBlob(wasmResult, "application/zip");
  }

  const zipped = zipSync(payload, { level: 6 });
  return u8ToBlob(zipped, "application/zip");
}

export async function createTarBatch(entries) {
  const payload = {};
  for (const entry of entries) {
    payload[normalizeName(entry.name)] = await toBytes(entry.file);
  }

  const wasmResult = await invokeWasm("compress", "wasmTarBatch", payload);
  if (wasmResult instanceof Uint8Array) {
    return u8ToBlob(wasmResult, "application/x-tar");
  }

  const chunks = [];
  for (const [name, bytes] of Object.entries(payload)) {
    chunks.push(...buildTarEntry(name, bytes));
  }
  chunks.push(new Uint8Array(1024));
  return new Blob(chunks, { type: "application/x-tar" });
}

export function toDownloadFileName(baseName, ext) {
  const stem = baseName.replace(/\.[^.]+$/, "");
  return `${normalizeName(stem)}.${ext}`;
}
