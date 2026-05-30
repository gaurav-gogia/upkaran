function splitName(name = "output.bin") {
  const trimmed = `${name || "output.bin"}`.trim() || "output.bin";
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) {
    return { base: trimmed, ext: "bin" };
  }
  return {
    base: trimmed.slice(0, dot),
    ext: trimmed.slice(dot + 1)
  };
}

function sanitizeToken(value, fallback = "output") {
  const text = `${value ?? ""}`.trim();
  const cleaned = text.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function ensureExtension(name, ext) {
  const lower = name.toLowerCase();
  const wanted = `.${ext.toLowerCase()}`;
  if (lower.endsWith(wanted)) return name;
  return `${name}${wanted}`;
}

function dedupeName(name, seen) {
  if (!seen.has(name)) {
    seen.add(name);
    return name;
  }

  const parsed = splitName(name);
  let n = 2;
  while (true) {
    const next = `${parsed.base}-${n}.${parsed.ext}`;
    if (!seen.has(next)) {
      seen.add(next);
      return next;
    }
    n += 1;
  }
}

export function applyOutputNamingTemplate(outputs = [], options = {}) {
  const template = `${options.template || "{name}-{op}-{index}.{ext}"}`;
  const operation = sanitizeToken(options.operation || "output", "output");
  const profile = sanitizeToken(options.profile || "", "");
  const now = options.now instanceof Date ? options.now : new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;

  const seen = new Set();

  return outputs.map((item, i) => {
    const parsed = splitName(item?.name || `output-${i + 1}.pdf`);
    const ext = sanitizeToken(parsed.ext, "pdf").toLowerCase();
    const index = i + 1;

    let rendered = template
      .replace(/\{name\}/gi, sanitizeToken(parsed.base, `output-${index}`))
      .replace(/\{op\}/gi, operation)
      .replace(/\{index\}/gi, `${index}`)
      .replace(/\{ext\}/gi, ext)
      .replace(/\{date\}/gi, date)
      .replace(/\{time\}/gi, time)
      .replace(/\{profile\}/gi, profile);

    rendered = sanitizeToken(rendered, `output-${index}`);
    if (!/\.[A-Za-z0-9]+$/.test(rendered)) {
      rendered = ensureExtension(rendered, ext);
    }

    return {
      ...item,
      name: dedupeName(rendered, seen)
    };
  });
}
