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

console.log("task-pipeline.test.mjs passed");
