import assert from "node:assert/strict";
import { evaluateTabForPlan, createTaskEntriesFromEvaluated } from "../src/taskPipeline.js";
import { DEFAULT_SETTINGS } from "../src/constants.js";

function s(overrides = {}) {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

{
  const settings = s({ filtersEnabled: false });
  const tabs = [
    { id: 1, url: "https://a.test/file.jpg" },
    { id: 2, url: "https://b.test/page" }
  ];

  const decideFn = async (tab) => {
    if (tab.id === 1) {
      return {
        shouldDownload: true,
        downloadUrl: tab.url,
        suggestedExt: "jpg",
        mimeFromProbe: "image/jpeg"
      };
    }
    return { shouldDownload: false, reason: "filtered" };
  };

  const evaluated = [];
  for (const tab of tabs) {
    evaluated.push(await evaluateTabForPlan(tab, settings, decideFn));
  }

  const created = [];
  const createTask = async ({ tabId, url, kind }) => {
    const task = { id: `t${tabId}`, tabId, url, kind };
    created.push(task);
    return task;
  };

  const entries = await createTaskEntriesFromEvaluated(evaluated, createTask, "manual");
  assert.equal(entries.length, 1);
  assert.equal(created.length, 1);
  assert.equal(entries[0].task.id, "t1");
  assert.equal(entries[0].tab.id, 1);
}

{
  const settings = s({
    filtersEnabled: true,
    filters: { ...DEFAULT_SETTINGS.filters, blockedDomains: ["example.com"] }
  });
  const tab = { id: 3, url: "https://example.com/file.jpg" };
  const decideFn = async () => ({
    shouldDownload: true,
    downloadUrl: tab.url,
    suggestedExt: "jpg",
    mimeFromProbe: "image/jpeg"
  });
  const evaluated = await evaluateTabForPlan(tab, settings, decideFn);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.reason, "filtered");

  const created = [];
  const createTask = async ({ tabId, url, kind }) => {
    const task = { id: `t${tabId}`, tabId, url, kind };
    created.push(task);
    return task;
  };
  const entries = await createTaskEntriesFromEvaluated([evaluated], createTask, "manual");
  assert.equal(entries.length, 0);
  assert.equal(created.length, 0);
}

{
  const settings = s({
    filtersEnabled: false,
    includeImages: false,
    includeVideo: false,
    includeAudio: false,
    includePdf: false
  });
  const tab = { id: 4, url: "https://example.com/file.jpg" };
  const decideFn = async () => ({
    shouldDownload: true,
    downloadUrl: tab.url,
    suggestedExt: "jpg",
    mimeFromProbe: "image/jpeg"
  });
  const evaluated = await evaluateTabForPlan(tab, settings, decideFn);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.reason, "filtered");
}

{
  const settings = s({ filtersEnabled: false });
  const tab = { id: 7, url: "https://example.com/page" };
  const decideFn = async () => ({
    shouldDownload: true,
    downloadUrl: "https://cdn.example.com/file.jpg",
    suggestedExt: "jpg",
    mimeFromProbe: "image/jpeg"
  });
  const evaluated = await evaluateTabForPlan(tab, settings, decideFn);
  assert.equal(evaluated.ok, true);
  assert.equal(evaluated.plan.tabUrl, tab.url);
}

console.log("task-pipeline.test.mjs passed");
