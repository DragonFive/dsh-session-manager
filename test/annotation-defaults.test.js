/**
 * Effective annotation defaults: unannotated sessions read 待办/一般 in
 * every board view; annotated sessions keep their own values; custom
 * taxonomies without the default ids fall back to the first entry.
 */
import { strict as assert } from "node:assert";
import test from "node:test";

import {
  DEFAULT_PRIORITY_ID,
  DEFAULT_STATUS_ID,
  effectivePriorityId,
  effectiveStatusId,
} from "../src/client/annotation-defaults.js";

const DEFAULT_TAXONOMY = {
  categories: [],
  tags: [],
  statuses: [
    { id: "todo", label: "待办" },
    { id: "doing", label: "进行中" },
    { id: "done", label: "完成" },
  ],
  priorities: [
    { id: "urgent", label: "紧急" },
    { id: "important", label: "重要" },
    { id: "normal", label: "一般" },
  ],
};

test("unannotated sessions default to todo/normal", () => {
  assert.equal(effectiveStatusId(null, DEFAULT_TAXONOMY), "todo");
  assert.equal(effectivePriorityId(null, DEFAULT_TAXONOMY), "normal");
  assert.equal(effectiveStatusId(undefined, DEFAULT_TAXONOMY), DEFAULT_STATUS_ID);
  assert.equal(effectivePriorityId(undefined, DEFAULT_TAXONOMY), DEFAULT_PRIORITY_ID);
  // A missing taxonomy still resolves the built-in defaults.
  assert.equal(effectiveStatusId(null, undefined), "todo");
  assert.equal(effectivePriorityId(null, undefined), "normal");
});

test("an annotation's own status/priority always win", () => {
  assert.equal(effectiveStatusId({ status: "done", priority: "urgent" }, DEFAULT_TAXONOMY), "done");
  assert.equal(effectivePriorityId({ status: "done", priority: "urgent" }, DEFAULT_TAXONOMY), "urgent");
  // Even when the taxonomy no longer knows the id, the stored value is
  // reported as-is (the board renders the raw id as the label fallback).
  assert.equal(effectiveStatusId({ status: "legacy" }, DEFAULT_TAXONOMY), "legacy");
});

test("custom taxonomies without the default id fall back to the first entry", () => {
  const custom = {
    statuses: [{ id: "open", label: "打开" }],
    priorities: [{ id: "low", label: "低" }, { id: "high", label: "高" }],
  };
  assert.equal(effectiveStatusId(null, custom), "open");
  assert.equal(effectivePriorityId(null, custom), "low");
  // Empty lists keep the built-in defaults rather than undefined.
  assert.equal(effectiveStatusId(null, { statuses: [], priorities: [] }), "todo");
  assert.equal(effectivePriorityId(null, { statuses: [], priorities: [] }), "normal");
});
