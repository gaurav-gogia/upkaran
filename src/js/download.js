function makeLink(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function saveBlob(blob, fileName) {
  if (!(blob instanceof Blob)) {
    throw new Error("Expected a Blob for download.");
  }
  makeLink(blob, fileName);
}

export function saveMany(files) {
  for (const item of files) {
    if (item?.blob instanceof Blob && item?.name) {
      makeLink(item.blob, item.name);
    }
  }
}
