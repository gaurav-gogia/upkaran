let jsQRLib = null;

async function loadJsQr() {
  if (!jsQRLib) {
    const mod = await import("jsqr");
    jsQRLib = mod.default;
  }
  return jsQRLib;
}

async function loadImageElement(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Failed to load image."));
      el.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function getImageSource(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  return loadImageElement(file);
}

export async function decodeQrFromImageFile(file) {
  const jsQR = await loadJsQr();
  const source = await getImageSource(file);

  const width = source.width || 0;
  const height = source.height || 0;
  if (!width || !height) {
    if (typeof source.close === "function") source.close();
    throw new Error("Image has invalid dimensions.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    if (typeof source.close === "function") source.close();
    throw new Error("Could not create scan context.");
  }

  ctx.drawImage(source, 0, 0, width, height);
  if (typeof source.close === "function") source.close();

  const imgData = ctx.getImageData(0, 0, width, height);
  const result = jsQR(imgData.data, imgData.width, imgData.height, {
    inversionAttempts: "attemptBoth"
  });

  return result?.data?.trim() || "";
}
