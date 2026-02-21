import assert from "node:assert/strict";
import { applyPreFilters } from "../src/filters.js";
import { DEFAULT_SETTINGS } from "../src/constants.js";

function f(overrides = {}) {
  return { ...DEFAULT_SETTINGS.filters, ...overrides };
}

function meta(overrides = {}) {
  return {
    url: "https://example.com/file.jpg",
    host: "example.com",
    ext: "jpg",
    mime: "image/jpeg",
    ...overrides
  };
}

// excludeUrlSubstrings blocks
{
  const filters = f({ excludeUrlSubstrings: ["deny"] });
  const res = applyPreFilters(meta({ url: "https://example.com/deny/file.jpg" }), filters);
  assert.equal(res.pass, false);
}

// includeUrlSubstrings requires a match
{
  const filters = f({ includeUrlSubstrings: ["allow"] });
  const res1 = applyPreFilters(meta({ url: "https://example.com/file.jpg" }), filters);
  const res2 = applyPreFilters(meta({ url: "https://example.com/allow/file.jpg" }), filters);
  assert.equal(res1.pass, false);
  assert.equal(res2.pass, true);
}

// blockedDomains and allowedDomains are suffix matches
{
  const blocked = f({ blockedDomains: ["example.com"] });
  const res = applyPreFilters(meta({ host: "sub.example.com" }), blocked);
  assert.equal(res.pass, false);

  const allowed = f({ allowedDomains: ["example.com"] });
  const resNo = applyPreFilters(meta({ host: "other.com" }), allowed);
  const resYes = applyPreFilters(meta({ host: "a.example.com" }), allowed);
  assert.equal(resNo.pass, false);
  assert.equal(resYes.pass, true);
}

// extension allow/deny lists
{
  const blocked = f({ blockedExtensions: ["jpg"] });
  const resBlocked = applyPreFilters(meta({ ext: "jpg" }), blocked);
  assert.equal(resBlocked.pass, false);

  const allowed = f({ allowedExtensions: ["png"] });
  const resNo = applyPreFilters(meta({ ext: "jpg", mime: "image/jpeg" }), allowed);
  const resYes = applyPreFilters(meta({ ext: "png", mime: "image/png" }), allowed);
  assert.equal(resNo.pass, false);
  assert.equal(resYes.pass, true);
}

// mime allow/deny lists
{
  const blocked = f({ blockedMime: ["image/*"] });
  const resBlocked = applyPreFilters(meta({ mime: "image/jpeg" }), blocked);
  assert.equal(resBlocked.pass, false);

  const allowed = f({ allowedMime: ["image/*"] });
  const resYes = applyPreFilters(meta({ mime: "image/jpeg" }), allowed);
  const resNo = applyPreFilters(meta({ mime: "video/mp4", ext: "mp4" }), allowed);
  assert.equal(resYes.pass, true);
  assert.equal(resNo.pass, false);
}

// dimension rules apply to images only
{
  const filters = f({ minWidth: 100 });
  const resMissing = applyPreFilters(meta({ width: undefined }), filters);
  const resTooSmall = applyPreFilters(meta({ width: 50 }), filters);
  const resOk = applyPreFilters(meta({ width: 150 }), filters);
  assert.equal(resMissing.pass, false);
  assert.equal(resTooSmall.pass, false);
  assert.equal(resOk.pass, true);

  const nonImage = applyPreFilters(meta({ ext: "mp4", mime: "video/mp4", width: undefined }), filters);
  assert.equal(nonImage.pass, true);
}

// megapixel rules
{
  const filters = f({ minMegapixels: 2 });
  const resLow = applyPreFilters(meta({ width: 1000, height: 1000 }), filters);
  const resOk = applyPreFilters(meta({ width: 2000, height: 1000 }), filters);
  assert.equal(resLow.pass, false);
  assert.equal(resOk.pass, true);
}

console.log("filters.test.mjs passed");
