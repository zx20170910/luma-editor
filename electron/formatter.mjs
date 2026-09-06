import { constants } from 'node:fs';
import { access, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, delimiter, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';

export const FORMAT_TIMEOUT_MS = 10_000;
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;

const builtins = {
  javascript: ['JavaScript', 'babel'],
  javascriptreact: ['JavaScript React', 'babel'],
  typescript: ['TypeScript', 'typescript'],
  typescriptreact: ['TypeScript React', 'typescript'],
  json: ['JSON', 'json'],
  jsonc: ['JSON with Comments', 'json'],
  html: ['HTML', 'html'],
  css: ['CSS', 'css'],
  scss: ['SCSS', 'scss'],
  less: ['Less', 'less'],
  markdown: ['Markdown', 'markdown'],
  mdx: ['MDX', 'mdx'],
  yaml: ['YAML', 'yaml'],
  graphql: ['GraphQL', 'graphql'],
  vue: ['Vue', 'vue'],
  angular: ['Angular HTML', 'angular'],
  handlebars: ['Handlebars', 'glimmer'],
  java: ['Java', 'java', 'prettier-plugin-java'],
  xml: ['XML', 'xml', '@prettier/plugin-xml'],
  php: ['PHP', 'php', '@prettier/plugin-php'],
  toml: ['TOML', 'toml', 'prettier-plugin-toml'],
  sql: ['SQL', 'sql'],
};

const externalLanguages = {
  python: ['Python', 'py', [
    ['ruff', ['format', '--isolated', '--stdin-filename', '{filepath}', '-']],
    ['black', ['--quiet', '--config', '{config}/black.toml', '--stdin-filename', '{filepath}', '-']],
  ]],
  go: ['Go', 'go', [['gofmt', []]]],
  rust: ['Rust', 'rs', [['rustfmt', ['--emit', 'stdout', '--config-path', '{config}/rustfmt.toml']]]],
  c: ['C', 'c', [['clang-format', ['--style=LLVM', '--assume-filename={filepath}']]]],
  cpp: ['C++', 'cpp', [['clang-format', ['--style=LLVM', '--assume-filename={filepath}']]]],
  'objective-c': ['Objective-C', 'm', [['clang-format', ['--style=LLVM', '--assume-filename={filepath}']]]],
  swift: ['Swift', 'swift', [['swift-format', ['format', '--configuration', '{config}/swift.json', '--assume-filename', '{filepath}']]]],
  shell: ['Shell', 'sh', [['shfmt', ['-i', '{tabSize}', '-']]]],
  csharp: ['C#', 'cs', [['clang-format', ['--style=LLVM', '--assume-filename={filepath}']]]],
  kotlin: ['Kotlin', 'kt', []],
  ruby: ['Ruby', 'rb', []],
  lua: ['Lua', 'lua', []],
  perl: ['Perl', 'pl', []],
  dart: ['Dart', 'dart', []],
  powershell: ['PowerShell', 'ps1', []],
  r: ['R', 'r', []],
  scala: ['Scala', 'scala', []],
  dockerfile: ['Dockerfile', 'dockerfile', []],
  plaintext: ['Plain Text', 'txt', []],
};

const languageAliases = {
  jsx: 'javascriptreact', tsx: 'typescriptreact', js: 'javascript', ts: 'typescript',
  md: 'markdown', yml: 'yaml', sh: 'shell', bash: 'shell', zsh: 'shell',
  cxx: 'cpp', cs: 'csharp', objectivec: 'objective-c',
};

function normalizeLanguage(language) {
  if (typeof language !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_+-]{0,63}$/.test(language)) {
    throw new Error('请选择有效的语言模式。');
  }
  const normalized = language.toLowerCase();
  if (['constructor', 'prototype', '__proto__'].includes(normalized)) throw new Error(`无效的语言 ID：${language}`);
  return Object.hasOwn(languageAliases, normalized) ? languageAliases[normalized] : normalized;
}

export function validateExternalFormatters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('格式化器设置必须是以语言 ID 为键的 JSON 对象。');
  }
  const entries = Object.entries(value);
  if (entries.length > 100) throw new Error('最多可以配置 100 个外部格式化器。');
  const result = {};
  for (const [key, configuration] of entries) {
    const language = normalizeLanguage(key);
    if (['constructor', 'prototype', '__proto__'].includes(language)) {
      throw new Error(`无效的语言 ID：${key}`);
    }
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
      throw new Error(`${key} 的设置必须包含 command 和 args。`);
    }
    if (Object.keys(configuration).some((field) => !['command', 'args'].includes(field))) {
      throw new Error(`${key} 只允许设置 command 和 args。`);
    }
    const { command, args } = configuration;
    if (typeof command !== 'string' || !command || command.length > 4096 || command.includes('\0') ||
        (!isAbsolute(command) && !/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(command))) {
      throw new Error(`${key} 的 command 必须是可执行文件的绝对路径或单独的命令名。`);
    }
    if (!Array.isArray(args) || args.length > 128 ||
        args.some((arg) => typeof arg !== 'string' || arg.length > 16_384 || arg.includes('\0'))) {
      throw new Error(`${key} 的 args 必须是字符串数组。`);
    }
    if (Object.hasOwn(result, language)) throw new Error(`${key} 与另一个语言设置重复。`);
    result[language] = { command, args: [...args] };
  }
  return result;
}

function formatterPath() {
  // Finder-launched applications do not inherit an interactive shell's PATH.
  // Ignore relative/empty entries so opening a folder cannot shadow a formatter.
  return [...new Set([
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
    '/Library/Developer/CommandLineTools/usr/bin',
    ...(process.env.PATH ?? '').split(delimiter),
  ].filter((part) => isAbsolute(part)))].join(delimiter);
}

async function resolveCommand(command, pathValue) {
  const paths = isAbsolute(command) ? [command] : pathValue.split(delimiter).map((directory) => join(directory, command));
  for (const candidate of paths) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch { /* Try the next PATH entry. */ }
  }
  return null;
}

async function findFormatter(language, configuration, pathValue) {
  if (configuration[language]) {
    const custom = configuration[language];
    const executable = await resolveCommand(custom.command, pathValue);
    return { ...custom, executable, label: basename(custom.command), custom: true };
  }
  for (const [command, args] of externalLanguages[language]?.[2] ?? []) {
    const executable = await resolveCommand(command, pathValue);
    if (executable) return { command, args, executable, label: command, custom: false };
  }
  return null;
}

export async function getFormatterStatus(externalFormatters = {}) {
  const configuration = validateExternalFormatters(externalFormatters);
  const pathValue = formatterPath();
  const languages = [...new Set([...Object.keys(builtins), ...Object.keys(externalLanguages), ...Object.keys(configuration)])];
  return Promise.all(languages.map(async (language) => {
    const label = builtins[language]?.[0] ?? externalLanguages[language]?.[0] ?? language;
    if (builtins[language] && !configuration[language]) {
      return { language, label, available: true, kind: 'builtin', detail: language === 'sql' ? '内置 SQL Formatter（通用 SQL 方言）' : '内置 Prettier' };
    }
    const formatter = await findFormatter(language, configuration, pathValue);
    if (formatter?.executable) {
      return { language, label, available: true, kind: 'external', detail: `${formatter.custom ? '自定义' : '已检测到'} ${formatter.label} · ${formatter.executable}` };
    }
    const expected = formatter?.command ?? externalLanguages[language]?.[2].map(([command]) => command).join(' / ');
    return { language, label, available: false, kind: 'missing', detail: expected ? `未找到 ${expected}，请安装或配置外部格式化器。` : '可编辑；格式化需要在设置中配置该语言的外部格式化器。' };
  }));
}

function lineEnding(content) {
  const first = content.match(/\r\n|\r|\n/)?.[0];
  return first === '\r\n' ? 'crlf' : first === '\r' ? 'cr' : 'lf';
}

function preserveLineEndings(content, ending) {
  const separator = ending === 'crlf' ? '\r\n' : ending === 'cr' ? '\r' : '\n';
  return content.replace(/\r\n|\r|\n/g, separator);
}

async function formatBuiltin(content, language, tabSize, ending) {
  if (language === 'sql') {
    const { format } = await import('sql-formatter');
    return { content: preserveLineEndings(`${format(content, { language: 'sql', tabWidth: tabSize })}\n`, ending), formatter: 'SQL Formatter' };
  }
  const [, parser, plugin] = builtins[language];
  if (language === 'json') JSON.parse(content.replace(/^\uFEFF/, ''));
  const prettier = await import('prettier');
  const plugins = [];
  if (plugin) {
    const loaded = await import(plugin);
    plugins.push(loaded.default ?? loaded);
  }
  // No resolveConfig/getFileInfo: never import a project's executable configuration
  // or plugins. Only these explicitly bundled parsers can run.
  const formatted = await prettier.format(content, {
    parser, plugins, tabWidth: tabSize, useTabs: false, printWidth: 100,
    endOfLine: ending, embeddedLanguageFormatting: 'auto',
  });
  return { content: preserveLineEndings(formatted, ending), formatter: plugin ? `Prettier · ${builtins[language][0]}` : 'Prettier' };
}

function runProcess(command, args, content, cwd, pathValue) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let outputSize = 0;
    let errorSize = 0;
    const chunks = [];
    const errorChunks = [];
    let child;
    let timer;
    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        if (child?.pid) {
          try {
            if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
            else child.kill('SIGKILL');
          } catch { child.kill('SIGKILL'); }
        }
        child?.stdin.destroy();
        child?.stdout.destroy();
        child?.stderr.destroy();
        reject(error);
      } else resolve(output);
    };
    try {
      child = spawn(command, args, {
        shell: false, cwd, windowsHide: true, detached: process.platform !== 'win32',
        env: { ...process.env, PATH: pathValue, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) { finish(error); return; }
    timer = setTimeout(() => finish(new Error('外部格式化器执行超时（10 秒），原文未替换。')), FORMAT_TIMEOUT_MS);
    child.on('error', (error) => finish(new Error(`无法启动格式化器：${error.message}`)));
    child.stdout.on('data', (chunk) => {
      outputSize += chunk.length;
      if (outputSize > MAX_OUTPUT_BYTES) finish(new Error('格式化器输出超过 20 MB，原文未替换。'));
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      outputSize += chunk.length;
      if (outputSize > MAX_OUTPUT_BYTES) finish(new Error('格式化器输出超过 20 MB，原文未替换。'));
      if (errorSize < MAX_ERROR_BYTES) errorChunks.push(chunk.subarray(0, MAX_ERROR_BYTES - errorSize));
      errorSize += chunk.length;
    });
    child.stdin.on('error', (error) => {
      // A parser may reject input early. Its exit code/stderr is the useful error.
      if (error.code !== 'EPIPE') finish(new Error(`无法传入待格式化内容：${error.message}`));
    });
    child.on('close', (code, signal) => {
      if (code !== 0) {
        const diagnostic = Buffer.concat(errorChunks).toString('utf8').trim();
        finish(new Error(`格式化失败（${signal ?? `退出码 ${code}`}）${diagnostic ? `：\n${diagnostic}` : '，原文未替换。'}`));
        return;
      }
      let output;
      try {
        output = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        if (output.includes('\0')) throw new Error('NUL');
      } catch {
        finish(new Error('格式化器返回了二进制或无效 UTF-8 数据，原文未替换。'));
        return;
      }
      if (content.trim() && !output.trim()) {
        finish(new Error('格式化器未返回内容；请使用从标准输入读取、向标准输出写入的参数。原文未替换。'));
        return;
      }
      finish(null, output);
    });
    child.stdin.end(content);
  });
}

async function formatExternal(content, language, filePath, tabSize, formatter, pathValue, ending) {
  const temporary = await mkdtemp(join(tmpdir(), 'luma-format-'));
  try {
    const documentDirectory = join(temporary, 'document');
    const configDirectory = join(temporary, 'config');
    await Promise.all([mkdir(documentDirectory), mkdir(configDirectory)]);
    const suggestedName = filePath ? basename(filePath) : '';
    const name = suggestedName && !['.', '..'].includes(suggestedName) ? suggestedName : `untitled.${externalLanguages[language]?.[1] ?? 'txt'}`;
    const snapshotPath = join(documentDirectory, name);
    await Promise.all([
      writeFile(snapshotPath, content, 'utf8'),
      writeFile(join(configDirectory, 'black.toml'), '[tool.black]\n', 'utf8'),
      writeFile(join(configDirectory, 'rustfmt.toml'), 'edition = "2021"\n', 'utf8'),
      writeFile(join(configDirectory, 'swift.json'), JSON.stringify({ version: 1, indentation: { spaces: tabSize } }), 'utf8'),
    ]);
    // {filepath} is deliberately a temporary snapshot with the original basename,
    // not the original document path. Even an in-place formatter cannot overwrite
    // the user's document through this placeholder; successful stdout is required.
    const args = formatter.args.map((arg) => {
      let expanded = arg.replaceAll('{filepath}', snapshotPath);
      if (!formatter.custom) expanded = expanded.replaceAll('{config}', configDirectory).replaceAll('{tabSize}', String(tabSize));
      return expanded;
    });
    const output = await runProcess(formatter.executable, args, content, temporary, pathValue);
    return { content: preserveLineEndings(output, ending), formatter: formatter.label };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function formatDocument({ content, language, filePath = '', tabSize = 2 }, externalFormatters = {}) {
  if (typeof content !== 'string') throw new Error('待格式化内容必须是文本。');
  if (Buffer.byteLength(content, 'utf8') > MAX_INPUT_BYTES) throw new Error('格式化支持最大 10 MB 的文档。');
  if (typeof filePath !== 'string' || filePath.includes('\0')) throw new Error('文档路径无效。');
  if (!Number.isInteger(tabSize) || tabSize < 1 || tabSize > 8) throw new Error('缩进宽度必须是 1 至 8 的整数。');
  language = normalizeLanguage(language);
  const configuration = validateExternalFormatters(externalFormatters);
  const ending = lineEnding(content);
  if (builtins[language] && !configuration[language]) return formatBuiltin(content, language, tabSize, ending);
  const pathValue = formatterPath();
  const formatter = await findFormatter(language, configuration, pathValue);
  if (!formatter?.executable) {
    const label = builtins[language]?.[0] ?? externalLanguages[language]?.[0] ?? language;
    const detail = formatter ? `未找到命令 ${formatter.command}` : '当前没有可用的格式化器';
    throw new Error(`${label}：${detail}。请在设置中配置该语言的外部格式化器。`);
  }
  return formatExternal(content, language, filePath, tabSize, formatter, pathValue, ending);
}
