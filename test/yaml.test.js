/**
 * Minimal-YAML-subset parser tests: the constructs the prompt library schema
 * needs (nested maps, sequences incl. same-indent and inline-mapping items,
 * block scalars with the three chomping modes, quotes, comments) and the
 * loud syntax errors with line numbers.
 */
import { strict as assert } from "node:assert";
import test from "node:test";

import { parseYaml, YamlSyntaxError } from "../src/host/yaml.js";

function parse(text) {
  return parseYaml(text);
}

function assertSyntaxError(text, line, pattern) {
  assert.throws(
    () => parseYaml(text),
    (error) => {
      assert.ok(error instanceof YamlSyntaxError, `expected YamlSyntaxError, got ${error}`);
      if (line !== undefined) assert.equal(error.line, line);
      if (pattern !== undefined) assert.ok(pattern.test(error.message), error.message);
      return true;
    },
  );
}

test("parses the prompt-library document shape", () => {
  const value = parse(`
# leading comment
groups:
  - id: pr-review
    label: PR 评审
    prompts:
      - id: strict-review
        title: 严格审查
        body: |
          第一行
          第二行
`);
  assert.deepEqual(value, {
    groups: [
      {
        id: "pr-review",
        label: "PR 评审",
        prompts: [
          { id: "strict-review", title: "严格审查", body: "第一行\n第二行\n" },
        ],
      },
    ],
  });
});

test("supports sequences at the same indent as their key", () => {
  const value = parse("groups:\n- id: a\n  label: L\n- id: b\n  label: M\n");
  assert.deepEqual(value, {
    groups: [
      { id: "a", label: "L" },
      { id: "b", label: "M" },
    ],
  });
});

test("supports a nested block value under a key", () => {
  const value = parse("outer:\n  inner:\n    deep: 1\nsibling: 2\n");
  assert.deepEqual(value, { outer: { inner: { deep: "1" } }, sibling: "2" });
});

test("null values: bare key, key with comment, and end of document", () => {
  assert.deepEqual(parse("a:\nb: # comment\n"), { a: null, b: null });
  assert.deepEqual(parse("a:"), { a: null });
});

test("empty and comment-only documents parse to null", () => {
  assert.equal(parse(""), null);
  assert.equal(parse("\n\n# nothing\n\n"), null);
});

test("plain scalars: comments, hashes without space, colons", () => {
  assert.deepEqual(parse("a: x # trailing\nb: x#y\nc: 注意: 这个\nd: 42\n"), {
    a: "x",
    b: "x#y",
    c: "注意: 这个",
    d: "42",
  });
});

test("double-quoted scalars with escapes", () => {
  assert.deepEqual(parse('a: "x \\"y\\" \\n \\t \\\\ \\u4e2d"\nb: "plain # not comment"\n'), {
    a: "x \"y\" \n \t \\ 中",
    b: "plain # not comment",
  });
});

test("single-quoted scalars with '' escape", () => {
  assert.deepEqual(parse("a: 'it''s # fine'\n"), { a: "it's # fine" });
});

test("block scalars: clip, strip, keep", () => {
  assert.equal(parse("a: |\n  x\n").a, "x\n");
  assert.equal(parse("a: |-\n  x\n").a, "x");
  assert.equal(parse("a: |+\n  x\n\n").a, "x\n\n");
  // Interior blank lines survive; trailing ones obey the chomp.
  assert.equal(parse("a: |\n  x\n\n  y\n").a, "x\n\ny\n");
  assert.equal(parse("a: |-\n  x\n\n  y\n").a, "x\n\ny");
  // A dedented line ends the block; the next key parses normally.
  assert.deepEqual(parse("a: |\n  x\nb: 1\n"), { a: "x\n", b: "1" });
  // Comment-looking lines inside a block scalar are content.
  assert.equal(parse("a: |\n  # not a comment\n").a, "# not a comment\n");
  // A block with no content lines is the empty string.
  assert.equal(parse("a: |\nb: 1\n").a, "");
});

test("sequence items: scalars and nested sequences via bare dash", () => {
  assert.deepEqual(parse("list:\n  - one\n  - 'two'\n"), { list: ["one", "two"] });
  assert.deepEqual(parse("list:\n  -\n    k: v\n  -\n    k: w\n"), {
    list: [{ k: "v" }, { k: "w" }],
  });
});

test("syntax errors carry line numbers", () => {
  assertSyntaxError("groups:\n\t- id: x\n", 2, /tab/);
  assertSyntaxError("a: 1\n    b: 2\n", 2, /unexpected indentation/);
  assertSyntaxError("groups:\n  oops\n", 2, /expected "key: value"/);
  assertSyntaxError('a: "unterminated\n', 1, /unterminated double/);
  assertSyntaxError("a: 'unterminated\n", 1, /unterminated single/);
  assertSyntaxError("a: 1\na: 2\n", 2, /duplicate key "a"/);
  assertSyntaxError("a: [1, 2]\n", 1, /flow collections/);
  assertSyntaxError("a: {b: 1}\n", 1, /flow collections/);
  assertSyntaxError("---\n", 1, /document markers/);
  assertSyntaxError("a: 1\n- b\n", 2, /sequence entry .* inside a mapping/);
  assertSyntaxError("- a\nb: 1\n", 2, /expected a sequence entry/);
  assertSyntaxError("a: >\n  folded\n", 1, /unsupported block scalar/);
  assertSyntaxError("  a: 1\nb: 2\n", 2, /unexpected content/);
});

test("bad block-scalar indentation is a line-numbered error", () => {
  assertSyntaxError("body: |\n    deep\n  shallow\n", 3, /bad indentation in block scalar/);
});

test("multi-line documents split with \\r\\n work", () => {
  assert.deepEqual(parse("a: 1\r\nb:\r\n  - x\r\n"), { a: "1", b: ["x"] });
});

test("a leading UTF-8 BOM is stripped (plain and before a comment)", () => {
  assert.deepEqual(parse("\uFEFFa: 1\n"), { a: "1" });
  // A BOM in front of a first-line comment used to fail "key: value".
  assert.deepEqual(parse("\uFEFF# c\ngroups:\n"), { groups: null });
  assert.deepEqual(parse("\uFEFFa: |\uFEFF\n  x\n"), { a: "x\n" });
});

test("bare-CR (old-Mac) line endings fail loudly with a line number", () => {
  assertSyntaxError("a: 1\rb: 2\r", 1, /bare CR/);
  assertSyntaxError("a: 1\nb: 2\rc: 3\n", 2, /bare CR/);
});

test("hostile deep nesting is a line-numbered error, not a stack overflow", () => {
  const mapping = Array.from({ length: 5000 }, (_, i) => `${" ".repeat(i)}k${i}:\n`).join("");
  assertSyntaxError(mapping, undefined, /nesting deeper than/);
  const sequence = Array.from({ length: 5000 }, (_, i) => `${" ".repeat(i)}-\n`).join("");
  assertSyntaxError(sequence, undefined, /nesting deeper than/);
  // Sibling entries at one level do not accumulate depth: a long flat list parses.
  const flat = `l:\n${Array.from({ length: 300 }, (_, i) => `  - ${i}\n`).join("")}`;
  assert.equal(parse(flat).l.length, 300);
});

test("block scalar edges: EOF without newline, tab after indent, empty keep", () => {
  assert.equal(parse("a: |\n  x").a, "x\n");
  assert.equal(parse("a: |\n  x\n  \ty\n").a, "x\n\ty\n");
  assert.equal(parse("a: |+\n  x\n\n").a, "x\n\n");
});
