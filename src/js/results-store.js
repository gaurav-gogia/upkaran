import { writable } from "svelte/store";

export const results = writable([]);

let _nextId = 1;

function createPreviewUrl(blob) {
  if (blob.type.startsWith("image/")) {
    return URL.createObjectURL(blob);
  }
  return null;
}

export function addResult(name, blob) {
  const entry = {
    id: _nextId++,
    name,
    blob,
    mimeType: blob.type || "application/octet-stream",
    size: blob.size,
    previewUrl: createPreviewUrl(blob),
    addedAt: Date.now()
  };
  results.update((list) => [entry, ...list]);
  return entry;
}

export function addResults(items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item?.blob instanceof Blob && item?.name) {
      addResult(item.name, item.blob);
    }
  }
}

export function removeResult(id) {
  results.update((list) => {
    const entry = list.find((r) => r.id === id);
    if (entry?.previewUrl) {
      URL.revokeObjectURL(entry.previewUrl);
    }
    return list.filter((r) => r.id !== id);
  });
}

export function clearResults() {
  results.update((list) => {
    for (const entry of list) {
      if (entry.previewUrl) {
        URL.revokeObjectURL(entry.previewUrl);
      }
    }
    return [];
  });
}
