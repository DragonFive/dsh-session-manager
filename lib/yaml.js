/**
 * Minimal YAML subset parser for the prompt library (design.md §3.3).
 *
 * The zero-runtime-dependency rule (P1) rules out js-yaml / yaml — under
 * pnpm's strict isolation a transitive dependency is not importable from the
 * plugin's host entry, and adding a real dependency would break the
 * dependency-free `file:` install. So we hand-roll exactly the subset the
 * library schema needs:
 *
 * - nested mappings (`key: value`, one key per line, indentation-scoped);
 * - block sequences (`- item`, including `- key: value` inline mapping
 *   starts, and sequences at the same indent as their parent key);
 * - literal block scalars (`|` clip, `|-` strip, `|+` keep);
 * - quoted scalars ("..." with \" \\ \n \t \r \uXXXX, '...' with '' escape);
 * - plain scalars with trailing ` # comment` stripping;
 * - full-line comments and blank lines (except inside block scalars);
 * - a leading UTF-8 BOM (stripped) and CRLF line endings.
 *
 * Everything else — flow collections, anchors, aliases, tags, multi-document
 * markers, folded `>` scalars, tabs in indentation, bare-CR line endings,
 * nesting deeper than MAX_NESTING_DEPTH — fails loudly with a line number
 * instead of being silently misparsed (or blowing the stack).
 *
 * @module dsh-session-manager/yaml
 */

/** Syntax error with the 1-based line it was detected on. */
export class YamlSyntaxError extends Error {
  /**
   * @param {string} message
   * @param {number} [line] 1-based line number
   */
  constructor(message, line) {
    super(line === undefined ? message : `line ${line}: ${message}`);
    this.name = "YamlSyntaxError";
    this.line = line;
  }
}

/**
 * Nesting deeper than this is a YamlSyntaxError, not a RangeError: the
 * recursive descent would otherwise overflow the call stack on hostile
 * input (~1k levels), surfacing as a 500 instead of a 400. The library
 * schema needs depth 5; 100 leaves generous headroom.
 */
const MAX_NESTING_DEPTH = 100;

/**
 * Parse a YAML subset document into plain JS values
 * (string | null | plain object | array).
 * @param {string} text
 */
export function parseYaml(text) {
  if (typeof text !== "string") {
    throw new YamlSyntaxError("input must be a string");
  }
  // Windows editors prepend a UTF-8 BOM; strip it so "\uFEFFgroups:" does not
  // become a mystery key (a BOM before a first-line comment would otherwise
  // even fail the "key: value" check).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // A bare CR (old-Mac line ending) is not split by /\r?\n/ and would be
  // silently folded into one giant line; reject it loudly instead.
  const bareCr = /\r(?!\n)/u.exec(text);
  if (bareCr !== null) {
    const line = text.slice(0, bareCr.index).split(/\r?\n/).length;
    throw new YamlSyntaxError(
      "bare CR (\\r) line endings are not supported; use LF or CRLF",
      line,
    );
  }
  const split = text.split(/\r?\n/);
  // A trailing "\n" produces a phantom empty element; drop it so block-scalar
  // chomping ("|+") counts only real blank lines.
  if (split.length > 0 && split[split.length - 1] === "") split.pop();
  const lines = split.map((raw, index) => ({ raw, no: index + 1 }));
  const state = { lines, pos: 0, depth: 0 };

  const first = nextContent(state);
  if (first === null) return null; // empty (or comment-only) document
  const value = parseBlock(state, first.indent);
  const rest = nextContent(state);
  if (rest !== null) {
    throw new YamlSyntaxError(`unexpected content (bad indentation?)`, rest.line.no);
  }
  return value;
}

/** Advance past blank/comment lines; the next content entry (not consumed). */
function nextContent(state) {
  while (state.pos < state.lines.length) {
    const entry = state.lines[state.pos];
    const { indent, content } = measure(entry);
    if (content === "---" || content === "..." || content.startsWith("%")) {
      throw new YamlSyntaxError("document markers (--- / ...) and %directives are not supported", entry.no);
    }
    if (content === "" || content.startsWith("#")) {
      state.pos += 1;
      continue;
    }
    return { line: entry, indent, content };
  }
  return null;
}

/** Split one raw line into (indent, content); rejects tab indentation. */
function measure(entry) {
  const raw = entry.raw;
  const spaces = /^ */.exec(raw)[0];
  if (raw[spaces.length] === "\t") {
    throw new YamlSyntaxError("tab characters are not allowed in indentation", entry.no);
  }
  const content = raw.slice(spaces.length);
  return { indent: spaces.length, content: content.trim() === "" ? "" : content };
}

function startsSequence(content) {
  return content === "-" || content.startsWith("- ");
}

/** Parse the block starting at `state.pos`, whose first line sits at `indent`. */
function parseBlock(state, indent) {
  state.depth += 1;
  if (state.depth > MAX_NESTING_DEPTH) {
    throw new YamlSyntaxError(
      `nesting deeper than ${MAX_NESTING_DEPTH} levels is not supported`,
      state.lines[state.pos]?.no,
    );
  }
  try {
    const { content } = measure(state.lines[state.pos]);
    if (startsSequence(content)) return parseSequence(state, indent);
    return parseMapping(state, indent);
  } finally {
    state.depth -= 1;
  }
}

/** `key: value` lines at exactly `indent`; a nested block value is deeper. */
function parseMapping(state, indent) {
  const result = {};
  for (;;) {
    const next = nextContent(state);
    if (next === null || next.indent < indent) return result;
    if (next.indent > indent) {
      throw new YamlSyntaxError(`unexpected indentation (expected ${indent} spaces)`, next.line.no);
    }
    if (startsSequence(next.content)) {
      throw new YamlSyntaxError('unexpected sequence entry ("- ...") inside a mapping', next.line.no);
    }
    const { line, content } = next;
    state.pos += 1;
    const split = splitKey(content);
    if (split === null) {
      throw new YamlSyntaxError('expected "key: value"', line.no);
    }
    if (Object.hasOwn(result, split.key)) {
      throw new YamlSyntaxError(`duplicate key "${split.key}"`, line.no);
    }
    result[split.key] = parseValue(state, split.rest, indent, line.no);
  }
}

/** `- item` lines at exactly `indent`. */
function parseSequence(state, indent) {
  const result = [];
  for (;;) {
    const next = nextContent(state);
    if (next === null || next.indent < indent) return result;
    if (next.indent > indent) {
      throw new YamlSyntaxError(`unexpected indentation (expected ${indent} spaces)`, next.line.no);
    }
    const { line, content } = next;
    if (!startsSequence(content)) {
      throw new YamlSyntaxError('expected a sequence entry ("- ...")', line.no);
    }
    state.pos += 1;
    if (content === "-") {
      // Bare dash: nested block on the following lines (or a null item).
      const lookahead = nextContent(state);
      if (lookahead === null || lookahead.indent <= indent) {
        result.push(null);
        continue;
      }
      result.push(parseBlock(state, lookahead.indent));
      continue;
    }
    // "- something": re-anchor the item at its virtual column so the same
    // mapping/block parser handles "- key: value" continuation lines.
    const after = content.slice(1);
    const lead = /^ */.exec(after)[0].length;
    const virtualIndent = indent + 1 + lead;
    const item = after.slice(lead);
    const isMappingItem =
      item !== "" &&
      item[0] !== '"' &&
      item[0] !== "'" &&
      item[0] !== "[" &&
      item[0] !== "{" &&
      splitKey(stripTrailingComment(item)) !== null;
    if (!isMappingItem) {
      result.push(parseValue(state, item, indent, line.no));
      continue;
    }
    state.pos -= 1;
    state.lines[state.pos] = { raw: `${" ".repeat(virtualIndent)}${item}`, no: line.no };
    result.push(parseBlock(state, virtualIndent));
  }
}

/**
 * Split "key: rest" (plain keys only — schema keys are identifiers).
 * Returns null when the line is not a mapping entry.
 */
function splitKey(content) {
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] !== ":") continue;
    const after = content[i + 1];
    if (after === undefined || after === " ") {
      const key = content.slice(0, i).trim();
      if (key === "") return null;
      return { key, rest: content.slice(i + 1).trim() };
    }
  }
  return null;
}

/**
 * Parse one mapping value: inline scalar, block scalar header, or a nested
 * block on the following lines. `parentIndent` is the key line's indent.
 */
function parseValue(state, rest, parentIndent, keyLineNo) {
  let inline = rest;
  if (rest !== "" && rest[0] !== '"' && rest[0] !== "'") {
    inline = stripTrailingComment(rest).trim();
  }
  if (inline === "") {
    // `key:` — nested block, same-indent sequence, or null.
    const lookahead = nextContent(state);
    if (lookahead === null || lookahead.indent < parentIndent) return null;
    if (lookahead.indent === parentIndent) {
      return startsSequence(lookahead.content) ? parseSequence(state, parentIndent) : null;
    }
    return parseBlock(state, lookahead.indent);
  }
  if (inline[0] === '"' || inline[0] === "'") {
    return parseQuoted(inline, keyLineNo);
  }
  if (inline[0] === "|" || inline[0] === ">") {
    if (inline === "|" || inline === "|-" || inline === "|+") {
      return parseBlockScalar(state, inline, parentIndent);
    }
    throw new YamlSyntaxError(
      `unsupported block scalar header "${inline.split(/\s+/)[0]}" (only "|", "|-" and "|+" are supported)`,
      keyLineNo,
    );
  }
  if (inline[0] === "[" || inline[0] === "{") {
    throw new YamlSyntaxError("flow collections ([...] and {...}) are not supported", keyLineNo);
  }
  return inline;
}

/** Literal block scalar: collect raw lines indented deeper than the key. */
function parseBlockScalar(state, header, parentIndent) {
  const chomp = header === "|-" ? "strip" : header === "|+" ? "keep" : "clip";
  const collected = [];
  let contentIndent = -1;
  let contentLines = 0;
  while (state.pos < state.lines.length) {
    const entry = state.lines[state.pos];
    // Lenient scan: inside a block scalar a tab after the block indent is
    // legitimate content, so indentation is counted as leading spaces only.
    const spaces = /^ */.exec(entry.raw)[0].length;
    const content = entry.raw.slice(spaces);
    if (content.trim() === "") {
      collected.push("");
      state.pos += 1;
      continue;
    }
    if (spaces <= parentIndent) break;
    if (contentIndent === -1) contentIndent = spaces;
    if (spaces < contentIndent) {
      throw new YamlSyntaxError(`bad indentation in block scalar (expected ${contentIndent} spaces)`, entry.no);
    }
    collected.push(entry.raw.slice(contentIndent));
    contentLines += 1;
    state.pos += 1;
  }
  if (contentLines === 0) return "";
  let text = collected.map((line) => `${line}\n`).join("");
  if (chomp === "strip") return text.replace(/\n+$/u, "");
  if (chomp === "keep") return text;
  return `${text.replace(/\n+$/u, "")}\n`;
}

/** Quoted scalar (single or double). */
function parseQuoted(rest, lineNo) {
  const quote = rest[0];
  let value = "";
  let i = 1;
  while (i < rest.length) {
    const ch = rest[i];
    if (quote === "'") {
      if (ch === "'") {
        if (rest[i + 1] === "'") {
          value += "'";
          i += 2;
          continue;
        }
        break; // closing quote
      }
      value += ch;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      const esc = rest[i + 1];
      if (esc === undefined) throw new YamlSyntaxError("unterminated escape sequence", lineNo);
      if (esc === "n") value += "\n";
      else if (esc === "t") value += "\t";
      else if (esc === "r") value += "\r";
      else if (esc === '"') value += '"';
      else if (esc === "\\") value += "\\";
      else if (esc === "u") {
        const hex = rest.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/u.test(hex)) {
          throw new YamlSyntaxError("invalid \\u escape (need 4 hex digits)", lineNo);
        }
        value += String.fromCharCode(Number.parseInt(hex, 16));
        i += 6;
        continue;
      } else {
        throw new YamlSyntaxError(`unsupported escape "\\${esc}"`, lineNo);
      }
      i += 2;
      continue;
    }
    if (ch === '"') break; // closing quote
    value += ch;
    i += 1;
  }
  if (i >= rest.length) {
    throw new YamlSyntaxError(`unterminated ${quote === "'" ? "single" : "double"}-quoted string`, lineNo);
  }
  const tail = rest.slice(i + 1).trim();
  if (tail !== "" && !tail.startsWith("#")) {
    throw new YamlSyntaxError("unexpected content after the closing quote", lineNo);
  }
  return value;
}

/** Strip a trailing ` # comment` from a plain scalar (never called on quotes). */
function stripTrailingComment(s) {
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "#" && (i === 0 || s[i - 1] === " ")) return s.slice(0, i);
  }
  return s;
}
