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
    const trimmed = p.replace(/\/+$/, "");
    if (!trimmed) return null;
    const seg = trimmed.split("/").pop();
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

export function inferExtensionFromUrlHints(u, extSet) {
  if (!extSet || typeof extSet.has !== "function") return null;
  let url;
  try { url = new URL(u); } catch { return null; }

  const pickToken = (value) => {
    if (!value) return null;
    const tokens = String(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (extSet.has(t)) return t;
    }
    return null;
  };

  const preferredKeys = new Set([
    "format", "fmt", "type", "ext", "extension", "filetype", "mime", "mimetype", "auto"
  ]);

  for (const [key, value] of url.searchParams.entries()) {
    if (!preferredKeys.has(String(key).toLowerCase())) continue;
    const ext = pickToken(value);
    if (ext) return ext;
  }

  for (const [, value] of url.searchParams.entries()) {
    const ext = pickToken(value);
    if (ext) return ext;
  }

  const seg = lastPathSegment(url.toString());
  const segExt = seg ? pickToken(seg) : null;
  return segExt ? segExt : null;
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
  if (ctx.ext) {
    const ext = String(ctx.ext || "").replace(/^\.+/, "");
    if (ext) {
      const esc = ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const hasSameExt = new RegExp(`\\.${esc}$`, "i").test(out);
      if (!hasSameExt) out += `.${ext}`;
    }
  }
  return out;
}

export function absolutePrefer(src, href) {
  try { if (src) return new URL(src, href).toString(); } catch {}
  return href;
}
