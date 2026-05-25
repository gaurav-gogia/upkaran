import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const publicDir = path.join(repoRoot, "public");

const manifestJson = `{
  "name": "Upkaran Offline Suite",
  "short_name": "Upkaran",
  "description": "PDF, image, and file operations with zero backend and full offline capability.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "theme_color": "#1f2937",
  "background_color": "#ffffff",
  "icons": [
    {
      "src": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'><rect fill='%231f2937' width='192' height='192'/><text x='50%' y='50%' font-size='120' font-weight='bold' fill='%23ffffff' text-anchor='middle' dominant-baseline='central'>U</text></svg>",
      "sizes": "192x192",
      "type": "image/svg+xml",
      "purpose": "any"
    },
    {
      "src": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'><rect fill='%231f2937' width='192' height='192'/><text x='50%' y='50%' font-size='120' font-weight='bold' fill='%23ffffff' text-anchor='middle' dominant-baseline='central'>U</text></svg>",
      "sizes": "512x512",
      "type": "image/svg+xml",
      "purpose": "any"
    },
    {
      "src": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'><rect fill='%231f2937' width='192' height='192'/><text x='50%' y='50%' font-size='120' font-weight='bold' fill='%23ffffff' text-anchor='middle' dominant-baseline='central'>U</text></svg>",
      "sizes": "192x192",
      "type": "image/svg+xml",
      "purpose": "maskable"
    }
  ],
  "categories": [
    "productivity",
    "utilities"
  ],
  "screenshots": [
    {
      "src": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 540 720'><rect fill='%23f6f7f9' width='540' height='720'/><text x='270' y='360' font-size='64' font-weight='bold' fill='%231f2937' text-anchor='middle' dominant-baseline='central'>Upkaran</text></svg>",
      "sizes": "540x720",
      "type": "image/svg+xml",
      "form_factor": "narrow"
    },
    {
      "src": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1280 720'><rect fill='%23f6f7f9' width='1280' height='720'/><text x='640' y='360' font-size='64' font-weight='bold' fill='%231f2937' text-anchor='middle' dominant-baseline='central'>Upkaran</text></svg>",
      "sizes": "1280x720",
      "type": "image/svg+xml",
      "form_factor": "wide"
    }
  ],
  "shortcuts": [
    {
      "name": "PDF Tools",
      "short_name": "PDF",
      "description": "Access PDF merge, split, compress, and more",
      "url": "/",
      "icons": [
        {
          "src": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><rect fill='%23dc2626' width='96' height='96'/><text x='48' y='48' font-size='60' font-weight='bold' fill='%23ffffff' text-anchor='middle' dominant-baseline='central'>PDF</text></svg>",
          "sizes": "96x96",
          "type": "image/svg+xml"
        }
      ]
    },
    {
      "name": "Image Tools",
      "short_name": "Image",
      "description": "Compress, convert, and crop images",
      "url": "/",
      "icons": [
        {
          "src": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><rect fill='%230891b2' width='96' height='96'/><text x='48' y='48' font-size='60' font-weight='bold' fill='%23ffffff' text-anchor='middle' dominant-baseline='central'>IMG</text></svg>",
          "sizes": "96x96",
          "type": "image/svg+xml"
        }
      ]
    }
  ]
}
`;

const serviceWorkerJs = `const CACHE_NAME = "upkaran-shell-v2";
const BASE_PATH = (() => {
  try {
    const pathname = new URL(self.registration.scope).pathname || "/";
    return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  } catch {
    return "";
  }
})();

function toAppPath(pathname) {
  if (BASE_PATH) {
    return BASE_PATH + pathname;
  }
  return pathname;
}

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/service-worker.js",
  "/wasm/wasm_exec.js",
  "/wasm/compress.wasm",
  "/wasm/pdf.wasm",
  "/wasm/util.wasm"
].map(toAppPath);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Do not fail the full SW install if one optional shell resource is missing.
      await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === "opaque") {
            return response;
          }

          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(toAppPath("/index.html")));
    })
  );
});
`;

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Upkaran favicon">
  <rect width="64" height="64" rx="12" fill="#1f2937" />
  <path d="M16 18v20c0 7.73 6.27 14 14 14h4c7.73 0 14-6.27 14-14V18h-8v20a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6V18z" fill="#ffffff" />
</svg>
`;

async function main() {
  await mkdir(publicDir, { recursive: true });
  await writeFile(path.join(publicDir, "manifest.json"), manifestJson, "utf8");
  await writeFile(path.join(publicDir, "service-worker.js"), serviceWorkerJs, "utf8");
  await writeFile(path.join(publicDir, "favicon.svg"), faviconSvg, "utf8");
  console.log("Generated public assets: manifest.json, service-worker.js, favicon.svg");
}

main().catch((error) => {
  console.error("Failed to generate public assets", error);
  process.exitCode = 1;
});
