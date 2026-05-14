const APP_PREFIXES = ["upkaran.", "upkaran-"];
const APP_EXACT_KEYS = ["upkaran-theme", "upkaran-color-mode"];

function matchesAppKey(key = "") {
  return APP_EXACT_KEYS.includes(key) || APP_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function clearStorageKeys(storage) {
  if (!storage) return;
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (matchesAppKey(key || "")) {
      keys.push(key);
    }
  }
  for (const key of keys) {
    storage.removeItem(key);
  }
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function clearIndexedDb() {
  if (typeof indexedDB === "undefined") return;
  if (typeof indexedDB.databases !== "function") return;

  const dbList = await indexedDB.databases();
  const targets = dbList
    .map((db) => db?.name)
    .filter((name) => typeof name === "string" && name.toLowerCase().includes("upkaran"));

  await Promise.all(targets.map((name) => deleteDatabase(name)));
}

async function clearCaches() {
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  const targets = keys.filter((name) => name.toLowerCase().includes("upkaran") || name.toLowerCase().includes("workbox"));
  await Promise.all(targets.map((name) => caches.delete(name)));
}

async function clearServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
}

export async function secureClearLocalAppData() {
  if (typeof window === "undefined") {
    return { ok: false };
  }

  try {
    clearStorageKeys(window.localStorage);
  } catch {
    // Ignore storage failures.
  }

  try {
    clearStorageKeys(window.sessionStorage);
  } catch {
    // Ignore storage failures.
  }

  await Promise.allSettled([clearIndexedDb(), clearCaches(), clearServiceWorkers()]);
  return { ok: true };
}
