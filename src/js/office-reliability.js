const OFFICE_UNSUPPORTED = {
  doc: "legacy_word",
  ppt: "legacy_powerpoint",
  xls: "legacy_excel",
  odt: "odf_text",
  odp: "odf_presentation",
  ods: "odf_spreadsheet"
};

const OFFICE_SUPPORTED = new Set(["docx", "pptx", "xlsx"]);

export function classifyOfficeExtension(ext) {
  const normalized = `${ext || ""}`.toLowerCase();
  if (OFFICE_SUPPORTED.has(normalized)) {
    return { status: "supported", code: "office_ooxml" };
  }
  if (OFFICE_UNSUPPORTED[normalized]) {
    return { status: "unsupported", code: OFFICE_UNSUPPORTED[normalized] };
  }
  return { status: "other", code: "non_office" };
}

export function summarizeOfficeOutcomes(outcomes = []) {
  const total = outcomes.length;
  const success = outcomes.filter((item) => item.status === "success").length;
  const unsupported = outcomes.filter((item) => item.status === "unsupported").length;
  const error = outcomes.filter((item) => item.status === "error").length;

  return {
    total,
    success,
    unsupported,
    error,
    passRate: total > 0 ? success / total : 0
  };
}
