export function sanitizeForPath(s) {
  return s.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 180);
}

export function yyyymmddHHMMss(date = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function lastPathSegment(u) {
  try {
    const url = new URL(u);
    const p = url.pathname;
    if (!p || p === "/") return null;
    const seg = p.split("/").pop();
    return seg || null;
  } catch {
    return null;
  }
}

export function extFromUrl(u) {
  const seg = lastPathSegment(u);
  if (!seg) return null;
  const m = /\.([A-Za-z0-9]+)$/.exec(seg.split("?")[0].split("#")[0]);
  return m ? m[1].toLowerCase() : null;
}

export function hostFromUrl(u) {
  try { return new URL(u).host || "unknown-host"; } catch { return "unknown-host"; }
}

export function buildFilename(pattern, ctx) {
  const stamp = yyyymmddHHMMss(ctx.date);
  let out = pattern;
  out = out.replaceAll("{YYYYMMDD-HHmmss}", stamp);
  out = out.replaceAll("{host}", sanitizeForPath(ctx.host));
  out = out.replaceAll("{basename}", sanitizeForPath(ctx.basename || "file"));
  if (ctx.ext && !/\.[A-Za-z0-9]{1,8}$/.test(out)) out += `.${ctx.ext}`;
  return out;
}

export function absolutePrefer(src, href) {
  try { if (src) return new URL(src, href).toString(); } catch {}
  return href;
}
