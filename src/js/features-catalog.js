export const FEATURE_GROUPS = [
  {
    title: "PDF",
    status: "Available",
    bestFor: "Document workflows",
    pickerAccept: ".pdf,application/pdf",
    action: { type: "picker", accept: ".pdf,application/pdf" },
    cta: "Try PDF tools",
    items: [
      "Merge PDFs with drag reorder",
      "Split per page or custom groups",
      "Extract pages by range",
      "Remove pages by range",
      "Rotate selected pages",
      "Add page numbers",
      "Compress PDF",
      "PDF to images",
      "PDF to DjVu",
      "Unlock / remove PDF restrictions",
      "Lock PDF with password"
    ]
  },
  {
    title: "Images",
    status: "Available",
    bestFor: "Batch optimization",
    pickerAccept: "image/*,.heic,.heif",
    action: { type: "picker", accept: "image/*,.heic,.heif" },
    cta: "Try Image tools",
    items: [
      "Compress selected images",
      "Convert format (PNG/JPEG/WebP/AVIF)",
      "Images to DjVu",
      "Interactive crop with resize handles",
      "Batch crop using normalized selection",
      "Supports common formats including HEIC"
    ]
  },
  {
    title: "DjVu",
    status: "Available",
    bestFor: "Archive conversion",
    pickerAccept: ".djvu,image/vnd.djvu,application/vnd.djvu,application/x-djvu",
    action: { type: "picker", accept: ".djvu,image/vnd.djvu,application/vnd.djvu,application/x-djvu" },
    cta: "Try DjVu tools",
    items: [
      "DjVu to PDF",
      "DjVu to images",
      "Fully in-browser conversion"
    ]
  },
  {
    title: "Content to PDF",
    status: "Available",
    bestFor: "Docs and source files",
    pickerAccept: ".txt,.rtf,.md,.docx,.pptx,.xlsx,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.js,.ts,.py,.go,.java,.rb,.rs,.c,.cpp,.h,.sh,.css,.sql",
    action: { type: "picker", accept: ".txt,.rtf,.md,.docx,.pptx,.xlsx,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.js,.ts,.py,.go,.java,.rb,.rs,.c,.cpp,.h,.sh,.css,.sql" },
    cta: "Try Content tools",
    items: [
      "DOCX, PPTX, XLSX to PDF",
      "TXT, RTF, Markdown to PDF",
      "CSV / TSV table to PDF",
      "JSON, YAML, XML to PDF",
      "Source code with syntax highlighting to PDF",
      "HTML / SVG to PDF"
    ]
  },
  {
    title: "Files",
    status: "Available",
    bestFor: "Packaging",
    pickerAccept: "",
    action: { type: "picker", accept: "" },
    cta: "Try File tools",
    items: [
      "GZIP single file",
      "ZIP batch",
      "TAR batch"
    ]
  },
  {
    title: "P2P Transfer",
    status: "Available",
    bestFor: "Device-to-device sharing",
    pickerAccept: "",
    action: { type: "p2p" },
    cta: "Open P2P Transfer",
    p2pCta: true,
    items: [
      "Browser-to-browser file bytes (no file upload server)",
      "8-character quick connect code plus QR/token fallback",
      "Chunked transfer with SHA-256 verify",
      "Works on the same local network"
    ]
  },
  {
    title: "Workflow",
    status: "Guidance",
    bestFor: "Operational confidence",
    pickerAccept: "",
    action: { type: "history" },
    cta: "Open activity",
    items: [
      "Multi-select with shift range",
      "Drag reorder in file list",
      "Mixed selection modal",
      "Offline processing in browser"
    ]
  }
];

export const SHOWCASE_SUGGESTED_FEATURES = [
  {
    title: "Smart PDF starter",
    description: "Start PDF workflows instantly on-device for split, merge, compression, and page edits.",
    tag: "Most used",
    confidence: "Stable",
    action: { type: "picker", accept: ".pdf,application/pdf" },
    cta: "Start with PDF"
  },
  {
    title: "Image optimization lane",
    description: "Batch-convert and compress image sets locally with minimal setup.",
    tag: "Recommended",
    confidence: "Stable",
    action: { type: "picker", accept: "image/*,.heic,.heif" },
    cta: "Start with Images"
  },
  {
    title: "Text diff from keyboard",
    description: "Compare plain text instantly without file upload or cloud round-trips.",
    tag: "Power feature",
    confidence: "Stable",
    action: { type: "textdiff" },
    cta: "Open Text Diff"
  },
  {
    title: "Create with LaTeX",
    description: "Write equation-first documents locally and export polished PDFs.",
    tag: "Create",
    confidence: "Advanced",
    action: { type: "create", editor: "latex" },
    cta: "Open LaTeX Workspace"
  },
  {
    title: "Visual diagrams to PDF",
    description: "Build architecture diagrams in Mermaid and export to PDF offline.",
    tag: "Create",
    confidence: "Advanced",
    action: { type: "create", editor: "mermaid" },
    cta: "Open Mermaid Workspace"
  },
  {
    title: "P2P send and receive",
    description: "Share files directly between devices with browser-to-browser transfer and no central storage.",
    tag: "Collaboration",
    confidence: "Stable",
    action: { type: "p2p" },
    cta: "Open P2P"
  }
];

export const SHOWCASE_PLANNED_FEATURES = [
  {
    title: "Preset recipes",
    description: "Save repeatable multi-step operations for common workflows.",
    eta: "Planned",
    impact: "Speed"
  },
  {
    title: "Batch queue monitor",
    description: "Track long-running jobs with clearer progress and completion summaries.",
    eta: "Planned",
    impact: "Visibility"
  },
  {
    title: "Workspace templates",
    description: "Start from preconfigured intake and output settings for team standards.",
    eta: "Exploring",
    impact: "Consistency"
  }
];
