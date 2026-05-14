function normalizeOperations(operations = []) {
  if (!Array.isArray(operations) || operations.length === 0) {
    return [{ action: "forensics_inspection", status: "completed" }];
  }

  return operations.map((item) => ({
    action: item?.action || "operation",
    status: item?.status || "completed",
    note: item?.note || "",
    at: item?.at || new Date().toISOString(),
  }));
}

function metadataFromAnalysis(data = {}) {
  const metadata = {
    fileType: data._type || "unknown",
    kind: data.kind || "unknown",
    mimeType: data.mimeType || "application/octet-stream",
    sizeBytes: data.size || 0,
    lastModified: data.lastModified || null,
  };

  if (data._type === "pdf") {
    metadata.pageCount = data.pageCount ?? null;
    metadata.encrypted = Boolean(data.encrypted);
  }

  if (data._type === "image" && data.dims) {
    metadata.dimensions = {
      width: data.dims.width,
      height: data.dims.height,
    };
  }

  if (data._type === "zip" && data.zipData) {
    metadata.zip = {
      entries: data.zipData.totalEntries,
      totalUncompressedBytes: data.zipData.totalUncompressed,
      totalCompressedBytes: data.zipData.totalCompressed,
      compressionRatio: data.zipData.ratio,
    };
  }

  return metadata;
}

function analysisSummary(data = {}, extras = {}) {
  const summary = {
    hashes: data.hashes || {},
    metadata: metadataFromAnalysis(data),
  };

  if (extras.entropyProfile?.summary) {
    summary.entropy = {
      blockSize: extras.entropyProfile.blockSize,
      sampledBlocks: extras.entropyProfile.sampledBlocks,
      totalBlocks: extras.entropyProfile.totalBlocks,
      min: extras.entropyProfile.summary.min,
      mean: extras.entropyProfile.summary.mean,
      max: extras.entropyProfile.summary.max,
      highEntropyCount: extras.entropyProfile.summary.highEntropyCount,
      highEntropyThreshold: extras.entropyProfile.summary.highEntropyThreshold,
    };
  }

  return summary;
}

export function buildIntegrityReport(entry, analysisData, extras = {}) {
  const generatedAt = new Date().toISOString();
  const sourceName = analysisData?.name || entry?.name || "unknown";

  return {
    reportVersion: 1,
    generatedAt,
    source: {
      name: sourceName,
      sizeBytes: analysisData?.size ?? entry?.size ?? 0,
      mimeType: analysisData?.mimeType ?? entry?.type ?? "application/octet-stream",
      kind: analysisData?.kind ?? entry?.kind ?? "unknown",
    },
    analysis: analysisSummary(analysisData || {}, extras),
    operations: normalizeOperations(extras.operations),
  };
}

export function integrityReportToJsonBlob(report) {
  return new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
}

export function integrityReportToText(report) {
  const hashes = report?.analysis?.hashes || {};
  const metadata = report?.analysis?.metadata || {};
  const operations = Array.isArray(report?.operations) ? report.operations : [];

  const lines = [
    "Upkaran Integrity Report",
    "",
    `Generated: ${report?.generatedAt || ""}`,
    `Source: ${report?.source?.name || "unknown"}`,
    `Size: ${report?.source?.sizeBytes ?? 0} bytes`,
    `MIME: ${report?.source?.mimeType || "application/octet-stream"}`,
    `Kind: ${report?.source?.kind || "unknown"}`,
    "",
    "Hashes:",
    `- MD5: ${hashes.md5 || "n/a"}`,
    `- SHA-1: ${hashes.sha1 || "n/a"}`,
    `- SHA-256: ${hashes.sha256 || "n/a"}`,
    "",
    "Metadata:",
  ];

  for (const [key, value] of Object.entries(metadata)) {
    if (value && typeof value === "object") {
      lines.push(`- ${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`- ${key}: ${value ?? "n/a"}`);
    }
  }

  lines.push("", "Operations:");
  for (const op of operations) {
    lines.push(`- ${op.action} [${op.status}]${op.note ? ` - ${op.note}` : ""}`);
  }

  return lines.join("\n");
}
