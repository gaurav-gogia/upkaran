import { classifyFiles, summarizeTypeTabs, typeTabLabel, TYPE_TABS } from "../js/detect.js";

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

export function resolveTypeTabs(allFiles) {
  return summarizeTypeTabs(allFiles || []);
}

export function routeToTypeTab(route) {
  switch (route) {
    case ROUTES.PDF:
    case ROUTES.DJVU:
      return TYPE_TABS.PDF;
    case ROUTES.IMAGE:
      return TYPE_TABS.IMAGE;
    case ROUTES.CONTENT:
      return TYPE_TABS.TEXT;
    case ROUTES.FILE:
      return TYPE_TABS.ARCHIVE;
    default:
      return "";
  }
}

export function routeWorkspaceTitle(route, tab) {
  if (tab) return `${typeTabLabel(tab)} Tools`;
  switch (route) {
    case ROUTES.PDF:
      return "PDF Tools";
    case ROUTES.DJVU:
      return "DjVu Tools";
    case ROUTES.IMAGE:
      return "Image Tools";
    case ROUTES.FILE:
      return "File Tools";
    case ROUTES.CONTENT:
      return "Content Tools";
    case ROUTES.MIXED:
      return "Choose a File Type";
    default:
      return "Upkaran Workspace";
  }
}
