import { _electron as electron } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const qa = path.resolve(root, '../qa');
const userData = path.join(qa, `userdata-${Date.now()}`);
const fixtures = path.join(qa, `fixtures-${Date.now()}`);
await fs.mkdir(path.join(fixtures, 'nested'), { recursive: true });
const codePath = path.join(fixtures, 'nested', 'format.ts');
const cleanPath = path.join(fixtures, 'clean.md');
const draftPath = path.join(fixtures, 'draft.md');
const invalidPath = path.join(fixtures, 'invalid.json');
const pastePath = path.join(fixtures, 'paste.js');
await fs.writeFile(codePath, 'const message={hello:"world",items:[1,2,3]};\n');
await fs.writeFile(cleanPath, '# CLEAN ORIGINAL\n');
await fs.writeFile(draftPath, '# DRAFT ORIGINAL\n');
await fs.writeFile(invalidPath, '{ invalid: \n');
await fs.writeFile(pastePath, '');
const results = [];
const errors = [];
let app, page;
const note = value => { results.push(value); console.log(value); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, description, timeout = 10000) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) { try { const value = await test(); if (value) return value; } catch (error) { last = error; } await sleep(100); }
  throw new Error(`Timed out: ${description}${last ? `: ${last.message}` : ''}`);
}
async function session() { return JSON.parse(await fs.readFile(path.join(userData, 'session.json'), 'utf8')); }
async function tabContent(name, expected) {
  return until(async () => { const t = (await session()).tabs.find(t => t.name === name); return t && (expected === undefined || t.content === expected) ? t : null; }, `${name} content ${expected ?? ''}`);
}
async function launch() {
  app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, LUMA_USER_DATA: userData }, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ type: 'console', message: message.text() }); });
  await page.locator('#tabs .tab').first().waitFor();
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: options.properties.includes('openDirectory') ? [p.fixtures] : [p.codePath, p.cleanPath, p.draftPath, p.invalidPath, p.pastePath] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p.codePath });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, { fixtures, codePath, cleanPath, draftPath, invalidPath, pastePath });
}
async function command(name) {
  await page.locator('#activity-command').click();
  await page.locator('#palette-input').fill(name);
  await page.locator('.palette-item').filter({ has: page.locator('b', { hasText: name }) }).first().click();
}
async function selectTab(name) { await page.locator('#tabs .tab').filter({ hasText: name }).click(); }
async function replaceText(text) {
  await page.locator('.monaco-editor').click({ position: { x: 240, y: 85 } });
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(text);
}
async function save() { await command('保存文件'); await until(async () => !(await page.locator('#save-status').innerText()).includes('未保存'), 'save status'); }
try {
  await launch();
  await page.frameLocator('#preview-frame').getByText('好的想法，从这里开始。', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(qa, '01-welcome.png') });
  note('PASS welcome renders with Markdown preview');
  await replaceText('# QA LIVE PREVIEW\n\n**实时预览成功**\n');
  await page.frameLocator('#preview-frame').getByText('QA LIVE PREVIEW', { exact: true }).waitFor();
  await tabContent('欢迎.md', '# QA LIVE PREVIEW\n\n**实时预览成功**\n');
  note('PASS editing updates Markdown preview and persists draft');

  await command('打开文件…');
  await selectTab('format.ts');
  const original = await fs.readFile(codePath, 'utf8');
  await page.locator('#format-button').click();
  await until(async () => (await page.locator('#toast').innerText()).includes('已使用'), 'format success');
  const formatted = await until(async () => { const t = await tabContent('format.ts'); return t.content !== original ? t.content : null; }, 'formatted content persisted');
  assert.notEqual(formatted, original);
  await page.locator('.monaco-editor').click({ position: { x: 240, y: 85 } });
  await page.keyboard.press('Meta+Z');
  await tabContent('format.ts', original);
  await page.keyboard.press('Meta+Shift+Z');
  await tabContent('format.ts', formatted);
  await save();
  assert.equal(await fs.readFile(codePath, 'utf8'), formatted);
  note('PASS actual format, Cmd+Z undo, Cmd+Shift+Z redo, and save to disk');

  const beforeOrder = await page.locator('#tabs .tab').evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
  await page.locator('#tabs .tab').filter({ hasText: 'format.ts' }).dragTo(page.locator('#tabs .tab').filter({ hasText: 'clean.md' }));
  const afterOrder = await page.locator('#tabs .tab').evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
  assert.notDeepEqual(afterOrder, beforeOrder);
  await until(async () => {
    const persisted = (await session()).tabs.map(tab => tab.name);
    return JSON.stringify(persisted) === JSON.stringify(afterOrder);
  }, 'tab order persisted');
  note('PASS tabs can be dragged to reorder');

  await selectTab('paste.js');
  await page.locator('.monaco-editor').click({ position: { x: 240, y: 85 } });
  await app.evaluate(({ clipboard }) => clipboard.writeText('const pasted={answer:42};'));
  await page.keyboard.press('Meta+V');
  await until(async () => (await tabContent('paste.js')).content.includes('const pasted = { answer: 42 };'), 'auto-formatted pasted snippet');
  note('PASS pasted code is detected and formatted in place');

  await page.locator('#sidebar-folder').click();
  await page.locator('#file-tree [data-directory="true"]').filter({ hasText: 'nested' }).click();
  await page.locator('#file-tree .filename').getByText('format.ts', { exact: true }).waitFor();
  await selectTab('format.ts');
  const second = 'const second={works:true};\n';
  await replaceText(second);
  await save();
  await page.locator('#file-tree .filename').getByText('format.ts', { exact: true }).waitFor();
  assert.equal(await fs.readFile(codePath, 'utf8'), second);
  note('PASS expanded file tree keeps children after save');

  await page.locator('#activity-settings').click();
  await page.locator('#formatter-grid .formatter-chip').first().waitFor();
  assert.ok(await page.locator('#formatter-grid .formatter-chip.available').count() >= 20);
  await page.locator('#theme-select').selectOption('light');
  await page.locator('#settings-close').click();
  await page.screenshot({ path: path.join(qa, '02-light-editor.png') });
  await page.locator('#activity-settings').click();
  await page.locator('#theme-select').selectOption('dark');
  await page.locator('#settings-close').click();
  note('PASS settings render formatter availability and toggle light/dark theme');

  await selectTab('invalid.json');
  const invalid = await fs.readFile(invalidPath, 'utf8');
  await page.locator('#format-button').click();
  await page.locator('#toast.error').waitFor();
  assert.equal((await tabContent('invalid.json')).content, invalid);
  assert.equal(await fs.readFile(invalidPath, 'utf8'), invalid);
  note('PASS malformed JSON formatting reports error without changing text or disk');

  await page.locator('#top-search').click();
  await page.locator('#palette-input').fill('clean');
  await page.locator('.palette-item').filter({ hasText: 'clean.md' }).click();
  await page.frameLocator('#preview-frame').getByText('CLEAN ORIGINAL', { exact: true }).waitFor();
  note('PASS quick-open filters and selects requested file');
  await selectTab('draft.md');
  const draft = '# UNSAVED SURVIVES\n\n本地草稿恢复测试。\n';
  await replaceText(draft);
  await tabContent('draft.md', draft);
  await page.screenshot({ path: path.join(qa, '03-markdown-edited.png') });
  app.process().kill('SIGKILL');
  await sleep(250);
  await fs.writeFile(cleanPath, '# CLEAN EXTERNAL UPDATE\n');
  await fs.writeFile(draftPath, '# DRAFT EXTERNAL UPDATE\n');
  await launch();
  await selectTab('clean.md');
  await page.frameLocator('#preview-frame').getByText('CLEAN EXTERNAL UPDATE', { exact: true }).waitFor();
  assert.equal((await tabContent('clean.md', '# CLEAN EXTERNAL UPDATE\n')).content, '# CLEAN EXTERNAL UPDATE\n');
  await selectTab('draft.md');
  await page.frameLocator('#preview-frame').getByText('UNSAVED SURVIVES', { exact: true }).waitFor();
  assert.equal((await tabContent('draft.md')).content, draft);
  assert.equal(await fs.readFile(draftPath, 'utf8'), '# DRAFT EXTERNAL UPDATE\n');
  await page.screenshot({ path: path.join(qa, '04-restored-draft.png') });
  note('PASS after crash/relaunch clean tabs reread disk while dirty drafts survive external changes');

  await app.evaluate(({ dialog }) => {
    globalThis.__qaPrompts = [];
    dialog.showMessageBox = async (_window, options) => { globalThis.__qaPrompts.push(options.title); return { response: options.title === '文件已更改' ? 0 : 1 }; };
  });
  await command('保存文件');
  await until(async () => app.evaluate(() => globalThis.__qaPrompts.includes('文件已更改')), 'file conflict confirmation');
  assert.equal(await fs.readFile(draftPath, 'utf8'), '# DRAFT EXTERNAL UPDATE\n');
  assert.equal((await tabContent('draft.md')).content, draft);
  note('PASS cancel external-change conflict leaves disk and draft unchanged');
  await page.locator('#tabs .tab').filter({ hasText: 'draft.md' }).locator('.tab-close').click();
  await until(async () => app.evaluate(() => globalThis.__qaPrompts.includes('保存修改')), 'dirty close confirmation');
  assert.equal(await page.locator('#tabs .tab').filter({ hasText: 'draft.md' }).count(), 1);
  note('PASS cancel dirty-tab close preserves tab and content');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650));
  await until(async () => (await page.locator('body').boundingBox()).width === 900, 'compact window size');
  const sourceBox = await page.locator('#source-pane').boundingBox();
  const previewBox = await page.locator('#preview-pane').boundingBox();
  assert.ok(sourceBox.width > 150 && previewBox.width > 150);
  assert.ok(sourceBox.x + sourceBox.width <= previewBox.x + 1);
  await page.screenshot({ path: path.join(qa, '05-compact-900x650.png') });
  note('PASS 900x650 window keeps source and preview side by side without overlap');

  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2 }); });
  await page.locator('#tabs .tab').filter({ hasText: 'draft.md' }).locator('.tab-close').click();
  await until(async () => (await page.locator('#tabs .tab').filter({ hasText: 'draft.md' }).count()) === 0, 'discard removes tab');
  await until(async () => !(await session()).tabs.some(t => t.name === 'draft.md'), 'discard removes persisted draft');
  assert.equal(await fs.readFile(draftPath, 'utf8'), '# DRAFT EXTERNAL UPDATE\n');
  note('PASS discard dirty tab removes draft without changing external file');
  await app.close(); app = null;
  note('PASS normal application close completes after chosen discard prompts');
  note(`PAGE_ERRORS ${JSON.stringify(errors)}`);
} catch (error) {
  note(`FAIL ${error.stack}`);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(qa, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(qa, 'smoke-results.json'), JSON.stringify({ results, errors, userData, fixtures, dialogs: 'Native file selection and close-confirm dialog return values were stubbed; all document edits and application commands used UI locators/keyboards.' }, null, 2));
  if (app?.process() && !app.process().killed) app.process().kill('SIGKILL');
}
