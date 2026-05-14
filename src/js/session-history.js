const STORAGE_KEY = "upkaran.session.history.v1";
const LAST_TOOL_KEY = "upkaran.session.lastTool";
const MAX_HISTORY_ITEMS = 50;

function nowIso() {
  return new Date().toISOString();
}

function safeParse(jsonText, fallback) {
  try {
    return JSON.parse(jsonText);
  } catch {
    return fallback;
  }
}

function hasLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeHistoryEntry(entry = {}) {
  return {
    id: `${entry.timestamp ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: entry.timestamp ?? Date.now(),
    isoTime: entry.isoTime ?? nowIso(),
    action: entry.action ?? "action",
    toolKey: entry.toolKey ?? "unknown",
    fileCount: Number.isFinite(entry.fileCount) ? entry.fileCount : 0,
    outputCount: Number.isFinite(entry.outputCount) ? entry.outputCount : 0,
    fileNames: Array.isArray(entry.fileNames) ? entry.fileNames.slice(0, 5) : [],
    settingsSummary: entry.settingsSummary ?? null,
    note: entry.note ?? ""
  };
}

export function getSessionHistory() {
  if (!hasLocalStorage()) return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed = safeParse(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed;
}

export function saveSessionHistory(items = []) {
  if (!hasLocalStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
}

export function addSessionHistory(entry) {
  const normalized = normalizeHistoryEntry(entry);
  const current = getSessionHistory();
  const next = [normalized, ...current].slice(0, MAX_HISTORY_ITEMS);
  saveSessionHistory(next);
  return next;
}

export function clearSessionHistory() {
  if (!hasLocalStorage()) return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(LAST_TOOL_KEY);
}

export function setLastUsedTool(toolKey) {
  if (!hasLocalStorage()) return;
  window.localStorage.setItem(LAST_TOOL_KEY, `${toolKey ?? ""}`);
}

export function getLastUsedTool() {
  if (!hasLocalStorage()) return "";
  return window.localStorage.getItem(LAST_TOOL_KEY) || "";
}

export function summarizeEntriesForHistory(entries = []) {
  return {
    fileCount: entries.length,
    fileNames: entries.slice(0, 5).map((item) => item?.name || item?.file?.name).filter(Boolean)
  };
}
