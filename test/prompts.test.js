/**
 * Prompt library tests: default seeding on first use, per-request re-read,
 * path configuration sidecar (~ expansion, validation), loud YAML/validation
 * failures, route handlers (200 payloads and 400 mapping), and the
 * examples/prompts.yaml ↔ built-in default consistency.
 */
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_PROMPTS_YAML,
  PromptsError,
  expandPromptsPath,
  openPromptsLibrary,
} from "../src/host/prompts.js";
import {
  HttpError,
  ROUTE_PATHS,
  handleGetPrompts,
  handleGetPromptsConfig,
  handleSavePrompts,
  handleSetPromptsConfig,
} from "../src/host/routes.js";

const silentLogger = { warn: () => {} };

async function tempLibrary() {
  const dir = await mkdtemp(join(tmpdir(), "dsm-prompts-"));
  return openPromptsLibrary({
    defaultFile: join(dir, "prompts.yaml"),
    configFile: join(dir, "settings.json"),
    logger: silentLogger,
  });
}

const MINIMAL_LIBRARY = `groups:\n  - id: g\n    label: 组\n    prompts:\n      - id: p\n        title: 条\n        body: |\n          正文\n`;

test("expandPromptsPath: ~ expansion, absolute requirement, empty → null", () => {
  assert.equal(expandPromptsPath(null), null);
  assert.equal(expandPromptsPath(""), null);
  assert.equal(expandPromptsPath("  "), null);
  assert.equal(expandPromptsPath("~"), homedir());
  assert.equal(expandPromptsPath("~/x/y.yaml"), join(homedir(), "x/y.yaml"));
  assert.equal(expandPromptsPath("/a/b.yaml"), "/a/b.yaml");
  assert.throws(() => expandPromptsPath("relative.yaml"), /绝对路径/);
  assert.throws(() => expandPromptsPath(42), /字符串/);
});

test("first load on the default path seeds the built-in example library", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsm-seed-"));
  const file = join(dir, "prompts.yaml");
  const library = openPromptsLibrary({
    defaultFile: file,
    configFile: join(dir, "settings.json"),
    logger: silentLogger,
  });
  const result = await library.load();
  assert.equal(result.customized, false);
  assert.equal(result.file, file);
  // Three example groups (PR 评审 / 写笔记 / 代码学习).
  assert.deepEqual(
    result.groups.map((group) => group.id),
    ["pr-review", "note-taking", "code-study"],
  );
  assert.ok(result.groups[0].prompts.length >= 2);
  // The file now exists on disk with the exact built-in content.
  assert.equal(await readFile(file, "utf8"), DEFAULT_PROMPTS_YAML);
});

test("examples/prompts.yaml is identical to the built-in default", async () => {
  const example = await readFile(new URL("../examples/prompts.yaml", import.meta.url), "utf8");
  assert.equal(example, DEFAULT_PROMPTS_YAML);
});

test("load() re-reads the file on every call (edits are live)", async () => {
  const library = await tempLibrary();
  await library.load();
  const config = await library.getConfig();
  await writeFile(config.effectiveFile, MINIMAL_LIBRARY, "utf8");
  const next = await library.load();
  assert.deepEqual(
    next.groups.map((group) => group.prompts.map((prompt) => prompt.id)),
    [["p"]],
  );
});

test("a YAML syntax failure is a loud PromptsError with the line", async () => {
  const library = await tempLibrary();
  const config = await library.getConfig();
  await writeFile(config.effectiveFile, "groups:\n  - id: x\n   label: y\n", "utf8");
  await assert.rejects(
    () => library.load(),
    (error) => error instanceof PromptsError && /YAML 语法错误/.test(error.message) && /line 3/.test(error.message),
  );
});

test("schema violations are loud PromptsErrors", async () => {
  const library = await tempLibrary();
  const config = await library.getConfig();
  const cases = [
    ["groups:\n", /groups.*非空/],
    ["foo: 1\n", /未知.*顶层字段/],
    [
      "groups:\n  - id: g\n    label: 组\n    prompts:\n      - id: p\n        title: 条\n        body: \"\"\n",
      /body/,
    ],
    [
      "groups:\n  - id: g\n    label: 组\n    prompts:\n      - id: p\n        title: 条\n        body: x\n        extra: 1\n",
      /未知字段 "extra"/,
    ],
    [
      "groups:\n  - id: g\n    label: 组\n    prompts:\n      - id: p\n        title: 条\n        body: x\n      - id: p\n        title: 条2\n        body: y\n",
      /重复/,
    ],
  ];
  for (const [content, pattern] of cases) {
    await writeFile(config.effectiveFile, content, "utf8");
    await assert.rejects(
      () => library.load(),
      (error) => error instanceof PromptsError && pattern.test(error.message),
    );
  }
});

test("path configuration: set, persist, live switch, reset; missing file is loud", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsm-cfg-"));
  const library = openPromptsLibrary({
    defaultFile: join(dir, "default.yaml"),
    configFile: join(dir, "settings.json"),
    logger: silentLogger,
  });

  // Default state.
  let config = await library.getConfig();
  assert.equal(config.promptsFile, null);
  assert.equal(config.customized, false);

  // Set a custom path (round-trips through the sidecar).
  const custom = join(dir, "custom.yaml");
  config = await library.setConfig({ promptsFile: custom });
  assert.equal(config.promptsFile, custom);
  assert.equal(config.customized, true);
  assert.deepEqual(await library.getConfig(), config);

  // A configured path that does not exist is an explicit error (no junk file).
  await assert.rejects(
    () => library.load(),
    (error) => error instanceof PromptsError && /不存在/.test(error.message) && error.message.includes(custom),
  );
  const savedSettings = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
  assert.equal(savedSettings.promptsFile, custom);

  // Write the custom library; loads switch to it live.
  await writeFile(custom, MINIMAL_LIBRARY, "utf8");
  assert.equal((await library.load()).groups[0].id, "g");

  // ~ expansion is accepted and stored expanded.
  config = await library.setConfig({ promptsFile: "~/prompts-test-dsm.yaml" });
  assert.equal(config.promptsFile, join(homedir(), "prompts-test-dsm.yaml"));

  // Reset to default.
  config = await library.setConfig({ promptsFile: null });
  assert.equal(config.promptsFile, null);
  assert.equal(config.customized, false);

  // Invalid values are rejected without touching the sidecar.
  await assert.rejects(() => library.setConfig({ promptsFile: "relative.yaml" }), PromptsError);
  await assert.rejects(() => library.setConfig("nope"), PromptsError);
  await assert.rejects(() => library.setConfig({ promptsFile: 42 }), PromptsError);
});

test("route handlers: prompts GET payload and 400 mapping", async () => {
  assert.equal(ROUTE_PATHS.prompts, "/api/dsh-session-manager/prompts");
  assert.equal(ROUTE_PATHS.promptsConfig, "/api/dsh-session-manager/prompts/config");

  const library = await tempLibrary();
  const payload = await handleGetPrompts(library);
  assert.equal(payload.customized, false);
  assert.ok(Array.isArray(payload.groups));
  assert.ok(payload.groups.length > 0);

  const config = await library.getConfig();
  await writeFile(config.effectiveFile, "groups: [\n", "utf8");
  await assert.rejects(
    () => handleGetPrompts(library),
    (error) => error instanceof HttpError && error.status === 400 && /YAML 语法错误|unsupported/.test(error.message),
  );
});

test("route handlers: prompts config GET/POST contract", async () => {
  const library = await tempLibrary();
  let config = await handleGetPromptsConfig(library);
  assert.equal(config.promptsFile, null);
  assert.ok(config.defaultFile.endsWith("prompts.yaml"));

  const dir = await mkdtemp(join(tmpdir(), "dsm-route-"));
  const custom = join(dir, "lib.yaml");
  config = await handleSetPromptsConfig(library, { promptsFile: custom });
  assert.equal(config.promptsFile, custom);
  assert.deepEqual(await handleGetPromptsConfig(library), config);

  await assert.rejects(
    () => handleSetPromptsConfig(library, { promptsFile: "relative.yaml" }),
    (error) => error instanceof HttpError && error.status === 400,
  );
  await assert.rejects(
    () => handleSetPromptsConfig(library, "garbage"),
    (error) => error instanceof HttpError && error.status === 400,
  );
});

test("save(): editor writes round-trip through the subset parser", async () => {
  const library = await tempLibrary();
  await library.load(); // seed the default file
  const saved = await library.save({
    groups: [
      {
        id: "editor",
        label: "编辑器组: 冒号",
        prompts: [
          { id: "plain", title: "普通", body: "正文\n" },
          { id: "no-trailing", title: "无尾换行", body: "单行" },
          { id: "blank-line", title: "空行 # 井号", body: "第一段\n\n第二段\n" },
          { id: "keep", title: "多个尾换行", body: "结尾\n\n" },
          { id: "quoted", title: "含\"引号\"", body: "tab\t中间\n" },
        ],
      },
    ],
  });
  // The save result is the re-loaded library: identical content.
  assert.equal(saved.groups.length, 1);
  assert.equal(saved.groups[0].label, "编辑器组: 冒号");
  assert.deepEqual(
    saved.groups[0].prompts.map((prompt) => prompt.body),
    ["正文\n", "单行", "第一段\n\n第二段\n", "结尾\n\n", "tab\t中间\n"],
  );
  // The file on disk still parses (the next /p open reads the same thing).
  const reloaded = await library.load();
  assert.deepEqual(reloaded.groups, saved.groups);
  // The YAML text itself stays human-editable (block scalars, not escapes).
  const text = await readFile(saved.file, "utf8");
  assert.match(text, /body: \|-?\n\s+第一段\n\n\s+第二段/);
});

test("save(): invalid libraries are rejected without touching the file", async () => {
  const library = await tempLibrary();
  const before = await library.load();
  const beforeText = await readFile(before.file, "utf8");
  await assert.rejects(() => library.save({ groups: [] }), /groups/);
  await assert.rejects(
    () => library.save({ groups: [{ id: "g", label: "组", prompts: [{ id: "p", title: "t", body: "" }] }] }),
    /body/,
  );
  await assert.rejects(
    () => library.save({ groups: [{ id: "g", label: "组", prompts: [] }] }),
    /prompts/,
  );
  assert.equal(await readFile(before.file, "utf8"), beforeText);
});

test("route handler: prompts POST saves and maps validation failures to 400", async () => {
  const library = await tempLibrary();
  const saved = await handleSavePrompts(library, {
    groups: [{ id: "g", label: "组", prompts: [{ id: "p", title: "条", body: "正文\n" }] }],
  });
  assert.equal(saved.groups[0].prompts[0].body, "正文\n");
  await assert.rejects(
    () => handleSavePrompts(library, { groups: [] }),
    (error) => error instanceof HttpError && error.status === 400,
  );
});
