export function sizeWithin(bytes, minBytes, maxBytes) {
  if (minBytes > 0 && bytes < minBytes) return false;
  if (maxBytes > 0 && bytes > maxBytes) return false;
  return true;
}

export async function headContentLength(url, timeoutMs = 5000) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));

    const resp = await fetch(url, {
      method: "HEAD",
      cache: "no-cache",
      redirect: "follow",
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    const len = resp.headers.get("content-length");
    if (!len) return null;
    const n = parseInt(len, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
