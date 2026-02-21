import assert from "node:assert/strict";
import { selectCandidateTabs } from "../src/selection.js";

let allTabs = [];
const currentWindowId = 1;

function setTabs(tabs) {
  allTabs = tabs.slice();
}

globalThis.chrome = {
  tabs: {
    query: async (query = {}) => {
      let tabs = allTabs.slice();
      if (query.windowId != null) {
        tabs = tabs.filter(t => t.windowId === query.windowId);
      }
      if (query.currentWindow) {
        tabs = tabs.filter(t => t.windowId === currentWindowId);
      }
      if (query.highlighted) {
        tabs = tabs.filter(t => t.highlighted);
      }
      if (typeof query.groupId === "number") {
        tabs = tabs.filter(t => t.groupId === query.groupId);
      }
      return tabs;
    }
  }
};

// allWindows returns all tabs
{
  setTabs([
    { id: 1, windowId: 1 },
    { id: 2, windowId: 2 }
  ]);
  const res = await selectCandidateTabs("allWindows");
  assert.equal(res.length, 2);
}

// selectedTabs uses highlighted tabs in current window
{
  setTabs([
    { id: 1, windowId: 1, highlighted: false },
    { id: 2, windowId: 1, highlighted: true },
    { id: 3, windowId: 1, highlighted: true },
    { id: 4, windowId: 2, highlighted: true }
  ]);
  const res = await selectCandidateTabs("selectedTabs");
  assert.deepEqual(res.map(t => t.id), [2, 3]);
}

// selectedTabs falls back to current window when none highlighted
{
  setTabs([
    { id: 10, windowId: 1, highlighted: false },
    { id: 11, windowId: 1, highlighted: false },
    { id: 12, windowId: 2, highlighted: true }
  ]);
  const res = await selectCandidateTabs("selectedTabs");
  assert.deepEqual(res.map(t => t.id), [10, 11]);
}

// left/right of active
{
  setTabs([
    { id: 20, windowId: 1, index: 0, active: false },
    { id: 21, windowId: 1, index: 1, active: false },
    { id: 22, windowId: 1, index: 2, active: true },
    { id: 23, windowId: 1, index: 3, active: false }
  ]);
  const left = await selectCandidateTabs("leftOfActive");
  const right = await selectCandidateTabs("rightOfActive");
  assert.deepEqual(left.map(t => t.id), [20, 21, 22]);
  assert.deepEqual(right.map(t => t.id), [22, 23]);
}

// currentGroup uses active tab group
{
  setTabs([
    { id: 30, windowId: 1, index: 0, active: true, groupId: 10 },
    { id: 31, windowId: 1, index: 1, active: false, groupId: 10 },
    { id: 32, windowId: 1, index: 2, active: false, groupId: 11 },
    { id: 33, windowId: 2, index: 0, active: false, groupId: 10 }
  ]);
  const res = await selectCandidateTabs("currentGroup");
  assert.deepEqual(res.map(t => t.id), [30, 31]);
}

// currentGroup returns [] when no active group
{
  setTabs([
    { id: 40, windowId: 1, index: 0, active: true, groupId: -1 },
    { id: 41, windowId: 1, index: 1, active: false, groupId: 5 }
  ]);
  const res = await selectCandidateTabs("currentGroup");
  assert.deepEqual(res, []);
}

console.log("selection.test.mjs passed");
