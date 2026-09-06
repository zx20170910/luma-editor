import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import { createIcons, icons } from 'lucide';
import type { ExternalFormatter, FileData, FileNode, Preferences, SavedTab, Session } from '../shared/contracts';
import { detectLanguage, languageLabel, languageList, formatLanguage } from './languages';
import { markdownHTML } from './preview';
import { welcome, sampleCode } from './samples';
import './style.css';

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker();
    if (['css', 'scss', 'less'].includes(label)) return new cssWorker();
    if (['html', 'handlebars', 'razor'].includes(label)) return new htmlWorker();
    if (['typescript', 'javascript'].includes(label)) return new tsWorker();
    return new editorWorker();
  },
};
const api = window.luma;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escapeHTML = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const icon = (name: string, size = 16) => `<i data-lucide="${name}" width="${size}" height="${size}"></i>`;
const drawIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.55 } });
const button = (id: string, symbol: string, title: string, label = '') => `<button id="${id}" class="${label ? 'text-button' : 'icon-button'}" title="${title}" aria-label="${title}">${icon(symbol)}${label ? `<span>${label}</span>` : ''}</button>`;

$('app').innerHTML = `
  <header class="titlebar">
    <div class="window-space"></div><div class="brand"><span class="brand-mark">L</span><span>Luma <b>Editor</b></span><span class="version">1.0</span></div>
    <button id="top-search" class="top-search" title="快速打开 (⌘ P)">${icon('search', 13)}<span>搜索文件或跳转到…</span><kbd>⌘ P</kbd></button>
    <div class="window-context"><span class="local-dot"></span>本地工作区</div>
  </header>
  <div class="workspace">
    <nav class="activity-bar" aria-label="工具栏">
      <button id="activity-files" class="activity active" title="文件侧栏 (⌘ B)" aria-label="文件侧栏">${icon('files', 21)}</button>
      <button id="activity-search" class="activity" title="查找 (⌘ F)" aria-label="查找">${icon('search', 21)}</button>
      <button id="activity-command" class="activity" title="命令面板 (⇧ ⌘ P)" aria-label="命令面板">${icon('terminal-square', 21)}</button>
      <div class="activity-spacer"></div>
      <button id="activity-help" class="activity" title="打开欢迎文档" aria-label="打开欢迎文档">${icon('circle-help', 20)}</button>
      <button id="activity-settings" class="activity" title="设置 (⌘ ,)" aria-label="设置">${icon('settings-2', 20)}</button>
    </nav>
    <aside id="sidebar" class="sidebar">
      <div class="sidebar-heading"><span>资源管理器</span><div>${button('sidebar-new','file-plus-2','新建文件 (⌘ N)')}${button('sidebar-folder','folder-open','打开文件夹')}</div></div>
      <div class="section-label"><span>${icon('chevron-down',12)}已打开的文件</span><small id="open-count">0</small></div><div id="open-editors" class="open-editors"></div>
      <div class="section-label folder-section"><span id="folder-label">工作区</span>${button('refresh-tree','refresh-cw','刷新文件列表')}</div>
      <div id="file-tree" class="file-tree"></div>
      <div class="sidebar-footer"><span class="tiny-spark">✦</span><span>给想法，留一点空间。</span></div>
    </aside>
    <main class="main-pane">
      <div class="tabbar"><div id="tabs" class="tabs" role="tablist" aria-label="打开的文件"></div>${button('tab-new','plus','新建文件 (⌘ N)')}</div>
      <div class="editor-toolbar"><div id="breadcrumbs" class="breadcrumbs"></div><div class="editor-actions">${button('wrap-button','wrap-text','切换自动换行')}${button('format-button','wand-sparkles','格式化文档 (⇧ ⌥ F)','格式化')}<span class="toolbar-separator"></span>${button('preview-button','panel-right','Markdown 预览 (⇧ ⌘ M)','预览')}</div></div>
      <div id="content-area" class="content-area">
        <section id="source-pane" class="source-pane" aria-label="源代码编辑区"><div id="markdown-toolbar" class="markdown-toolbar"><span>MARKDOWN</span><div>${button('md-heading','heading-2','插入标题')}${button('md-bold','bold','加粗选中文本')}${button('md-italic','italic','斜体选中文本')}${button('md-link','link','插入链接')}${button('md-code','code-2','插入代码块')}${button('md-list','list','插入列表')}${button('md-quote','quote','插入引用')}</div><small>源文档</small></div><div id="editor"></div></section>
        <div id="splitter" class="splitter" role="separator" aria-label="调整预览宽度" tabindex="0"></div>
        <section id="preview-pane" class="preview-pane" aria-label="Markdown 预览"><div class="preview-heading"><span>${icon('book-open',14)}实时预览<span class="live-dot"></span></span><div>${button('preview-refresh','rotate-cw','刷新预览')}${button('preview-close','x','关闭预览')}</div></div><iframe id="preview-frame" title="Markdown 实时预览" sandbox="allow-same-origin"></iframe><div class="preview-footer"><span id="read-time"></span><span>MARKDOWN</span></div></section>
        <div id="empty-state" class="empty-state" hidden><div class="empty-logo">L</div><h1>让灵感落在纸上。</h1><p>打开一个文件，开始下一件作品。</p><div><button id="empty-new" class="primary">新建文件 <kbd>⌘ N</kbd></button><button id="empty-open" class="secondary">打开文件 <kbd>⌘ O</kbd></button></div><small>LUMA EDITOR · MADE FOR FOCUS</small></div>
      </div>
    </main>
  </div>
  <footer class="statusbar"><div><span class="status-brand">${icon('zap',12)}Luma</span><span id="save-status"><span class="local-dot"></span>就绪</span></div><div><span id="selection-status">第 1 行，第 1 列</span><button id="indent-status" title="修改缩进">空格: 2</button><span id="encoding-status">UTF-8</span><span id="eol-status">LF</span><button id="language-status" title="选择语言">Markdown</button>${button('status-settings','settings-2','设置')}</div></footer>
  <div id="toast" class="toast" role="status" hidden></div>
  <div id="modal-root"></div>
`;
drawIcons();
let preferences: Preferences = { fontSize: 13, tabSize: 2, wordWrap: true, minimap: true, formatOnSave: false, theme: 'dark', preview: true, sidebar: true };
interface Tab extends SavedTab { model: monaco.editor.ITextModel; view: monaco.editor.ICodeEditorViewState | null; subscription: monaco.IDisposable; }
const tabs: Tab[] = [];
let activeId: string | null = null;
let folder: FileNode | null = null;
let ready = false;
let sessionTimer: ReturnType<typeof setTimeout> | undefined;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let previewSequence = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let working = false;
let closing = false;
let settingsSequence = 0;
const directories = new Map<string, FileNode[]>();
const expanded = new Set<string>();
const activeTab = () => tabs.find(t => t.id === activeId);
const isDirty = (t: Tab) => t.model.getValue() !== t.savedContent;
const startupFiles: FileData[] = [];

monaco.editor.defineTheme('luma-dark', {
  base: 'vs-dark', inherit: true,
  rules: [
    { token: 'comment', foreground: '647085', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'C6A0DC' }, { token: 'string', foreground: 'A4D3AC' },
    { token: 'number', foreground: 'DEB484' }, { token: 'type', foreground: '8CC9D6' },
    { token: 'delimiter', foreground: '929DB0' }, { token: 'tag', foreground: 'E29CA3' },
    { token: 'keyword.md', foreground: '9FCABC', fontStyle: 'bold' },
    { token: 'string.link.md', foreground: '89B9D8' },
  ],
  colors: {
    'editor.background': '#1C2028', 'editor.foreground': '#CED3DE',
    'editorLineNumber.foreground': '#4F5A6D', 'editorLineNumber.activeForeground': '#A8B3C6',
    'editorCursor.foreground': '#97D9C0', 'editor.selectionBackground': '#3F5C6F80',
    'editor.lineHighlightBackground': '#232933', 'editorIndentGuide.background1': '#2A303B',
    'editorIndentGuide.activeBackground1': '#454F61', 'editorWidget.background': '#222833',
    'editorWidget.border': '#3A4352', 'editor.findMatchBackground': '#64887890',
    'editor.findMatchHighlightBackground': '#64887845', 'scrollbarSlider.background': '#53607544',
    'scrollbarSlider.hoverBackground': '#53607577', 'minimap.background': '#1C2028',
  },
});
const editor = monaco.editor.create($('editor'), {
  model: null, theme: 'luma-dark', automaticLayout: true,
  fontFamily: "'SFMono-Regular', Menlo, Monaco, 'PingFang SC', monospace", fontSize: 13, lineHeight: 23,
  padding: { top: 20, bottom: 24 }, smoothScrolling: true, cursorSmoothCaretAnimation: 'on',
  scrollBeyondLastLine: false, minimap: { enabled: true, maxColumn: 80, renderCharacters: false },
  wordWrap: 'on', tabSize: 2, insertSpaces: true, renderLineHighlight: 'all',
  lineNumbersMinChars: 4, folding: true, glyphMargin: false, roundedSelection: true,
  bracketPairColorization: { enabled: true }, renderWhitespace: 'selection',
  overviewRulerBorder: false, hideCursorInOverviewRuler: true,
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: true },
  accessibilitySupport: 'auto', ariaLabel: '代码编辑器',
});
editor.addAction({ id: 'luma-format', label: '格式化文档', keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF], contextMenuGroupId: '1_modification', run: () => formatCurrent() });
editor.onDidChangeCursorSelection(updateStatus);

function toast(message: string, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => $('toast').hidden = true, error ? 6500 : 3000);
}
function report(error: unknown) { const message = error instanceof Error ? error.message : String(error); toast(message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true); }
function serialize(): Session {
  return { tabs: tabs.map(({ model, view: _view, subscription: _sub, ...tab }) => ({ ...tab, content: model.getValue() })), activeId, folder, preferences };
}
async function persistNow() { if (ready) { clearTimeout(sessionTimer); await api.saveSession(serialize()); } }
function changed() {
  if (!ready) return;
  api.setDirty(tabs.some(isDirty));
  clearTimeout(sessionTimer); sessionTimer = setTimeout(() => persistNow().catch(report), 450);
}
function makeTab(data: Partial<SavedTab> & Pick<SavedTab, 'name' | 'content'>, activate = true) {
  if (tabs.length >= 50) { toast('最多同时打开 50 个文件，请先关闭一些标签页。', true); return; }
  const language = data.language || detectLanguage(data.name);
  const id = data.id || crypto.randomUUID();
  const model = monaco.editor.createModel(data.content, language, monaco.Uri.parse(`inmemory://luma/${id}/${encodeURIComponent(data.name)}`));
  model.updateOptions({ tabSize: preferences.tabSize, insertSpaces: true });
  const tab = { id, name: data.name, path: data.path || null, content: data.content, savedContent: data.savedContent ?? data.content, mtime: data.mtime || 0, language, bom: data.bom, model, view: null } as Tab;
  tab.subscription = model.onDidChangeContent(() => {
    const value = model.getValue();
    if (value.length > 3 * 1024 * 1024 && new TextEncoder().encode(value).length > 12 * 1024 * 1024) {
      queueMicrotask(() => { if (!model.isDisposed() && model.canUndo()) { model.undo(); toast('单个文档支持最多 12 MB，本次超出大小的编辑已撤销。', true); } });
      return;
    }
    renderTabs(); renderOpenEditors(); updateStatus(); schedulePreview(); changed();
  });
  tabs.push(tab); if (activate) switchTab(tab.id); else renderTabs(); return tab;
}
function switchTab(id: string) {
  const previous = activeTab(); if (previous) previous.view = editor.saveViewState();
  activeId = id; const tab = activeTab(); if (!tab) return;
  editor.setModel(tab.model); if (tab.view) editor.restoreViewState(tab.view);
  applyPreferences(); renderTabs(); renderOpenEditors(); renderBreadcrumbs(); updateStatus(); schedulePreview(0); changed();
  requestAnimationFrame(() => editor.focus());
}
function newFile(language = 'plaintext', content = '') {
  const number = tabs.filter(t => !t.path).length + 1;
  makeTab({ name: language === 'markdown' ? `未命名-${number}.md` : `未命名-${number}`, content, savedContent: '', language });
}
function addFiles(files: FileData[]) {
  for (const file of files) { const existing = tabs.find(t => t.path === file.path); if (existing) switchTab(existing.id); else makeTab(file); }
}
async function openFiles() { try { addFiles(await api.openFiles()); } catch (error) { report(error); } }
async function openFile(path: string) {
  const existing = tabs.find(t => t.path === path); if (existing) { switchTab(existing.id); return; }
  try { addFiles([await api.readFile(path)]); } catch (error) { report(error); }
}
async function openFolder() {
  try { const selected = await api.openFolder(); if (!selected) return; folder = selected; directories.clear(); expanded.clear(); expanded.add(folder.path); await loadDirectory(folder.path); renderTree(); changed(); } catch (error) { report(error); }
}
async function loadDirectory(path: string) { directories.set(path, await api.listDirectory(path)); }
async function formatTab(tab: Tab): Promise<boolean> {
  const model = tab.model;
  const version = model.getVersionId();
  const result = await api.format({ content: model.getValue(), language: formatLanguage(tab.language, tab.name), filePath: tab.path || tab.name, tabSize: preferences.tabSize });
  if (model.isDisposed() || model.getVersionId() !== version) { toast('文档已继续编辑，本次格式化结果未应用。'); return false; }
  if (result.content !== model.getValue()) {
    model.pushStackElement();
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: result.content }], () => null);
    model.pushStackElement();
  }
  toast(`已使用 ${result.formatter} 格式化`); return true;
}
async function formatCurrent() {
  const tab = activeTab(); if (!tab || working) return;
  working = true; $('format-button').classList.add('busy');
  try { await formatTab(tab); } catch (error) { report(error); } finally { working = false; $('format-button').classList.remove('busy'); }
}
const saveInProgress = new Set<string>();
async function saveTab(tab: Tab, saveAs = false): Promise<boolean> {
  if (saveInProgress.has(tab.id)) return false;
  saveInProgress.add(tab.id);
  try {
    if (preferences.formatOnSave && !(await formatTab(tab))) return false;
    const content = tab.model.getValue();
    const saved = await api.saveFile({ path: tab.path, name: tab.name, content, mtime: tab.mtime, bom: tab.bom, saveAs });
    if (!saved) return false;
    tab.path = saved.path; tab.name = saved.name; tab.mtime = saved.mtime; tab.savedContent = content; tab.bom = saved.bom;
    if (tab.language === 'plaintext' || saveAs) { tab.language = detectLanguage(saved.name); monaco.editor.setModelLanguage(tab.model, tab.language); }
    renderTabs(); renderOpenEditors(); renderBreadcrumbs(); updateStatus(); applyPreferences(); schedulePreview(); changed();
    if (folder) {
      for (const path of expanded) { try { await loadDirectory(path); } catch { directories.delete(path); expanded.delete(path); } }
      renderTree();
    }
    toast(`已保存 ${tab.name}`); return true;
  } catch (error) { report(error); return false; } finally { saveInProgress.delete(tab.id); }
}
async function canClose(tab: Tab) {
  if (saveInProgress.has(tab.id)) { toast('正在保存，请稍候。'); return false; }
  if (!isDirty(tab)) return true;
  const answer = await api.confirmClose(tab.name);
  if (answer === 'cancel') return false;
  return answer === 'discard' || (await saveTab(tab) && !isDirty(tab));
}
const closingTabs = new Set<string>();
async function closeTab(id: string) {
  const tab = tabs.find(t => t.id === id); if (!tab || closingTabs.has(id)) return;
  closingTabs.add(id);
  try {
    if (!(await canClose(tab))) return;
    const index = tabs.indexOf(tab); tabs.splice(index, 1);
    if (id === activeId) { editor.setModel(null); activeId = null; const next = tabs[Math.min(index, tabs.length - 1)]; if (next) switchTab(next.id); }
    tab.subscription.dispose(); tab.model.dispose(); renderTabs(); renderOpenEditors(); renderBreadcrumbs(); applyPreferences(); updateStatus(); changed();
  } catch (error) { report(error); } finally { closingTabs.delete(id); }
}
async function closeWindow() {
  if (closing) return; closing = true;
  try {
    if (saveInProgress.size) { toast('文件正在保存，请稍候再关闭窗口。'); return; }
    const discarded: Tab[] = [];
    for (const tab of [...tabs]) {
      if (!isDirty(tab)) continue;
      const answer = await api.confirmClose(tab.name);
      if (answer === 'cancel' || (answer === 'save' && (!(await saveTab(tab)) || isDirty(tab)))) return;
      if (answer === 'discard') discarded.push(tab);
    }
    // Do not discard any draft if the user cancels a later close prompt.
    for (const tab of discarded) tab.model.setValue(tab.savedContent);
    await persistNow(); api.respondToClose();
  } catch (error) { report(error); } finally { closing = false; }
}
function fileIcon(language: string) { return language === 'markdown' ? 'file-text' : ['typescript','javascript'].includes(language) ? 'file-code-2' : language === 'json' ? 'braces' : 'file'; }
function renderTabs() {
  $('open-count').textContent = String(tabs.length);
  $('tabs').innerHTML = tabs.map(t => `<div class="tab ${t.id === activeId ? 'selected' : ''}" role="tab" aria-selected="${t.id === activeId}" tabindex="0" data-id="${t.id}" title="${escapeHTML(t.path || t.name)}"><span class="file-icon ${t.language}">${icon(fileIcon(t.language),14)}</span><span>${escapeHTML(t.name)}</span><button class="tab-close ${isDirty(t) ? 'dirty' : ''}" title="关闭 ${escapeHTML(t.name)}" aria-label="关闭 ${escapeHTML(t.name)}" data-close="${t.id}">${isDirty(t) ? '<span class="dirty-dot"></span>' : icon('x',12)}</button></div>`).join('');
  $('tabs').querySelectorAll<HTMLElement>('[data-id]').forEach(node => {
    node.onclick = e => { if (!(e.target as HTMLElement).closest('[data-close]')) switchTab(node.dataset.id!); };
    node.onkeydown = e => { if (e.key === 'Enter') switchTab(node.dataset.id!); };
  });
  $('tabs').querySelectorAll<HTMLElement>('[data-close]').forEach(node => node.onclick = e => { e.stopPropagation(); void closeTab(node.dataset.close!); });
  drawIcons();
}
function renderOpenEditors() {
  $('open-editors').innerHTML = tabs.map(t => `<button class="file-row ${t.id === activeId ? 'active' : ''}" data-id="${t.id}" title="${escapeHTML(t.path || '尚未保存到磁盘')}"><span class="file-icon ${t.language}">${icon(fileIcon(t.language),14)}</span><span class="filename">${escapeHTML(t.name)}</span>${isDirty(t) ? '<span class="dirty-dot"></span>' : ''}</button>`).join('');
  $('open-editors').querySelectorAll<HTMLElement>('[data-id]').forEach(node => node.onclick = () => switchTab(node.dataset.id!)); drawIcons();
}
function renderBreadcrumbs() {
  const tab = activeTab();
  if (!tab) { $('breadcrumbs').textContent = 'Luma Editor'; return; }
  const parent = tab.path?.split('/').slice(-2,-1)[0];
  $('breadcrumbs').innerHTML = `${parent ? `<span>${escapeHTML(parent)}</span>${icon('chevron-right',12)}` : '<span>编辑区</span>'+icon('chevron-right',12)}<span class="file-icon ${tab.language}">${icon(fileIcon(tab.language),13)}</span><span class="crumb-current">${escapeHTML(tab.name)}</span>${!tab.path ? '<span class="unsaved-badge">未保存</span>' : ''}`;
  $('breadcrumbs').title = tab.path || tab.name; drawIcons();
}
function renderTree() {
  $('folder-label').textContent = folder?.name || '工作区';
  if (!folder) {
    $('file-tree').innerHTML = `<div class="folder-empty">${icon('folder-open',32)}<p>让文件井然有序</p><span>打开文件夹，在这里浏览<br>你的整个项目。</span><button id="tree-open-folder" class="secondary">${icon('folder-plus',14)}打开文件夹</button><small>⇧ ⌘ O</small></div>`;
    $('tree-open-folder').onclick = openFolder; drawIcons(); return;
  }
  let rows = '';
  function walk(path: string, depth: number) {
    for (const entry of directories.get(path) || []) {
      rows += `<button class="file-row tree-row" style="padding-left:${14+depth*14}px" data-path="${escapeHTML(entry.path)}" data-directory="${entry.directory}" title="${escapeHTML(entry.path)}">${entry.directory ? icon(expanded.has(entry.path) ? 'chevron-down' : 'chevron-right',12) : '<span class="tree-spacer"></span>'}<span class="file-icon ${entry.directory ? 'folder' : detectLanguage(entry.name)}">${icon(entry.directory ? (expanded.has(entry.path) ? 'folder-open' : 'folder') : fileIcon(detectLanguage(entry.name)),14)}</span><span class="filename">${escapeHTML(entry.name)}</span></button>`;
      if (entry.directory && expanded.has(entry.path)) walk(entry.path, depth+1);
    }
  }
  walk(folder.path, 0); $('file-tree').innerHTML = rows || '<div class="directory-empty">这个文件夹中还没有文件</div>';
  $('file-tree').querySelectorAll<HTMLElement>('[data-path]').forEach(node => node.onclick = async () => {
    const path = node.dataset.path!;
    if (node.dataset.directory !== 'true') { await openFile(path); return; }
    try { if (expanded.has(path)) expanded.delete(path); else { if (!directories.has(path)) await loadDirectory(path); expanded.add(path); } renderTree(); } catch (error) { report(error); }
  }); drawIcons();
}
function applyPreferences() {
  const tab = activeTab(); const markdown = tab?.language === 'markdown'; const showPreview = !!tab && markdown && preferences.preview;
  document.documentElement.dataset.theme = preferences.theme;
  $('sidebar').hidden = !preferences.sidebar;
  $('activity-files').classList.toggle('active', preferences.sidebar);
  $('content-area').classList.toggle('split', showPreview);
  $('source-pane').hidden = !tab; $('preview-pane').hidden = !showPreview; $('splitter').hidden = !showPreview; $('empty-state').hidden = !!tab;
  $('markdown-toolbar').hidden = !markdown;
  ($('preview-button') as HTMLButtonElement).disabled = !markdown;
  $('preview-button').classList.toggle('toggled', showPreview);
  $('wrap-button').classList.toggle('toggled', preferences.wordWrap);
  editor.updateOptions({ fontSize: preferences.fontSize, lineHeight: Math.round(preferences.fontSize * 1.75), wordWrap: preferences.wordWrap ? 'on' : 'off', minimap: { enabled: preferences.minimap && !showPreview }, theme: preferences.theme === 'dark' ? 'luma-dark' : 'vs' });
  for (const t of tabs) t.model.updateOptions({ tabSize: preferences.tabSize, insertSpaces: true });
  editor.layout(); updateStatus();
}
function updateStatus() {
  const tab = activeTab(); const position = editor.getPosition(); const selection = editor.getSelection();
  $('selection-status').textContent = position ? `第 ${position.lineNumber} 行，第 ${position.column} 列${selection && !selection.isEmpty() ? ` · 已选 ${tab?.model.getValueInRange(selection).length || 0} 字符` : ''}` : '';
  $('indent-status').textContent = `空格: ${preferences.tabSize}`;
  $('encoding-status').textContent = tab?.bom ? 'UTF-8 BOM' : 'UTF-8';
  $('eol-status').textContent = tab?.model.getEOL() === '\r\n' ? 'CRLF' : 'LF';
  $('language-status').textContent = tab ? languageLabel(tab.language) : '纯文本';
  $('save-status').innerHTML = tab ? `${isDirty(tab) ? '<span class="dirty-dot"></span>' : '<span class="local-dot"></span>'}${isDirty(tab) ? '有未保存的更改' : tab.path ? '已保存到本地' : '本地草稿'}` : '就绪';
}
function schedulePreview(delay = 220) { clearTimeout(previewTimer); previewTimer = setTimeout(() => void updatePreview(), delay); }
async function updatePreview() {
  const tab = activeTab(); const seq = ++previewSequence;
  if (!tab || tab.language !== 'markdown' || !preferences.preview) return;
  const source = tab.model.getValue();
  const textLength = source.replace(/\s/g, '').length;
  $('read-time').textContent = `${textLength.toLocaleString()} 字符 · 约 ${Math.max(1,Math.ceil(textLength/500))} 分钟阅读`;
  try {
    const html = await markdownHTML(source, tab.path, api, preferences.theme === 'light');
    if (seq !== previewSequence || activeId !== tab.id) return;
    const frame = $('preview-frame') as HTMLIFrameElement;
    const scrollTop = frame.contentDocument?.scrollingElement?.scrollTop || 0;
    frame.onload = () => {
      const doc = frame.contentDocument; if (!doc) return;
      if (doc.scrollingElement) doc.scrollingElement.scrollTop = scrollTop;
      doc.addEventListener('click', event => {
        const link = (event.target as Element).closest('a'); if (!link) return; event.preventDefault();
        const href = link.getAttribute('href') || '';
        if (href.startsWith('#')) { doc.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView(); return; }
        if (/^https?:\/\//i.test(href)) { void api.openExternal(href).catch(report); return; }
        toast('此链接不是网页地址，可从文件侧栏打开本地文档。');
      });
    };
    frame.srcdoc = html;
  } catch (error) { report(error); }
}
function togglePreview() { const tab = activeTab(); if (tab?.language !== 'markdown') { toast('Markdown 文件可使用实时预览。'); return; } preferences.preview = !preferences.preview; applyPreferences(); schedulePreview(0); changed(); }
function insertMarkdown(prefix: string, suffix = '', placeholder = '文字') {
  const selection = editor.getSelection(); const tab = activeTab(); if (!selection || !tab) return;
  const text = tab.model.getValueInRange(selection) || placeholder;
  editor.pushUndoStop(); editor.executeEdits('markdown-toolbar', [{ range: selection, text: prefix+text+suffix }]); editor.pushUndoStop(); editor.focus();
}

type PaletteItem = { label: string; description?: string; shortcut?: string; symbol?: string; run: () => void | Promise<void> };
let paletteIndex = 0; let paletteFiltered: PaletteItem[] = []; let paletteItems: PaletteItem[] = [];
function closeModal() { ++settingsSequence; $('modal-root').innerHTML = ''; editor.focus(); }
function showPalette(title: string, items: PaletteItem[]) {
  ++settingsSequence;
  paletteItems = items; paletteIndex = 0;
  $('modal-root').innerHTML = `<div class="modal-overlay palette-overlay"><section class="palette" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}"><div class="palette-input-wrap">${icon('search',19)}<input id="palette-input" autocomplete="off" placeholder="${escapeHTML(title)}" aria-label="${escapeHTML(title)}"><kbd>esc</kbd></div><div id="palette-list" class="palette-list" role="listbox"></div><div class="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span></div></section></div>`;
  $('modal-root').querySelector('.modal-overlay')!.addEventListener('mousedown', e => { if (e.target === e.currentTarget) closeModal(); });
  const input = $('palette-input') as HTMLInputElement;
  input.oninput = () => { paletteIndex = 0; renderPalette(); };
  input.onkeydown = e => {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = Math.max(0, Math.min(paletteFiltered.length-1, paletteIndex + (e.key === 'ArrowDown' ? 1 : -1))); renderPalette(false); }
    else if (e.key === 'Enter') { e.preventDefault(); const item = paletteFiltered[paletteIndex]; if (item) { closeModal(); void Promise.resolve(item.run()).catch(report); } }
  };
  renderPalette(); input.focus();
}
function renderPalette(filter = true) {
  if (!$('palette-input')) return;
  if (filter) { const query = ($('palette-input') as HTMLInputElement).value.toLowerCase(); paletteFiltered = paletteItems.filter(i => `${i.label} ${i.description || ''}`.toLowerCase().includes(query)).slice(0,100); }
  $('palette-list').innerHTML = paletteFiltered.length ? paletteFiltered.map((item,i) => `<button class="palette-item ${i === paletteIndex ? 'selected' : ''}" role="option" aria-selected="${i === paletteIndex}" data-index="${i}">${icon(item.symbol || 'file',16)}<span><b>${escapeHTML(item.label)}</b>${item.description ? `<small>${escapeHTML(item.description)}</small>` : ''}</span>${item.shortcut ? `<kbd>${item.shortcut}</kbd>` : ''}</button>`).join('') : '<div class="palette-empty">没有找到匹配项</div>';
  $('palette-list').querySelectorAll<HTMLElement>('[data-index]').forEach(node => node.onclick = () => { const item = paletteFiltered[Number(node.dataset.index)]; closeModal(); void Promise.resolve(item.run()).catch(report); });
  $('palette-list').querySelector('.selected')?.scrollIntoView({ block: 'nearest' }); drawIcons();
}
const commandItems = (): PaletteItem[] => [
  { label: '新建文件', shortcut: '⌘ N', symbol: 'file-plus-2', run: () => newFile() },
  { label: '新建 Markdown', symbol: 'file-text', run: () => newFile('markdown') },
  { label: '打开文件…', shortcut: '⌘ O', symbol: 'file', run: openFiles },
  { label: '打开文件夹…', shortcut: '⇧ ⌘ O', symbol: 'folder-open', run: openFolder },
  { label: '保存文件', shortcut: '⌘ S', symbol: 'save', run: async () => { const t = activeTab(); if(t) await saveTab(t); } },
  { label: '另存为…', shortcut: '⇧ ⌘ S', symbol: 'save-all', run: async () => { const t=activeTab(); if(t) await saveTab(t,true); } },
  { label: '格式化文档', shortcut: '⇧ ⌥ F', symbol: 'wand-sparkles', run: formatCurrent },
  { label: '切换 Markdown 预览', shortcut: '⇧ ⌘ M', symbol: 'panel-right', run: togglePreview },
  { label: '查找', shortcut: '⌘ F', symbol: 'search', run: () => editor.trigger('palette','actions.find',null) },
  { label: '查找并替换', shortcut: '⌥ ⌘ F', symbol: 'replace', run: () => editor.trigger('palette','editor.action.startFindReplaceAction',null) },
  { label: '跳转到行…', shortcut: '⌃ G', symbol: 'corner-down-right', run: () => editor.trigger('palette','editor.action.gotoLine',null) },
  { label: '切换自动换行', symbol: 'wrap-text', run: () => { preferences.wordWrap = !preferences.wordWrap; applyPreferences(); changed(); } },
  { label: '切换文件侧栏', shortcut: '⌘ B', symbol: 'panel-left', run: toggleSidebar },
  { label: '选择文件语言…', symbol: 'code', run: chooseLanguage },
  { label: '切换明亮 / 深色主题', symbol: 'sun-moon', run: () => { preferences.theme = preferences.theme === 'dark' ? 'light' : 'dark'; applyPreferences(); schedulePreview(0); changed(); } },
  { label: '在 Finder 中显示', symbol: 'folder-symlink', run: async () => { const t=activeTab(); if(t?.path) await api.revealFile(t.path); else toast('请先保存文件。'); } },
  { label: '设置与格式化工具…', shortcut: '⌘ ,', symbol: 'settings-2', run: showSettings },
];
function chooseLanguage() {
  const tab = activeTab(); if (!tab) return;
  showPalette('选择语言模式…', languageList().map(l => ({ label: l.label, description: l.id, symbol: 'code', run: () => { tab.language = l.id; monaco.editor.setModelLanguage(tab.model, l.id); renderTabs(); renderOpenEditors(); renderBreadcrumbs(); applyPreferences(); schedulePreview(0); changed(); } })));
}
async function quickOpen() {
  const items: PaletteItem[] = tabs.map(t => ({ label: t.name, description: t.path || '已打开 · 本地草稿', symbol: fileIcon(t.language), run: () => switchTab(t.id) }));
  showPalette('搜索文件名…', items);
  const input = $('palette-input'); const currentFolder = folder;
  if (!currentFolder) return;
  const seen = new Set(tabs.map(t => t.path)); let count = 0;
  async function walk(path: string, depth: number) {
    if (depth > 12 || count > 4000 || $('palette-input') !== input) return;
    if (!directories.has(path)) await loadDirectory(path);
    for (const entry of directories.get(path) || []) {
      if (++count > 4000 || $('palette-input') !== input) return;
      if (entry.directory) await walk(entry.path,depth+1);
      else if (!seen.has(entry.path)) { items.push({ label: entry.name, description: entry.path.slice(currentFolder!.path.length+1), symbol: fileIcon(detectLanguage(entry.name)), run: () => openFile(entry.path) }); seen.add(entry.path); }
    }
  }
  try { await walk(currentFolder.path,0); if ($('palette-input') === input) { paletteItems = items; renderPalette(); } } catch (error) { report(error); }
}
function toggleSidebar() { preferences.sidebar = !preferences.sidebar; applyPreferences(); changed(); }

async function showSettings() {
  const seq = ++settingsSequence;
  $('modal-root').innerHTML = `<div class="modal-overlay"><section class="settings-modal" role="dialog" aria-modal="true" aria-label="设置"><div class="settings-header"><div><span class="eyebrow">MAKE IT YOURS</span><h2>你的编辑习惯。</h2></div>${button('settings-close','x','关闭设置')}</div><div class="settings-scroll"><h3>编辑器</h3><div class="setting-row"><label for="font-size">字号 <small>找到舒适的阅读节奏</small></label><select id="font-size">${[11,12,13,14,15,16,18,20,22,24].map(n=>`<option ${preferences.fontSize===n?'selected':''}>${n}</option>`).join('')}</select></div><div class="setting-row"><label for="tab-size">缩进宽度</label><select id="tab-size">${[2,4,8].map(n=>`<option value="${n}" ${preferences.tabSize===n?'selected':''}>${n} 个空格</option>`).join('')}</select></div>${(['wordWrap','minimap','formatOnSave'] as const).map((key,i)=>`<div class="setting-row"><label for="pref-${key}">${['自动换行','显示代码缩略图','保存时格式化'][i]}${key === 'formatOnSave' ? '<small>格式化失败时保留原内容并取消保存</small>' : ''}</label><input type="checkbox" role="switch" class="switch" id="pref-${key}" ${preferences[key]?'checked':''}></div>`).join('')}<div class="setting-row"><label for="theme-select">外观</label><select id="theme-select"><option value="dark" ${preferences.theme==='dark'?'selected':''}>石墨深色</option><option value="light" ${preferences.theme==='light'?'selected':''}>纸张浅色</option></select></div><h3 class="formatter-title">语言格式化 <span>本地处理</span></h3><p class="settings-note">常用语言开箱即用。其他语言可使用已安装的格式化工具，或在下方添加自定义工具。</p><div id="formatter-grid" class="formatter-grid"><span class="settings-note">正在检测本机格式化工具…</span></div><details class="custom-formatter"><summary>接入其他语言的格式化工具 ${icon('plus',14)}</summary><p class="settings-note">工具从标准输入读取文本，向标准输出返回结果。程序直接运行，不经过 Shell。<code>{filepath}</code> 代表临时文档副本。</p><div class="custom-fields"><label>语言 ID<input id="custom-language" placeholder="例如 python 或 kotlin" list="formatter-languages"><datalist id="formatter-languages">${languageList().map(l=>`<option value="${escapeHTML(l.id)}">${escapeHTML(l.label)}</option>`).join('')}</datalist></label><label>程序<input id="custom-command" placeholder="例如 /opt/homebrew/bin/ruff"></label><label>参数（JSON 数组）<input id="custom-args" placeholder='["format", "--stdin-filename", "{filepath}", "-"]'></label><button id="custom-save" class="primary">保存格式化工具</button></div><div id="custom-existing"></div></details><div class="about-luma"><span class="brand-mark">L</span><div>Luma Editor <small>1.0.0 · 为专注而设计</small></div><span>文件始终留在本机</span></div></div></section></div>`;
  $('settings-close').onclick = closeModal;
  $('modal-root').querySelector('.modal-overlay')!.addEventListener('mousedown', e => { if (e.target === e.currentTarget) closeModal(); });
  ($('font-size') as HTMLSelectElement).onchange = () => { preferences.fontSize = Number(($('font-size') as HTMLSelectElement).value); applyPreferences(); changed(); };
  ($('tab-size') as HTMLSelectElement).onchange = () => { preferences.tabSize = Number(($('tab-size') as HTMLSelectElement).value); applyPreferences(); changed(); };
  for (const key of ['wordWrap','minimap','formatOnSave'] as const) ($(`pref-${key}`) as HTMLInputElement).onchange = () => { preferences[key] = ($(`pref-${key}`) as HTMLInputElement).checked; applyPreferences(); changed(); };
  ($('theme-select') as HTMLSelectElement).onchange = () => { preferences.theme = ($('theme-select') as HTMLSelectElement).value as Preferences['theme']; applyPreferences(); schedulePreview(0); changed(); };
  let external: Record<string,ExternalFormatter> = {};
  const renderExternal = () => {
    if (!$('custom-existing')) return;
    $('custom-existing').innerHTML = Object.entries(external).map(([language, value]) => `<div class="external-row"><span><b>${escapeHTML(language)}</b><code>${escapeHTML(value.command)}</code></span><button data-remove="${escapeHTML(language)}" title="移除自定义格式化工具">${icon('trash-2',14)}</button></div>`).join('');
    $('custom-existing').querySelectorAll<HTMLElement>('[data-remove]').forEach(node=>node.onclick=async()=>{ try { const next = { ...external }; delete next[node.dataset.remove!]; await api.setExternalFormatters(next); external = next; renderExternal(); await refreshStatus(); } catch(error){report(error);} }); drawIcons();
  };
  const refreshStatus = async () => {
    const statuses = await api.formatterStatus(); if (seq !== settingsSequence || !$('formatter-grid')) return;
    $('formatter-grid').innerHTML = statuses.map(s=>`<div class="formatter-chip ${s.available?'available':''}" title="${escapeHTML(s.detail)}"><span class="${s.available?'local-dot':'missing-dot'}"></span><span>${escapeHTML(s.label)}</span><small>${s.kind==='builtin'?'内置':s.available?'已就绪':'需安装'}</small></div>`).join('');
  };
  $('custom-save').onclick = async () => {
    try {
      const language = ($('custom-language') as HTMLInputElement).value.trim().toLowerCase();
      const command = ($('custom-command') as HTMLInputElement).value.trim();
      const args = JSON.parse(($('custom-args') as HTMLInputElement).value || '[]');
      if (!language || !command) throw new Error('请填写语言 ID 和程序。');
      const next = {...external, [language]: {command,args}}; await api.setExternalFormatters(next); external = next; renderExternal(); await refreshStatus(); toast('已保存自定义格式化工具');
    } catch (error) { report(error); }
  };
  drawIcons(); $('settings-close').focus();
  try { external = await api.getExternalFormatters(); if (seq !== settingsSequence) return; renderExternal(); await refreshStatus(); } catch(error) { report(error); }
}

function executeCommand(command: string) {
  if (!ready) return;
  const handlers: Record<string,()=>void|Promise<unknown>> = {
    new: () => newFile(), 'new-markdown': () => newFile('markdown'), open: openFiles, 'open-folder': openFolder,
    save: () => { const t=activeTab(); if(t) return saveTab(t); }, 'save-as': () => { const t=activeTab(); if(t) return saveTab(t,true); },
    'close-tab': () => { if(activeId) return closeTab(activeId); }, format: formatCurrent,
    find: () => editor.trigger('menu','actions.find',null), replace: () => editor.trigger('menu','editor.action.startFindReplaceAction',null),
    'command-palette': () => showPalette('输入命令…',commandItems()), 'quick-open': quickOpen,
    'toggle-preview': togglePreview, settings: showSettings, 'toggle-sidebar': toggleSidebar,
  };
  try { void Promise.resolve(handlers[command]?.()).catch(report); } catch(error) { report(error); }
}

const bindings: Record<string,()=>void|Promise<unknown>> = {
  'sidebar-new': () => newFile(), 'tab-new': () => newFile(), 'sidebar-folder': openFolder,
  'empty-new': () => newFile(), 'empty-open': openFiles,
  'top-search': quickOpen, 'activity-files': toggleSidebar, 'activity-search': () => executeCommand('find'),
  'activity-command': () => executeCommand('command-palette'), 'activity-settings': showSettings, 'status-settings': showSettings,
  'activity-help': () => { const t=tabs.find(t=>t.name==='欢迎.md'&&!t.path); if(t) switchTab(t.id); else makeTab({name:'欢迎.md',content:welcome}); },
  'format-button': formatCurrent, 'preview-button': togglePreview, 'preview-close': togglePreview,
  'preview-refresh': updatePreview, 'wrap-button': () => { preferences.wordWrap=!preferences.wordWrap; applyPreferences(); changed(); },
  'language-status': chooseLanguage, 'indent-status': () => showPalette('选择缩进宽度…',[2,4,8].map(n=>({label:`${n} 个空格`,symbol:'indent-increase',run:()=>{preferences.tabSize=n;applyPreferences();changed();}}))),
  'refresh-tree': async()=>{if(folder){directories.clear();expanded.clear();expanded.add(folder.path);await loadDirectory(folder.path);renderTree();}},
  'md-heading': () => insertMarkdown('## ', '', '标题'), 'md-bold': () => insertMarkdown('**','**'), 'md-italic': () => insertMarkdown('*','*'),
  'md-link': () => insertMarkdown('[','](https://example.com)','链接文字'), 'md-code': () => insertMarkdown('\n```\n','\n```\n','代码'),
  'md-list': () => insertMarkdown('- ', '', '列表项'), 'md-quote': () => insertMarkdown('> ', '', '引用'),
};
Object.entries(bindings).forEach(([id,fn]) => $(id).onclick = () => { void Promise.resolve(fn()).catch(report); });

// Native menus own global accelerators, avoiding duplicate dispatch on macOS.
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('modal-root').children.length) { event.preventDefault(); closeModal(); }
  // Keep keyboard focus inside an open dialog.
  if (event.key === 'Tab' && $('modal-root').children.length) {
    const nodes = [...$('modal-root').querySelectorAll<HTMLElement>('button,input,select,summary,[tabindex="0"]')].filter(n=>n.offsetParent!==null);
    const first=nodes[0], last=nodes[nodes.length-1];
    if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first?.focus(); }
  }
});
let resizing = false;
$('splitter').onpointerdown = e => { resizing = true; $('splitter').setPointerCapture(e.pointerId); document.body.classList.add('resizing'); };
$('splitter').onpointermove = e => { if(!resizing)return; const rect=$('content-area').getBoundingClientRect(); const percent=Math.max(25,Math.min(75,100*(e.clientX-rect.left)/rect.width)); $('content-area').style.setProperty('--split',`${percent}%`); editor.layout(); };
$('splitter').onpointerup = () => { resizing=false; document.body.classList.remove('resizing'); };
$('splitter').onkeydown = e => { if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const old=parseFloat($('content-area').style.getPropertyValue('--split'))||50;$('content-area').style.setProperty('--split',`${Math.max(25,Math.min(75,old+(e.key==='ArrowLeft'?-5:5)))}%`);editor.layout();} };

async function start() {
  if (!api) { $('editor').innerHTML='<div class="runtime-message"><h2>请从 Luma Editor.app 打开</h2><p>本地文件编辑需要桌面应用环境。</p></div>'; return; }
  api.onCommand(executeCommand); api.onOpenFiles(files => { if (ready) addFiles(files); else startupFiles.push(...files); }); api.onCloseRequested(closeWindow);
  try {
    const session = await api.loadSession();
    if(session){
      preferences={...preferences,...session.preferences};folder=session.folder;
      for (const t of session.tabs || []) {
        if (t.path && t.content === t.savedContent) {
          try { const disk = await api.readFile(t.path); makeTab({...t,...disk,savedContent:disk.content},false); }
          catch { makeTab({...t,path:null,mtime:0,savedContent:''},false); toast(`无法读取 ${t.name}，已保留内容为本地草稿。`,true); }
        } else makeTab(t,false);
      }
      activeId=tabs.some(t=>t.id===session.activeId)?session.activeId:tabs[0]?.id||null;
    }
    else {makeTab({name:'欢迎.md',content:welcome},false);makeTab({name:'示例.ts',content:sampleCode},false);activeId=tabs[0].id;}
    ready=true;
    if(activeId)switchTab(activeId);
    if(startupFiles.length)addFiles(startupFiles.splice(0));
    applyPreferences();renderTabs();renderOpenEditors();renderBreadcrumbs();renderTree();
    if(folder){try{expanded.add(folder.path);await loadDirectory(folder.path);renderTree();}catch(error){report(error);}}
    changed();
  }catch(error){ready=true;report(error);newFile();renderTree();}
}
void start();
