import assert from "node:assert/strict";
import { runDownload } from "../src/downloadOrchestrator.js";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { setupRunDownloadFixture } from "./helpers/run-download-fixture.mjs";
import { contentLengthForUrlFromMap } from "./helpers/size-filter-helpers.mjs";
import { withMutedConsole } from "./helpers/console-mute.mjs";

const tabs = [
  { id: 1, url: "https://blocked.com/a.jpg", windowId: 1 },
  { id: 2, url: "https://example.com/dup.jpg", windowId: 1 },
  { id: 3, url: "https://example.com/dup.jpg", windowId: 1 },
  { id: 4, url: "https://example.com/small.jpg", windowId: 1 }
];

const lengthMap = new Map([
  ["https://example.com/small.jpg", 50]
]);
const { storage } = setupRunDownloadFixture({
  tabs,
  sync: {
    ...DEFAULT_SETTINGS,
    filtersEnabled: true,
    autoCloseOnStart: false,
    closeTabAfterDownload: false,
    filters: {
      ...DEFAULT_SETTINGS.filters,
      blockedDomains: ["blocked.com"],
      minBytes: 100
    }
  },
  contentLengthForUrl: contentLengthForUrlFromMap(lengthMap, 1000)
});

await withMutedConsole(async () => {
  await runDownload({ mode: "currentWindow" });
});

const trace = storage.local.dmtLastRunTrace;
assert.equal(Boolean(trace), true);

const byTabId = new Map(trace.entries.map(e => [e.tabId, e]));
assert.equal(byTabId.get(1).decision, "filtered");
assert.equal(byTabId.get(1).reason, "filtered");

const dupEntry2 = byTabId.get(2);
const dupEntry3 = byTabId.get(3);
const dupReasons = [dupEntry2.reason, dupEntry3.reason].sort();
const dupDecisions = [dupEntry2.decision, dupEntry3.decision].sort();
assert.deepEqual(dupReasons, ["duplicate", "started"]);
assert.deepEqual(dupDecisions, ["download", "skipped"]);

assert.equal(byTabId.get(4).decision, "filtered");
assert.equal(byTabId.get(4).reason, "size-filter");

console.log("run-download-trace.test.mjs passed");
