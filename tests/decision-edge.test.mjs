import assert from "node:assert/strict";
import { decideFromProbe } from "../src/decide.js";
import { DEFAULT_SETTINGS } from "../src/constants.js";

function s(overrides = {}) {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

// blob: protocol never downloads
{
  const settings = s({ filtersEnabled: false });
  const url = "blob:https://example.com/abcd";
  const probeResult = {
    protocol: "blob:",
    contentType: "image/jpeg",
    href: url,
    src: url,
    single: true
  };
  const res = decideFromProbe({ url, settings, canProbe: true, probeResult });
  assert.equal(res.shouldDownload, false);
}

// non-included MIME with no extension stays filtered
{
  const settings = s({
    includeImages: false,
    includeVideo: false,
    includeAudio: false,
    includePdf: false,
    filtersEnabled: false
  });
  const url = "https://example.com/resource";
  const probeResult = {
    protocol: "https:",
    contentType: "video/mp4",
    href: url,
    src: "",
    single: false
  };
  const res = decideFromProbe({ url, settings, canProbe: true, probeResult });
  assert.equal(res.shouldDownload, false);
}

// trigger + dimension rules requires probe when no probe result
{
  const settings = s({
    triggerUrlSubstrings: ["download"],
    triggerBypassFilters: false,
    filtersEnabled: true,
    filters: {
      ...DEFAULT_SETTINGS.filters,
      minWidth: 100
    }
  });
  const url = "https://example.com/download?id=123";
  const res = decideFromProbe({ url, settings, canProbe: true, probeResult: null });
  assert.equal(res.shouldDownload, false);
  assert.equal(res.reason, "probe-needed");
}

console.log("decision-edge.test.mjs passed");
