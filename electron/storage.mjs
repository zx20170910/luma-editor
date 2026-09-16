import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_FILE_BYTES = 12 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function storageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function canonicalPath(filePath) {
  const resolved = path.resolve(filePath);
  try { return await fs.realpath(resolved); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return path.join(await fs.realpath(path.dirname(resolved)), path.basename(resolved));
  }
}

export class FileAccess {
  files = new Set();
  folders = new Set();
  async grantFile(filePath) {
    const resolved = await canonicalPath(filePath);
    this.files.add(resolved);
    return resolved;
  }
  async grantFolder(folderPath) {
    const resolved = await fs.realpath(folderPath);
    if (!(await fs.stat(resolved)).isDirectory()) throw new Error('所选路径不是文件夹。');
    this.folders.add(resolved);
    return resolved;
  }
  async assert(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('无效的文件路径。');
    const resolved = await canonicalPath(filePath);
    if (this.files.has(resolved) || [...this.folders].some(root => isWithin(root, resolved))) return resolved;
    throw new Error('请先使用“打开文件”或“打开文件夹”授权访问该位置。');
  }
  // Snapshot metadata is not a filesystem read. Previously granted canonical
  // paths can be persisted after files or parents disappear. Actual I/O still
  // uses assert(), including fresh symlink resolution.
  assertMetadata(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('无效的文件路径。');
    const resolved = path.resolve(filePath);
    if (this.files.has(resolved) || [...this.folders].some(root => isWithin(root, resolved))) return resolved;
    throw new Error('会话包含未授权的文件路径。');
  }
}

export function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function readTextFile(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('只能打开普通文本文件。');
    if (stat.size > MAX_FILE_BYTES) throw new Error('文件超过 12 MB，请使用其他工具处理较大的文件。');
    const bytes = await handle.readFile();
    if (bytes.length > MAX_FILE_BYTES) throw new Error('文件超过 12 MB。');
    if (bytes.includes(0)) throw new Error('文件是二进制或非 UTF-8 编码，无法作为文本打开。');
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    let content;
    try { content = utf8.decode(bom ? bytes.subarray(3) : bytes); }
    catch { throw new Error('文件不是有效的 UTF-8 文本，请先转换编码。'); }
    return { path: filePath, name: path.basename(filePath), content, mtime: stat.mtimeMs, bom };
  } finally { await handle.close(); }
}

async function getStat(filePath) {
  try { return await fs.stat(filePath); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function changed(stat, expectedMtime) {
  return stat ? Math.abs(stat.mtimeMs - expectedMtime) > 0.01 : expectedMtime !== 0;
}

// Same-directory rename makes the completed write atomic. The second version
// check detects edits that arrived while the temporary file was being written.
export async function saveTextFile({ filePath, content, bom = false, expectedMtime = 0 }) {
  if (typeof content !== 'string') throw new Error('保存内容必须是文本。');
  const bytes = Buffer.from(`${bom ? '\uFEFF' : ''}${content}`, 'utf8');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('保存内容超过 12 MB。');
  const previous = await getStat(filePath);
  if (previous && !previous.isFile()) throw new Error('目标不是普通文件。');
  if (changed(previous, expectedMtime)) throw storageError('EFILECONFLICT', '文件已在其他程序中更改。');
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', previous ? previous.mode & 0o777 : 0o600);
    if (previous) await handle.chmod(previous.mode & 0o777);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    const latest = await getStat(filePath);
    if (changed(latest, expectedMtime)) throw storageError('EFILECONFLICT', '保存期间文件又发生了变化。');
    await fs.rename(temporary, filePath);
    const stat = await fs.stat(filePath);
    return { path: filePath, name: path.basename(filePath), content, mtime: stat.mtimeMs, bom };
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}

export async function atomicWriteJSON(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, filePath);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}

export async function readJSON(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export class SessionStore {
  constructor(filePath, delay = 350) {
    this.filePath = filePath;
    this.delay = delay;
    this.pending = null;
    this.timer = null;
    this.chain = Promise.resolve();
  }
  schedule(value) {
    this.pending = value;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.flush().catch(() => {}); }, this.delay);
  }
  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.pending !== null) {
      const value = this.pending;
      this.pending = null;
      this.chain = this.chain.catch(() => {}).then(() => atomicWriteJSON(this.filePath, value));
    }
    return this.chain;
  }
}

export function validateSession(value) {
  if (!value || !Array.isArray(value.tabs) || value.tabs.length > 50) throw new Error('会话数据无效。');
  let bytes = 0;
  const ids = new Set();
  const tabs = value.tabs.map(tab => {
    if (!tab || typeof tab.id !== 'string' || tab.id.length > 200 || ids.has(tab.id) ||
        typeof tab.name !== 'string' || tab.name.length > 1000 ||
        (tab.path !== null && (typeof tab.path !== 'string' || !path.isAbsolute(tab.path))) ||
        typeof tab.content !== 'string' || typeof tab.savedContent !== 'string' ||
        typeof tab.language !== 'string' || tab.language.length > 100 ||
        !Number.isFinite(tab.mtime) || tab.mtime < 0) throw new Error('会话中的标签页无效。');
    ids.add(tab.id);
    const size = Buffer.byteLength(tab.content, 'utf8');
    const savedSize = Buffer.byteLength(tab.savedContent, 'utf8');
    bytes += size + savedSize;
    if (size > MAX_FILE_BYTES || savedSize > MAX_FILE_BYTES || bytes > 50 * 2 * MAX_FILE_BYTES) throw new Error('会话草稿内容过大。');
    return { id: tab.id, path: tab.path, name: tab.name, content: tab.content, savedContent: tab.savedContent, mtime: tab.mtime, language: tab.language, bom: Boolean(tab.bom) };
  });
  const source = value.preferences ?? {};
  const preferences = {
    fontSize: Math.min(32, Math.max(10, Number(source.fontSize) || 14)),
    tabSize: [2, 4, 8].includes(source.tabSize) ? source.tabSize : 2,
    wordWrap: Boolean(source.wordWrap), minimap: source.minimap !== false,
    formatOnSave: Boolean(source.formatOnSave), theme: source.theme === 'light' ? 'light' : 'dark',
    preview: source.preview !== false, sidebar: source.sidebar !== false,
    sidebarWidth: Math.min(420, Math.max(160, Number(source.sidebarWidth) || 220)),
  };
  let folder = null;
  if (value.folder) {
    if (typeof value.folder.path !== 'string' || !path.isAbsolute(value.folder.path) || typeof value.folder.name !== 'string') throw new Error('会话文件夹无效。');
    folder = { path: value.folder.path, name: value.folder.name, directory: true };
  }
  return { tabs, activeId: ids.has(value.activeId) ? value.activeId : tabs[0]?.id ?? null, folder, preferences };
}
