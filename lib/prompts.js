/**
 * Prompt library (P2): YAML file storage, loading, and path configuration.
 *
 * - Library file: `groups → [{id, label, prompts: [{id, title, body}]}]`
 *   (design.md §3.3). Parsed by the hand-rolled subset parser in yaml.js and
 *   validated here — an invalid library is a loud error (PRD R1.2), never a
 *   silent fallback.
 * - Every `load()` re-reads the file (PRD R1.3): edits land on the next
 *   `/prompt` open without a restart.
 * - First run on the DEFAULT path seeds it with the built-in example library
 *   (the same content as `examples/prompts.yaml`); a configured custom path
 *   that does not exist is an explicit error instead of a junk file.
 * - The path override lives in the plugin's own sidecar (`settings.json`
 *   next to annotations.json) and is read per request, so Settings-card
 *   edits are live (PRD R3.1 / AC5).
 *
 * @module dsh-session-manager/prompts
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute } from "node:path";
import { ValidationError } from "./schema.js";
import { parseYaml, YamlSyntaxError } from "./yaml.js";

/** The built-in example library (identical to examples/prompts.yaml). */
export const DEFAULT_PROMPTS_YAML = `# dsh-session-manager 提示词库
#
# 结构：groups → [{id, label, prompts: [{id, title, body}]}]
# - id 在组内唯一（建议小写字母、数字、连字符）；label / title 是显示名
# - body 用 \`|\` 块标量书写（结尾保留一个空行），\`|-\` 表示结尾不带空行
# - 支持的语法子集：嵌套 map、列表、块标量、# 注释、引号字符串
# - 保存后下次打开 /prompt 即生效，无需重启 dsh

groups:
  - id: pr-review
    label: PR 评审
    prompts:
      - id: strict-review
        title: 严格审查
        body: |
          请作为资深代码评审者，严格审查本次变更：
          1. 正确性：边界条件、并发、错误处理是否有漏洞；
          2. 可维护性：命名、结构、重复代码；
          3. 性能：是否存在不必要的拷贝、复杂度退化；
          4. 测试：变更是否附带足够的测试覆盖。
          请按严重程度（阻断 / 重要 / 建议）分组输出问题清单，并给出具体修改建议。
      - id: teaching-review
        title: 教学式审查
        body: |
          请以教学的方式评审本次变更：
          - 先用两三句话概括这段代码做了什么；
          - 逐段讲解值得学习的写法，并解释背后的原理；
          - 指出可以改进的地方，说明「为什么」以及「怎么改」；
          - 最后给出一道练习题，帮助我巩固本次学到的知识点。
  - id: note-taking
    label: 写笔记
    prompts:
      - id: meeting-notes
        title: 整理会议纪要
        body: |
          请把下面的内容整理成结构化会议纪要：
          1. 一句话摘要；2. 关键结论（带负责人）；3. 待办事项（负责人 + 截止时间）；4. 遗留问题。
          内容：
  - id: code-study
    label: 代码学习
    prompts:
      - id: explain-architecture
        title: 讲解模块架构
        body: |
          请讲解以下模块的整体架构：
          1. 模块职责与边界；2. 核心数据结构与控制流；3. 对外接口与依赖关系；4. 设计上的取舍。
          请先给出分层图（文本形式），再逐层展开。
      - id: trace-call-path
        title: 追踪调用链
        body: |
          请从入口函数开始，追踪并讲解这条调用链：
          每一层说明：函数签名、输入输出、关键分支、可能的性能点，直到到达底层实现。
          入口：
`;

/** A user-facing prompt-library failure (maps to HTTP 400 on the routes). */
export class PromptsError extends Error {
  constructor(message) {
    super(message);
    this.name = "PromptsError";
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate and normalize a parsed prompt library.
 * @param {unknown} value
 * @returns {{ groups: {id: string, label: string, prompts: {id: string, title: string, body: string}[]}[] }}
 */
export function validatePromptsLibrary(value) {
  if (!isPlainObject(value)) {
    throw new ValidationError("提示词库：文档根节点必须是映射（groups: …）");
  }
  for (const key of Object.keys(value)) {
    if (key !== "groups") throw new ValidationError(`提示词库：未知的顶层字段 "${key}"（只支持 groups）`);
  }
  if (!Array.isArray(value.groups) || value.groups.length === 0) {
    throw new ValidationError('提示词库："groups" 必须是非空列表');
  }
  const groups = [];
  const groupIds = new Set();
  value.groups.forEach((group, groupIndex) => {
    const at = `groups[${groupIndex}]`;
    if (!isPlainObject(group)) throw new ValidationError(`${at}：必须是映射（{id, label, prompts}）`);
    for (const key of Object.keys(group)) {
      if (key !== "id" && key !== "label" && key !== "prompts") {
        throw new ValidationError(`${at}：未知字段 "${key}"（只支持 id / label / prompts）`);
      }
    }
    const id = requireText(group.id, `${at}.id`);
    if (groupIds.has(id)) throw new ValidationError(`提示词库：分组 id "${id}" 重复`);
    groupIds.add(id);
    const label = requireText(group.label, `${at}.label`);
    if (!Array.isArray(group.prompts) || group.prompts.length === 0) {
      throw new ValidationError(`${at}.prompts：必须是非空列表`);
    }
    const prompts = [];
    const promptIds = new Set();
    group.prompts.forEach((prompt, promptIndex) => {
      const atPrompt = `${at}.prompts[${promptIndex}]`;
      if (!isPlainObject(prompt)) {
        throw new ValidationError(`${atPrompt}：必须是映射（{id, title, body}）`);
      }
      for (const key of Object.keys(prompt)) {
        if (key !== "id" && key !== "title" && key !== "body") {
          throw new ValidationError(`${atPrompt}：未知字段 "${key}"（只支持 id / title / body）`);
        }
      }
      const promptId = requireText(prompt.id, `${atPrompt}.id`);
      if (promptIds.has(promptId)) {
        throw new ValidationError(`分组 "${id}" 内提示词 id "${promptId}" 重复`);
      }
      promptIds.add(promptId);
      const title = requireText(prompt.title, `${atPrompt}.title`);
      if (typeof prompt.body !== "string" || prompt.body.trim() === "") {
        throw new ValidationError(`${atPrompt}.body：必须是非空字符串（多行正文请用 "|" 块标量）`);
      }
      prompts.push({ id: promptId, title, body: prompt.body });
    });
    groups.push({ id, label, prompts });
  });
  return { groups };
}

function requireText(value, at) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${at}：必须是非空字符串`);
  }
  return value.trim();
}

/**
 * Serialize a validated library back to YAML the hand-rolled parser can
 * read (the write path of the board editor). Plain scalars are emitted
 * double-quoted unless they are provably safe; bodies use block scalars
 * with the chomping indicator derived from their trailing newlines.
 * @param {{ groups: {id: string, label: string, prompts: {id: string, title: string, body: string}[]}[] }} library
 * @returns {string}
 */
export function stringifyPromptsLibrary(library) {
  const lines = [
    "# dsh-session-manager 提示词库",
    "# 由看板编辑器生成；也可手动编辑，结构：groups → [{id, label, prompts: [{id, title, body}]}]",
    "",
    "groups:",
  ];
  for (const group of library.groups) {
    lines.push(`  - id: ${scalar(group.id)}`);
    lines.push(`    label: ${scalar(group.label)}`);
    lines.push("    prompts:");
    for (const prompt of group.prompts) {
      lines.push(`      - id: ${scalar(prompt.id)}`);
      lines.push(`        title: ${scalar(prompt.title)}`);
      lines.push(`        body: ${blockScalarHeader(prompt.body)}`);
      // split() leaves a trailing "" for a body ending in "\n"; that
      // newline is provided by the line terminator itself, so drop the
      // artifact (otherwise "|+"/keep bodies gain an extra newline).
      const content = prompt.body.split("\n");
      if (content[content.length - 1] === "") content.pop();
      for (const line of content) {
        lines.push(line === "" ? "" : `          ${line}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/** A plain scalar is only emitted bare when it cannot change meaning. */
function scalar(value) {
  if (value === "") return '""';
  if (/^[A-Za-z0-9_][A-Za-z0-9_./ -]*$/.test(value) && !value.includes("  ")) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
}

/** `|` (one trailing newline) / `|+` (keep all) / `|-` (none). */
function blockScalarHeader(body) {
  if (body.endsWith("\n\n") || body === "\n") return "|+";
  if (body.endsWith("\n")) return "|";
  return "|-";
}

/**
 * Expand a configured library path: `~` / `~/…` resolve against the home
 * directory; the result must be absolute. Empty / null means "default".
 * @param {string | null | undefined} input
 * @returns {string | null}
 */
export function expandPromptsPath(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") throw new ValidationError("库文件路径必须是字符串");
  const trimmed = input.trim();
  if (trimmed === "") return null;
  let expanded = trimmed;
  if (expanded === "~") expanded = homedir();
  else if (expanded.startsWith("~/")) expanded = joinHome(expanded.slice(2));
  if (!isAbsolute(expanded)) {
    throw new ValidationError(`库文件路径必须是绝对路径（支持 ~ 前缀）："${trimmed}"`);
  }
  return expanded;
}

function joinHome(rest) {
  const home = homedir();
  return rest === "" ? home : `${home}/${rest}`;
}

/**
 * Open the prompt library.
 * @param {{ defaultFile: string, configFile: string, logger?: { warn(message: string): void } }} options
 */
export function openPromptsLibrary({ defaultFile, configFile, logger = console }) {
  async function readConfigFile() {
    let text;
    try {
      text = await readFile(configFile, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw error;
    }
    try {
      const parsed = JSON.parse(text);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      // A corrupt settings sidecar never blocks reading the default library;
      // the next successful save overwrites it.
      logger.warn?.(`[dsh-session-manager] settings.json 无法解析，已忽略（${configFile}）`);
      return {};
    }
  }

  async function persistConfigFile(value) {
    const tmp = `${configFile}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(dirname(configFile), { recursive: true });
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, configFile);
  }

  async function resolveEffective() {
    const config = await readConfigFile();
    let override = null;
    if (config.promptsFile !== undefined && config.promptsFile !== null && config.promptsFile !== "") {
      try {
        override = expandPromptsPath(config.promptsFile);
      } catch (error) {
        throw new PromptsError(`库文件路径配置无效：${error.message}`);
      }
    }
    return override === null
      ? { file: defaultFile, customized: false }
      : { file: override, customized: true };
  }

  return {
    /**
     * Read, parse, and validate the current library (re-read every call).
     * @returns {Promise<{ file: string, customized: boolean, groups: object[] }>}
     */
    async load() {
      const { file, customized } = await resolveEffective();
      let text;
      try {
        text = await readFile(file, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") {
          if (customized) throw new PromptsError(`提示词库文件不存在：${file}`);
          await seedDefault(file);
          text = DEFAULT_PROMPTS_YAML;
        } else if (error?.code === "EACCES" || error?.code === "EISDIR") {
          throw new PromptsError(`提示词库文件无法读取：${file}`);
        } else {
          throw error;
        }
      }
      let parsed;
      try {
        parsed = parseYaml(text);
      } catch (error) {
        if (error instanceof YamlSyntaxError) {
          throw new PromptsError(`YAML 语法错误：${error.message}（${file}）`);
        }
        throw error;
      }
      let library;
      try {
        library = validatePromptsLibrary(parsed);
      } catch (error) {
        if (error instanceof ValidationError) {
          throw new PromptsError(`提示词库校验失败：${error.message}（${file}）`);
        }
        throw error;
      }
      return { file, customized, groups: library.groups };
    },
    /** Current path configuration (null promptsFile = default in use). */
    async getConfig() {
      const { file, customized } = await resolveEffective();
      return { promptsFile: customized ? file : null, defaultFile, effectiveFile: file, customized };
    },
    /**
     * Validate, serialize, and atomically write the whole library (the
     * board editor's save path). A round-trip guard re-parses the emitted
     * YAML with the same subset parser the loader uses, so a file that
     * cannot be read back is never written.
     * @param {unknown} input
     * @returns {Promise<{ file: string, customized: boolean, groups: object[] }>}
     */
    async save(input) {
      let library;
      try {
        library = validatePromptsLibrary(input);
      } catch (error) {
        if (error instanceof ValidationError) {
          throw new PromptsError(`提示词库校验失败：${error.message}`);
        }
        throw error;
      }
      const { file } = await resolveEffective();
      const text = stringifyPromptsLibrary(library);
      try {
        const roundTrip = validatePromptsLibrary(parseYaml(text));
        if (JSON.stringify(roundTrip) !== JSON.stringify(library)) {
          throw new Error("round-trip mismatch");
        }
      } catch (error) {
        if (error instanceof PromptsError) throw error;
        throw new PromptsError(
          `提示词库序列化后无法通过自身解析器校验（正文可能含不支持的字符，例如行首 tab）：${error.message}`,
        );
      }
      const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(tmp, text, "utf8");
      await rename(tmp, file);
      return this.load();
    },
    /**
     * Set (`promptsFile: "/abs/path"`), or reset (`promptsFile: null`).
     * @param {unknown} input
     */
    async setConfig(input) {
      if (!isPlainObject(input)) {
        throw new PromptsError("请求体必须是 {promptsFile}");
      }
      let expanded = null;
      const { promptsFile } = input;
      if (promptsFile !== null && promptsFile !== undefined && promptsFile !== "") {
        try {
          expanded = expandPromptsPath(promptsFile);
        } catch (error) {
          throw new PromptsError(`库文件路径配置无效：${error.message}`);
        }
      }
      const config = await readConfigFile();
      if (expanded === null) delete config.promptsFile;
      else config.promptsFile = expanded;
      await persistConfigFile(config);
      return this.getConfig();
    },
  };
}

/** Seed the default library file (atomic temp + rename, like the store). */
async function seedDefault(file) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, DEFAULT_PROMPTS_YAML, "utf8");
  await rename(tmp, file);
}
