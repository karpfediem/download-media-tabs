export function contentLengthForUrlFromMap(map, defaultLen = null) {
  return (url) => {
    const key = String(url || "");
    if (map && map.has(key)) return map.get(key);
    return defaultLen;
  };
}

export async function setupPostDownloadSizeConstraint({
  setPendingSizeConstraint,
  searchResults,
  downloadId,
  minBytes = 0,
  maxBytes,
  fileSize
}) {
  await setPendingSizeConstraint(downloadId, { minBytes, maxBytes });
  if (searchResults) {
    const size = Number.isFinite(fileSize) ? fileSize : (maxBytes || 0) + 1;
    searchResults.set(downloadId, [{ id: downloadId, fileSize: size, bytesReceived: size }]);
  }
}
