import assert from "node:assert/strict";
import { markDuplicatesByUrl } from "../src/taskUtils.js";

{
  const entries = [
    { plan: { url: "https://a.test/file.jpg" }, id: "t1" },
    { plan: { url: "https://a.test/file.jpg" }, id: "t2" },
    { plan: { url: "https://b.test/file.jpg" }, id: "t3" }
  ];
  const marked = markDuplicatesByUrl(entries);
  assert.equal(marked[0].isDuplicate, false);
  assert.equal(marked[1].isDuplicate, true);
  assert.equal(marked[2].isDuplicate, false);
}

console.log("task-utils.test.mjs passed");
