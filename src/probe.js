export function probeDocument(strict = true, coverageThreshold = 0.5) {
  const out = {
    contentType: (document && document.contentType) || "",
    href: location.href,
    protocol: location.protocol,
    single: false,
    src: "",
    looksLikePdf: false,
    imageWidth: undefined,
    imageHeight: undefined
  };

  if (/^(image|video|audio)\//i.test(out.contentType)) {
    out.single = true;
    const img = document.querySelector("img");
    const vid = document.querySelector("video");
    const aud = document.querySelector("audio");
    if (img) {
      const nw = Number(img.naturalWidth) || 0;
      const nh = Number(img.naturalHeight) || 0;
      out.src = img.currentSrc || img.src || "";
      out.imageWidth  = nw > 0 ? nw : undefined;
      out.imageHeight = nh > 0 ? nh : undefined;
    } else if (vid) {
      const src = vid.currentSrc || (vid.querySelector("source") && vid.querySelector("source").src) || "";
      out.src = src;
    } else if (aud) {
      const src = aud.currentSrc || (aud.querySelector("source") && aud.querySelector("source").src) || "";
      out.src = src;
    }
    return out;
  }
  if (out.contentType === "application/pdf") {
    out.single = true;
    out.looksLikePdf = true;
    const emb = document.querySelector("embed, object");
    out.src = (emb && (emb.getAttribute("src") || "")) || "";
    return out;
  }

  try {
    const mediaSelector = "img, video, audio, embed, object";
    const mediaElems = Array.from(document.querySelectorAll(mediaSelector));
    if (!mediaElems.length) return out;

    const isPdfEmbed = (el) => {
      const type = (el.getAttribute("type") || "").toLowerCase();
      const src = (el.getAttribute("src") || "");
      return type.includes("pdf") || /\.pdf(?:[#?].*)?$/i.test(src);
    };

    if (!strict) {
      const bodyDirect = mediaElems.filter(el => el.parentElement === document.body);
      if (mediaElems.length === 1 && bodyDirect.length === 1) {
        const el = bodyDirect[0];
        out.single = true;
        out.looksLikePdf = el.tagName !== "IMG" && isPdfEmbed(el);
        out.src = srcFromMedia(el);
        if (el.tagName === "IMG") {
          const nw = Number(el.naturalWidth) || 0;
          const nh = Number(el.naturalHeight) || 0;
          out.imageWidth  = nw > 0 ? nw : undefined;
          out.imageHeight = nh > 0 ? nh : undefined;
        }
      }
      return out;
    }

    if (mediaElems.length !== 1) return out;
    const el = mediaElems[0];
    if (el.parentElement !== document.body) return out;

    const vpW = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const vpH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const vpArea = vpW * vpH;
    let coverage = 0;
    try {
      const r = el.getBoundingClientRect();
      const visW = Math.max(0, Math.min(r.width, vpW));
      const visH = Math.max(0, Math.min(r.height, vpH));
      coverage = (visW * visH) / vpArea;
    } catch {}

    if (coverage < Math.max(0, Math.min(1, coverageThreshold))) return out;

    out.single = true;
    out.looksLikePdf = (el.tagName !== "IMG") && isPdfEmbed(el);
    out.src = srcFromMedia(el);
    if (el.tagName === "IMG") {
      const nw = Number(el.naturalWidth) || 0;
      const nh = Number(el.naturalHeight) || 0;
      out.imageWidth  = nw > 0 ? nw : undefined;
      out.imageHeight = nh > 0 ? nh : undefined;
    }
  } catch {}
  return out;

  function srcFromMedia(el) {
    if (!el) return "";
    if (el.tagName === "IMG")   return el.currentSrc || el.src || "";
    if (el.tagName === "VIDEO") return el.currentSrc || (el.querySelector("source") && el.querySelector("source").src) || "";
    if (el.tagName === "AUDIO") return el.currentSrc || (el.querySelector("source") && el.querySelector("source").src) || "";
    if (el.tagName === "EMBED" || el.tagName === "OBJECT") {
      return el.getAttribute("data") || el.getAttribute("src") || "";
    }
    return "";
  }
}
