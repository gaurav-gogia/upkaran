import { ROUTES, resolveRoute } from "../routes/router.js";

function kindToRoute(kind) {
  if (kind === "djvu") return ROUTES.DJVU;
  if (kind === "pdf") return ROUTES.PDF;
  if (kind === "image") return ROUTES.IMAGE;
  if (kind === "document" || kind === "data" || kind === "code") return ROUTES.CONTENT;
  return ROUTES.FILE;
}

export function decideDropRouting(entries = []) {
  const currentRoute = resolveRoute(entries);
  if (currentRoute !== ROUTES.MIXED) {
    return {
      route: currentRoute,
      selectedEntries: [],
      autoSelected: false,
      skippedCount: 0
    };
  }

  const buckets = new Map([
    [ROUTES.DJVU, []],
    [ROUTES.PDF, []],
    [ROUTES.IMAGE, []],
    [ROUTES.CONTENT, []],
    [ROUTES.FILE, []]
  ]);

  for (const entry of entries) {
    const route = kindToRoute(entry.kind);
    buckets.get(route)?.push(entry);
  }

  const routePriority = [ROUTES.DJVU, ROUTES.PDF, ROUTES.IMAGE, ROUTES.CONTENT, ROUTES.FILE];
  let winnerRoute = ROUTES.FILE;
  let winnerSize = -1;

  for (const route of routePriority) {
    const size = buckets.get(route)?.length ?? 0;
    if (size > winnerSize) {
      winnerRoute = route;
      winnerSize = size;
    }
  }

  const selectedEntries = buckets.get(winnerRoute) ?? [];
  return {
    route: winnerRoute,
    selectedEntries,
    autoSelected: selectedEntries.length > 0,
    skippedCount: Math.max(0, entries.length - selectedEntries.length)
  };
}
