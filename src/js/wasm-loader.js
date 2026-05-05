const moduleCache = new Map();
const runtimeCache = new Map();

const MODULES = {
  compress: { wasmUrl: "/wasm/compress.wasm" },
  pdf: { wasmUrl: "/wasm/pdf.wasm" },
  util: { wasmUrl: "/wasm/util.wasm" }
};

function readGlobalFunc(name) {
  if (typeof globalThis[name] === "function") {
    return globalThis[name];
  }
  return null;
}

async function loadGoRuntime() {
  if (runtimeCache.has("go-runtime")) {
    return runtimeCache.get("go-runtime");
  }

  const task = (async () => {
    if (typeof globalThis.Go === "function") {
      return globalThis.Go;
    }

    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/wasm/wasm_exec.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load wasm_exec.js"));
      document.head.appendChild(script);
    });

    if (typeof globalThis.Go !== "function") {
      throw new Error("Go runtime is not available after loading wasm_exec.js");
    }

    return globalThis.Go;
  })();

  runtimeCache.set("go-runtime", task);
  return task;
}

export async function loadWasmModule(name) {
  if (moduleCache.has(name)) {
    return moduleCache.get(name);
  }

  const task = (async () => {
    const config = MODULES[name];
    if (!config) {
      throw new Error(`Unknown WASM module: ${name}`);
    }

    try {
      const Go = await loadGoRuntime();
      const go = new Go();
      const response = await fetch(config.wasmUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${config.wasmUrl}: ${response.status}`);
      }

      const result = await WebAssembly.instantiateStreaming(response, go.importObject);
      go.run(result.instance);
      return { name, instance: result.instance, ready: true };
    } catch (error) {
      console.warn(`[WASM] ${name} unavailable, using JS fallback.`, error);
      return null;
    }
  })();

  moduleCache.set(name, task);
  return task;
}

export async function invokeWasm(name, method, ...args) {
  const mod = await loadWasmModule(name);
  if (!mod) {
    return null;
  }

  const fn = readGlobalFunc(method);
  if (!fn) {
    return null;
  }

  try {
    const result = await fn(...args);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  } catch (error) {
    console.warn(`[WASM] call failed: ${name}.${method}`, error);
    return null;
  }
}

export function isWasmReady(moduleName) {
  if (!moduleName) {
    return moduleCache.size > 0;
  }
  return moduleCache.has(moduleName);
}
