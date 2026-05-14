const STORAGE_KEY = "upkaran.operation.lineage.v1";
const MAX_ITEMS = 300;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readAll() {
  if (!canUseStorage()) return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed = safeParse(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

function writeAll(items) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
}

function normalizeMime(entry) {
  return entry?.type || entry?.mimeType || entry?.file?.type || "application/octet-stream";
}

function sourceFingerprint(entry) {
  return [
    entry?.name || entry?.file?.name || "",
    entry?.size || entry?.file?.size || 0,
    normalizeMime(entry),
    entry?.file?.lastModified || 0,
  ].join("|");
}

export function addOperationLineage({ toolKey, action = "process", inputEntries = [], outputs = [] }) {
  if (!Array.isArray(inputEntries) || inputEntries.length === 0) return;

  const outputMeta = Array.isArray(outputs)
    ? outputs.map((item) => ({
      name: item?.name || "output",
      size: item?.blob?.size || 0,
      mimeType: item?.blob?.type || "application/octet-stream",
    }))
    : [];

  const timestamp = new Date().toISOString();
  const records = inputEntries.map((entry) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: timestamp,
    toolKey: toolKey || "unknown",
    action,
    status: "completed",
    source: {
      fingerprint: sourceFingerprint(entry),
      name: entry?.name || entry?.file?.name || "",
      size: entry?.size || entry?.file?.size || 0,
      mimeType: normalizeMime(entry),
      lastModified: entry?.file?.lastModified || 0,
    },
    outputCount: outputMeta.length,
    outputs: outputMeta,
  }));

  const existing = readAll();
  writeAll([...records, ...existing]);
}

export function getOperationLineageForEntry(entry, limit = 20) {
  const fingerprint = sourceFingerprint(entry);
  const records = readAll();

  return records
    .filter((record) => record?.source?.fingerprint === fingerprint)
    .slice(0, Math.max(1, Number(limit) || 20));
}
