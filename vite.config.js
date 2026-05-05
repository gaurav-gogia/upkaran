import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [svelte(), cloudflare()],
  build: {
    // pdf.worker and HEIC codec bundles are large by nature; keep warnings meaningful.
    chunkSizeWarningLimit: 2500,
    rolldownOptions: {
      output: {
        codeSplitting: true
      }
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/heic2any")) return "img-heic";
          if (id.includes("node_modules/pdfjs-dist")) return "pdfjs";
          if (id.includes("node_modules/pdf-lib")) return "pdf-lib";
          if (id.includes("node_modules/fflate")) return "fflate";
                    if (id.includes("node_modules/qrcode")) return "qrcode";
                    if (id.includes("node_modules/jsqr")) return "jsqr";
          if (id.includes("node_modules")) return "vendor";
          return undefined;
        }
      }
    }
  },
  server: {
    host: true,
    port: 5173
  }
});