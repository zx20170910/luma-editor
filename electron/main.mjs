import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileAccess, MAX_FILE_BYTES, SessionStore, atomicWriteJSON, isWithin, readJSON, readTextFile, saveTextFile, validateSession } from './storage.mjs';
import { formatDocument, getFormatterStatus, validateExternalFormatters } from './formatter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setName('Luma Editor');
if (!app.isPackaged && process.env.LUMA_USER_DATA) {
  if (!path.isAbsolute(process.env.LUMA_USER_DATA)) throw new Error('测试会话目录必须使用绝对路径。');
  app.setPath('userData', process.env.LUMA_USER_DATA);
}
const access = new FileAccess();
let window = null;
let restoredSession = null;
let sessionStore;
let formatterFile;
let externalFormatters = {};
let rendererReady = false;
let closeApproved = false;
let dispatching = false;
const pendingPaths = [];

function sendCommand(command) { window?.webContents.send('luma:command', command); }
function requireWindow() { if (!window || window.isDestroyed()) throw new Error('编辑器窗口尚未就绪。'); return window; }
function verifySender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效的请求来源。');
}
function handle(channel, callback) {
  ipcMain.handle(`luma:${channel}`, async (event, ...args) => { verifySender(event); return callback(...args); });
}
function string(value, max = 4096) {
  if (typeof value !== 'string' || value.length > max) throw new Error('无效的请求参数。');
  return value;
}
async function openSelectedPaths(paths) {
  const files = [];
  for (const selected of paths) {
    try {
      const authorized = await access.grantFile(selected);
      files.push(await readTextFile(authorized));
    } catch (error) {
      await dialog.showMessageBox(requireWindow(), { type: 'error', title: '无法打开文件', message: path.basename(selected), detail: error.message });
    }
  }
  return files;
}
async function dispatchPending() {
  if (!rendererReady || !window || dispatching) return;
  dispatching = true;
  try {
    while (pendingPaths.length && rendererReady && window) {
      const files = await openSelectedPaths(pendingPaths.splice(0));
      if (files.length) window?.webContents.send('luma:open-files', files);
    }
  } finally { dispatching = false; }
}
function queuePaths(paths) {
  pendingPaths.push(...paths.filter(p => typeof p === 'string' && p && !p.startsWith('-')).map(p => path.resolve(p)));
  void dispatchPending();
}

async function saveFile(request) {
  if (!request || (request.path !== null && typeof request.path !== 'string') || typeof request.content !== 'string' || Buffer.byteLength(request.content, 'utf8') > MAX_FILE_BYTES || !Number.isFinite(request.mtime) || request.mtime < 0) throw new Error('保存请求无效或内容超过 12 MB。');
  const name = path.basename(string(request.name, 1000)) || 'Untitled.txt';
  let target = request.path;
  let expectedMtime = request.mtime;
  if (!target || request.saveAs) {
    const result = await dialog.showSaveDialog(requireWindow(), { title: '保存文件', buttonLabel: '保存', defaultPath: target || name, properties: ['createDirectory'] });
    if (result.canceled || !result.filePath) return null;
    target = await access.grantFile(result.filePath);
    let exists = null;
    try { exists = await fs.stat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists) {
      const choice = await dialog.showMessageBox(requireWindow(), { type: 'warning', title: '替换文件', message: `“${path.basename(target)}”已存在。`, detail: '替换后，原文件内容将被当前标签页的内容覆盖。', buttons: ['取消', '替换'], defaultId: 0, cancelId: 0, noLink: true });
      if (choice.response !== 1) return null;
    }
    expectedMtime = exists?.mtimeMs ?? 0;
  } else {
    target = await access.assert(target);
  }
  // The overwrite prompt is repeated if another write occurs while it is open.
  // A cancelled prompt never changes the destination.
  for (;;) {
    try { return await saveTextFile({ filePath: target, content: request.content, expectedMtime, bom: Boolean(request.bom) }); }
    catch (error) {
      if (error.code !== 'EFILECONFLICT') throw error;
      let stat = null;
      try { stat = await fs.stat(target); } catch (statError) { if (statError.code !== 'ENOENT') throw statError; }
      const choice = await dialog.showMessageBox(requireWindow(), { type: 'warning', title: '文件已更改', message: `“${path.basename(target)}”已在磁盘上更改或删除。`, detail: '保留磁盘版本可取消本次保存；选择覆盖将使用当前编辑器内容。也可以取消后“另存为”。', buttons: ['取消保存', '覆盖磁盘版本'], defaultId: 0, cancelId: 0, noLink: true });
      if (choice.response !== 1) return null;
      expectedMtime = stat?.mtimeMs ?? 0;
    }
  }
}

async function readAsset(relativePath, documentPath) {
  try {
    relativePath = string(relativePath, 4096);
    const document = await access.assert(string(documentPath));
    if (!relativePath || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(relativePath)) return null;
    const decoded = decodeURIComponent(relativePath.split(/[?#]/, 1)[0]);
    if (decoded.includes('\0') || decoded.includes('\\') || path.isAbsolute(decoded)) return null;
    const root = path.dirname(document);
    const asset = await fs.realpath(path.resolve(root, decoded));
    if (!isWithin(root, asset)) return null;
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' }[path.extname(asset).toLowerCase()];
    if (!mime) return null;
    const stat = await fs.stat(asset);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return null;
    const data = await fs.readFile(asset);
    if (data.length > 8 * 1024 * 1024) return null;
    const header = data.subarray(0, 16);
    const valid = (mime === 'image/png' && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (mime === 'image/jpeg' && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) ||
      (mime === 'image/gif' && /^GIF8[79]a/.test(header.toString('ascii'))) ||
      (mime === 'image/webp' && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') ||
      (mime === 'image/avif' && header.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(header.toString('ascii', 8, 16)));
    return valid ? `data:${mime};base64,${data.toString('base64')}` : null;
  } catch { return null; }
}

function setupIPC() {
  handle('open-files', async () => {
    const result = await dialog.showOpenDialog(requireWindow(), { title: '打开文本文件', properties: ['openFile', 'multiSelections'] });
    return result.canceled ? [] : openSelectedPaths(result.filePaths);
  });
  handle('open-folder', async () => {
    const result = await dialog.showOpenDialog(requireWindow(), { title: '打开文件夹', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const folderPath = await access.grantFolder(result.filePaths[0]);
    return { path: folderPath, name: path.basename(folderPath), directory: true };
  });
  handle('read-file', async filePath => readTextFile(await access.assert(string(filePath))));
  handle('list-directory', async folderPath => {
    const folder = await access.assert(string(folderPath));
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const nodes = [];
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name === '.git' || entry.name === 'node_modules') continue;
      if (!entry.isDirectory() && !entry.isFile()) continue;
      nodes.push({ path: path.join(folder, entry.name), name: entry.name, directory: entry.isDirectory() });
    }
    return nodes.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  });
  handle('save-file', saveFile);
  handle('confirm-close', async name => {
    const result = await dialog.showMessageBox(requireWindow(), { type: 'question', title: '保存修改', message: `要保存对“${string(name, 1000)}”的修改吗？`, detail: '选择“不保存”将放弃此标签页未保存的修改。', buttons: ['保存', '取消', '不保存'], defaultId: 0, cancelId: 1, noLink: true });
    return ['save', 'cancel', 'discard'][result.response] ?? 'cancel';
  });
  handle('load-session', async () => {
    rendererReady = true;
    setTimeout(() => { void dispatchPending(); }, 100);
    return restoredSession;
  });
  handle('save-session', async value => {
    const session = validateSession(value);
    for (const tab of session.tabs) if (tab.path) access.assertMetadata(tab.path);
    if (session.folder) access.assertMetadata(session.folder.path);
    restoredSession = session;
    sessionStore.schedule(session);
  });
  handle('format', async request => {
    if (!request || typeof request.content !== 'string' || Buffer.byteLength(request.content, 'utf8') > MAX_FILE_BYTES) throw new Error('格式化内容无效或超过 12 MB。');
    string(request.language, 100);
    if (![2, 4, 8].includes(request.tabSize)) throw new Error('缩进宽度无效。');
    if (request.filePath !== undefined) string(request.filePath);
    return formatDocument(request, externalFormatters);
  });
  handle('formatter-status', () => getFormatterStatus(externalFormatters));
  handle('get-external-formatters', () => externalFormatters);
  handle('set-external-formatters', async value => {
    const validated = validateExternalFormatters(value);
    await atomicWriteJSON(formatterFile, validated);
    externalFormatters = validated;
  });
  handle('read-asset', readAsset);
  handle('open-external', async value => {
    const url = new URL(string(value, 16384));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持打开 HTTP 或 HTTPS 链接。');
    await shell.openExternal(url.href);
  });
  handle('reveal-file', async filePath => shell.showItemInFolder(await access.assert(string(filePath))));
  ipcMain.on('luma:set-dirty', (event, value) => { try { verifySender(event); if (typeof value === 'boolean') window.setDocumentEdited(value); } catch {} });
  ipcMain.on('luma:respond-to-close', async event => {
    try {
      verifySender(event);
      await sessionStore.flush();
      closeApproved = true;
      window?.close();
    } catch (error) {
      await dialog.showMessageBox(requireWindow(), { type: 'error', title: '无法保存会话', message: '草稿恢复数据未能保存，窗口将保持打开。', detail: error.message });
    }
  });
}

function installMenu() {
  const item = (label, command, accelerator) => ({ label, accelerator, click: () => sendCommand(command) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Luma Editor', submenu: [{ label: '关于 Luma Editor', role: 'about' }, { type: 'separator' }, item('设置…', 'settings', 'CmdOrCtrl+,'), { type: 'separator' }, { label: '服务', role: 'services' }, { type: 'separator' }, { label: '隐藏 Luma Editor', role: 'hide' }, { label: '隐藏其他应用', role: 'hideOthers' }, { label: '显示全部', role: 'unhide' }, { type: 'separator' }, { label: '退出 Luma Editor', role: 'quit' }] },
    { label: '文件', submenu: [item('新建文件', 'new', 'CmdOrCtrl+N'), item('打开文件…', 'open', 'CmdOrCtrl+O'), item('打开文件夹…', 'open-folder', 'CmdOrCtrl+Shift+O'), { type: 'separator' }, item('保存', 'save', 'CmdOrCtrl+S'), item('另存为…', 'save-as', 'CmdOrCtrl+Shift+S'), { type: 'separator' }, item('关闭标签页', 'close-tab', 'CmdOrCtrl+W')] },
    { label: '编辑', submenu: [{ label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' }, { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }, { type: 'separator' }, item('查找', 'find', 'CmdOrCtrl+F'), item('替换', 'replace', 'CmdOrCtrl+Alt+F'), item('格式化文档', 'format', 'Alt+Shift+F')] },
    { label: '视图', submenu: [item('命令面板', 'command-palette', 'CmdOrCtrl+Shift+P'), item('快速打开', 'quick-open', 'CmdOrCtrl+P'), { type: 'separator' }, item('切换 Markdown 预览', 'toggle-preview', 'CmdOrCtrl+Shift+M'), item('切换侧边栏', 'toggle-sidebar', 'CmdOrCtrl+B'), { type: 'separator' }, { label: '进入全屏幕', role: 'togglefullscreen' }] },
    { label: '窗口', submenu: [{ label: '最小化', role: 'minimize' }, { label: '缩放', role: 'zoom' }, { type: 'separator' }, { label: '前置全部窗口', role: 'front' }] },
  ]));
}

async function createWindow() {
  rendererReady = false;
  closeApproved = false;
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 900, minHeight: 600, title: 'Luma Editor', backgroundColor: '#111419', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 }, show: false,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => window?.show());
  window.on('close', event => {
    if (!closeApproved) { event.preventDefault(); window?.webContents.send('luma:close-requested'); }
  });
  window.on('closed', () => { window = null; rendererReady = false; });
  window.webContents.on('render-process-gone', async () => {
    await sessionStore.flush().catch(() => {});
    if (window && !window.isDestroyed()) {
      const result = await dialog.showMessageBox(window, { type: 'error', title: '编辑器需要重新加载', message: '编辑器渲染进程已停止，已保存的会话可恢复。', buttons: ['重新加载', '关闭'], defaultId: 0, cancelId: 1 });
      if (result.response === 0) window.reload();
      else { closeApproved = true; window.close(); }
    }
  });
  if (process.env.LUMA_DEV_URL && !app.isPackaged) {
    const dev = new URL(process.env.LUMA_DEV_URL);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(dev.hostname) || dev.protocol !== 'http:') throw new Error('开发地址必须使用本机 HTTP 服务。');
    await window.loadURL(dev.href);
  } else await window.loadFile(path.join(here, '..', 'dist', 'index.html'));
}

app.on('open-file', (event, filePath) => { event.preventDefault(); queuePaths([filePath]); });
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv, cwd) => {
    queuePaths(argv.slice(app.isPackaged ? 1 : 2).filter(p => p && !p.startsWith('-')).map(p => path.isAbsolute(p) ? p : path.resolve(cwd, p)));
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });
  app.whenReady().then(async () => {
    const userData = app.getPath('userData');
    sessionStore = new SessionStore(path.join(userData, 'session.json'));
    formatterFile = path.join(userData, 'formatters.json');
    try {
      const saved = await readJSON(sessionStore.filePath);
      if (saved) {
        restoredSession = validateSession(saved);
        for (const tab of restoredSession.tabs) if (tab.path) {
          try { await access.grantFile(tab.path); }
          catch { access.files.add(path.resolve(tab.path)); }
        }
        if (restoredSession.folder) {
          try { await access.grantFolder(restoredSession.folder.path); }
          catch { restoredSession.folder = null; }
        }
      }
    } catch (error) {
      await dialog.showMessageBox({ type: 'warning', title: '无法恢复上次会话', message: '上次会话数据无法读取，原始会话文件会保留备份。', detail: error.message });
      await fs.copyFile(sessionStore.filePath, `${sessionStore.filePath}.recovery-${Date.now()}`).catch(() => {});
    }
    try { const saved = await readJSON(formatterFile); if (saved) externalFormatters = validateExternalFormatters(saved); }
    catch (error) { await dialog.showMessageBox({ type: 'warning', title: '外部格式化配置无效', message: '内置格式化仍然可用，请在设置中检查外部工具配置。', detail: error.message }); }
    app.setAboutPanelOptions({ applicationName: 'Luma Editor', applicationVersion: app.getVersion(), copyright: '本地文本与 Markdown 编辑器', credits: '支持多语言格式化与安全的本地草稿恢复。' });
    setupIPC();
    installMenu();
    queuePaths(process.argv.slice(app.isPackaged ? 1 : 2));
    await createWindow();
    app.on('activate', () => { if (!window) void createWindow(); });
  }).catch(error => { dialog.showErrorBox('Luma Editor 启动失败', error.message); app.exit(1); });
  app.on('window-all-closed', () => { app.quit(); });
}
