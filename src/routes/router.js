import { classifyFiles } from "../js/detect.js";

export const ROUTES = {
  EMPTY: "empty",
  DJVU: "djvu",
  PDF: "pdf",
  IMAGE: "image",
  FILE: "file",
  CONTENT: "content",
  MIXED: "mixed"
};

export function resolveRoute(files) {
  if (!files || files.length === 0) {
    return ROUTES.EMPTY;
  }

  const summary = classifyFiles(files);
  if (summary.djvuCount === files.length) {
    return ROUTES.DJVU;
  }

  if (summary.pdfCount === files.length) {
    return ROUTES.PDF;
  }

  if (summary.imageCount === files.length) {
    return ROUTES.IMAGE;
  }

  if (summary.otherCount === files.length) {
    return ROUTES.FILE;
  }

  if (summary.contentCount === files.length) {
    return ROUTES.CONTENT;
  }

  return ROUTES.MIXED;
}

export function resolveRouteFromSelection(allFiles, selectedFiles) {
  const activeFiles = selectedFiles && selectedFiles.length > 0 ? selectedFiles : allFiles;
  return {
    activeFiles,
    route: resolveRoute(activeFiles)
  };
}
