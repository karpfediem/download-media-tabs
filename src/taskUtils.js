export function markDuplicatesByUrl(entries, getUrl = (e) => e?.plan?.url) {
  const seen = new Set();
  return entries.map(entry => {
    const url = getUrl(entry);
    const isDuplicate = !!(url && seen.has(url));
    if (url) seen.add(url);
    return { ...entry, isDuplicate };
  });
}
