import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileAccess, MAX_FILE_BYTES, SessionStore, readJSON, readTextFile, saveTextFile, validateSession } from '../electron/storage.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-storage-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('UTF-8 BOM round-trips while mode is preserved by atomic save', async t => {
  const dir = await fixture(t);
  const file = path.join(dir, 'notes.md');
  await fs.writeFile(file, '\uFEFF你好\r\nworld\r\n', { mode: 0o640 });
  const opened = await readTextFile(file);
  assert.equal(opened.content, '你好\r\nworld\r\n');
  assert.equal(opened.bom, true);
  const saved = await saveTextFile({ filePath: file, content: '更新\r\n', bom: opened.bom, expectedMtime: opened.mtime });
  assert.equal(saved.content, '更新\r\n');
  assert.equal(await fs.readFile(file, 'utf8'), '\uFEFF更新\r\n');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o640);
  assert.deepEqual(await fs.readdir(dir), ['notes.md']);
});

test('external modification and deletion refuse stale saves without changing disk', async t => {
  const dir = await fixture(t);
  const file = path.join(dir, 'conflict.txt');
  await fs.writeFile(file, 'first');
  const original = await readTextFile(file);
  await fs.writeFile(file, 'external');
  await fs.utimes(file, new Date(), new Date(original.mtime + 3000));
  await assert.rejects(saveTextFile({ filePath: file, content: 'editor', expectedMtime: original.mtime }), { code: 'EFILECONFLICT' });
  assert.equal(await fs.readFile(file, 'utf8'), 'external');
  await fs.unlink(file);
  await assert.rejects(saveTextFile({ filePath: file, content: 'editor', expectedMtime: original.mtime }), { code: 'EFILECONFLICT' });
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});

test('binary, invalid UTF-8 and oversized files are rejected', async t => {
  const dir = await fixture(t);
  for (const [name, bytes, message] of [['binary', Buffer.from([65, 0, 66]), /二进制/], ['invalid', Buffer.from([0xff, 0xfe, 65]), /UTF-8/], ['large', Buffer.alloc(MAX_FILE_BYTES + 1, 65), /12 MB/]]) {
    const file = path.join(dir, name);
    await fs.writeFile(file, bytes);
    await assert.rejects(readTextFile(file), message);
  }
});

test('folder authorization rejects symlink escapes and sibling prefix paths', async t => {
  const directory = await fixture(t);
  const root = path.join(directory, 'project');
  const sibling = path.join(directory, 'project-other');
  await fs.mkdir(root); await fs.mkdir(sibling);
  const inside = path.join(root, 'ok.txt');
  const outside = path.join(sibling, 'private.txt');
  await fs.writeFile(inside, 'allowed'); await fs.writeFile(outside, 'private');
  await fs.symlink(outside, path.join(root, 'escape.txt'));
  const access = new FileAccess();
  await access.grantFolder(root);
  assert.equal(await access.assert(inside), await fs.realpath(inside));
  await assert.rejects(access.assert(outside), /授权/);
  await assert.rejects(access.assert(path.join(root, 'escape.txt')), /授权/);
  await access.grantFile(outside);
  assert.equal(await access.assert(outside), await fs.realpath(outside));
});

test('session writes are debounced, serialized and explicitly flushed', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'session.json');
  const store = new SessionStore(file, 10000);
  store.schedule({ draft: 'first' });
  store.schedule({ draft: 'latest' });
  await store.flush();
  assert.deepEqual(await readJSON(file), { draft: 'latest' });
  store.schedule({ draft: 'third' });
  const flushing = store.flush();
  store.schedule({ draft: 'last' });
  await Promise.all([flushing, store.flush()]);
  assert.deepEqual(await readJSON(file), { draft: 'last' });
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('authorized draft metadata survives a removed parent while actual I/O remains guarded', async t => {
  const dir = await fixture(t);
  const root = path.join(dir, 'removed');
  await fs.mkdir(root);
  const file = path.join(root, 'draft.md');
  await fs.writeFile(file, 'original');
  const access = new FileAccess();
  const canonicalFile = await access.grantFile(file);
  const canonicalRoot = await access.grantFolder(root);
  await fs.rm(root, { recursive: true });
  assert.equal(access.assertMetadata(canonicalFile), canonicalFile);
  assert.equal(access.assertMetadata(canonicalRoot), canonicalRoot);
  assert.throws(() => access.assertMetadata(path.join(dir, 'outside.md')), /授权/);
  await assert.rejects(access.assert(file), { code: 'ENOENT' });
});

test('session validation preserves drafts and rejects duplicate tab identifiers', () => {
  const tab = { id: 'one', path: null, name: '未命名', content: 'draft', savedContent: '', mtime: 0, language: 'markdown' };
  const session = validateSession({ tabs: [tab], activeId: 'one', folder: null, preferences: { fontSize: 999, tabSize: 4 } });
  assert.equal(session.tabs[0].content, 'draft');
  assert.equal(session.preferences.fontSize, 32);
  assert.equal(session.preferences.tabSize, 4);
  assert.throws(() => validateSession({ tabs: [tab, tab] }), /标签页/);
});
