import assert from "node:assert/strict";
import { decideFromProbe } from "../src/decide.js";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { planFromDecision } from "../src/plan.js";

function s(overrides = {}) {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

// 1) URL ends with .jpg, strict ON, canProbe=false -> download via URL/MIME fallback
{
  const settings = s({ strictSingleDetection: true, filtersEnabled: false });
  const url = "https://example.com/image.jpg";
  const res = decideFromProbe({ url, settings, canProbe: false, probeResult: null });
  assert.equal(res.shouldDownload, true);
  assert.equal(res.downloadUrl, url);
}

// 2) URL ends with .jpg, strict ON, probeResult.single=false -> do NOT download
{
  const settings = s({ strictSingleDetection: true, filtersEnabled: false });
  const url = "https://example.com/image.jpg";
  const probeResult = { single: false, href: url, src: "", contentType: "image/jpeg" };
  const res = decideFromProbe({ url, settings, canProbe: true, probeResult });
  assert.equal(res.shouldDownload, false);
}

// 3) URL hint format=webp with no extension -> download with suggestedExt webp
{
  const settings = s({
    inferExtensionFromUrl: true,
    inferUrlAllowedExtensions: ["webp"],
    filtersEnabled: false
  });
  const url = "https://example.com/file?format=webp";
  const res = decideFromProbe({ url, settings, canProbe: false, probeResult: null });
  assert.equal(res.shouldDownload, true);
  assert.equal(res.suggestedExt, "webp");
}

// 4) Trigger match + bypass ON -> download regardless of media type inclusion
{
  const settings = s({
    triggerUrlSubstrings: ["download"],
    triggerBypassFilters: true,
    includeImages: false,
    includeVideo: false,
    includeAudio: false,
    includePdf: false,
    filtersEnabled: true
  });
  const url = "https://example.com/download?id=123";
  const res = decideFromProbe({ url, settings, canProbe: false, probeResult: null });
  assert.equal(res.shouldDownload, true);
}

// 5) Trigger match + bypass OFF + blocked by filters -> no plan
{
  const settings = s({
    triggerUrlSubstrings: ["download"],
    triggerBypassFilters: false,
    filtersEnabled: true,
    filters: {
      ...DEFAULT_SETTINGS.filters,
      blockedDomains: ["example.com"]
    }
  });
  const url = "https://example.com/download?id=123";
  const res = decideFromProbe({ url, settings, canProbe: false, probeResult: null });
  assert.equal(res.shouldDownload, true);
  const plan = planFromDecision(res, settings, 1);
  assert.equal(plan, null);
}

// 6) Probe result contentType image/jpeg, single true, src set -> download src
{
  const settings = s({ strictSingleDetection: true, filtersEnabled: false });
  const url = "https://example.com/image.jpg";
  const probeResult = {
    single: true,
    href: url,
    src: "https://cdn.example.com/image.jpg",
    contentType: "image/jpeg",
    protocol: "https:"
  };
  const res = decideFromProbe({ url, settings, canProbe: true, probeResult });
  assert.equal(res.shouldDownload, true);
  assert.equal(res.downloadUrl, "https://cdn.example.com/image.jpg");
}

// 7) Probe result looksLikePdf -> download with suggestedExt pdf
{
  const settings = s({ strictSingleDetection: true, filtersEnabled: false });
  const url = "https://example.com/doc";
  const probeResult = {
    single: true,
    looksLikePdf: true,
    href: url,
    src: "",
    contentType: "application/pdf",
    protocol: "https:"
  };
  const res = decideFromProbe({ url, settings, canProbe: true, probeResult });
  assert.equal(res.shouldDownload, true);
  assert.equal(res.suggestedExt, "pdf");
}

// 8) Strict mode + no site access + no extension -> no-site-access
{
  const settings = s({ strictSingleDetection: true, inferExtensionFromUrl: false, filtersEnabled: false });
  const url = "https://example.com/resource";
  const res = decideFromProbe({ url, settings, canProbe: false, probeResult: null });
  assert.equal(res.shouldDownload, false);
  assert.equal(res.reason, "no-site-access");
}

console.log("decision.test.mjs passed");
