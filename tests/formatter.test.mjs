import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { formatDocument, getFormatterStatus, validateExternalFormatters, FORMAT_TIMEOUT_MS } from '../electron/formatter.mjs';

const fixture = (content, language, rest = {}) => ({ content, language, ...rest });
const nodeFormatter = (script, args = []) => ({ customlang: { command: process.execPath, args: ['-e', script, '--', ...args] } });
const echoScript = 'process.stdin.pipe(process.stdout)';

test('JavaScript, TypeScript and JSON produce real structural formatting', async () => {
  assert.deepEqual(await formatDocument(fixture('const x={a:1,b:[2,3]}', 'javascript')), {
    content: 'const x = { a: 1, b: [2, 3] };\n', formatter: 'Prettier',
  });
  assert.equal((await formatDocument(fixture('const x:number=1', 'typescript'))).content, 'const x: number = 1;\n');
  assert.equal((await formatDocument(fixture('{"a":1,"b":[2,3]}', 'json'))).content, '{ "a": 1, "b": [2, 3] }\n');
});

const builtinSamples = [
  ['javascriptreact', 'const C=()=> <div x={1}>Hi</div>'],
  ['typescriptreact', 'const C=():JSX.Element=> <div>Hi</div>'],
  ['jsonc', '{// note\n"x":1,}'],
  ['html', '<div><p>Hi</p><p>there</p></div>'],
  ['css', 'a{color:red;background:white}'],
  ['scss', '$color:red; a{color:$color;&:hover{color:blue}}'],
  ['less', '@color:red; a{color:@color}'],
  ['markdown', '# Title\n\n-   one\n-   two\n'],
  ['mdx', '# Title\n\n<div x={1+2}/>'],
  ['yaml', 'items: [a,b,c]\n'],
  ['graphql', 'query{user(id:1){name email}}'],
  ['vue', '<template><div>{{ count }}</div></template><script>const count=1</script>'],
  ['angular', '<div *ngIf="visible">{{name}}</div>'],
  ['handlebars', '<div>{{name}}</div>'],
  ['java', 'class Main{public static void main(String[] args){System.out.println("Hi");}}'],
  ['xml', '<root><item x="1"/><item x="2"/></root>'],
  ['php', '<?php $x=[1,2]; echo $x[0];'],
  ['toml', 'name="luma"\nitems=[1,2,3]\n'],
  ['sql', 'select id,name from users where active=1 order by name'],
];

for (const [language, content] of builtinSamples) {
  test(`bundled ${language} formatter parses, preserves content and is idempotent`, async () => {
    const result = await formatDocument(fixture(content, language));
    assert.ok(result.content.trim());
    assert.ok(result.formatter);
    assert.equal((await formatDocument(fixture(result.content, language))).content, result.content);
  });
}

test('invalid syntax fails without returning replacement content', async () => {
  await assert.rejects(formatDocument(fixture('const broken = {', 'javascript')));
  await assert.rejects(formatDocument(fixture('{"a": 1,}', 'json')));
  await assert.rejects(formatDocument(fixture('class Main { int a = ; }', 'java')));
});

test('CRLF and CR document line endings survive built-in formatting', async () => {
  const crlf = (await formatDocument(fixture('const x={\r\na:1\r\n}\r\n', 'javascript'))).content;
  assert.ok(crlf.endsWith('\r\n'));
  assert.equal(crlf.replaceAll('\r\n', '').includes('\n'), false);
  const cr = (await formatDocument(fixture('a{\rcolor:red\r}\r', 'css'))).content;
  assert.ok(cr.endsWith('\r'));
  assert.equal(cr.includes('\n'), false);
});

test('tab width changes actual indentation', async () => {
  const result = await formatDocument(fixture('function x(){return 1}', 'javascript', { tabSize: 4 }));
  assert.match(result.content, /\n {4}return 1;/);
});

test('unsafe input sizes and invalid indentation are rejected before formatting', async () => {
  await assert.rejects(formatDocument(fixture('x'.repeat(10 * 1024 * 1024 + 1), 'javascript')), /最大 10 MB/);
  await assert.rejects(formatDocument(fixture('const x=1', 'javascript', { tabSize: 0 })), /缩进宽度/);
});

test('unknown language explicitly needs a formatter instead of trimming text', async () => {
  await assert.rejects(formatDocument(fixture('  untouched   ', 'unknownlang')), /配置.*外部格式化器/);
});

test('custom formatter handles stdin and stdout and preserves CRLF', async () => {
  const script = 'process.stdin.setEncoding("utf8");let text="";process.stdin.on("data",x=>text+=x);process.stdin.on("end",()=>process.stdout.write(text.toUpperCase().replaceAll("\\r\\n","\\n")))';
  const result = await formatDocument(fixture('abc\r\ndef\r\n', 'customlang'), nodeFormatter(script));
  assert.equal(result.content, 'ABC\r\nDEF\r\n');
  assert.equal(result.formatter, basename(process.execPath));
});

test('custom formatter nonzero exit and empty output are rejected', async () => {
  await assert.rejects(formatDocument(fixture('original', 'customlang'), nodeFormatter('process.stdout.write("partial");process.stderr.write("parse error");process.exit(2)')), /退出码 2.*parse error/s);
  await assert.rejects(formatDocument(fixture('original', 'customlang'), nodeFormatter('process.stdin.resume()')), /未返回内容/);
});

test('external formatter deadline stops hanging processes', { timeout: FORMAT_TIMEOUT_MS + 5000 }, async () => {
  await assert.rejects(formatDocument(fixture('original', 'customlang'), nodeFormatter('process.stdin.resume();setInterval(()=>{},1000)')), /超时/);
});

test('external formatter output is capped and binary output is rejected', async () => {
  await assert.rejects(formatDocument(fixture('original', 'customlang'), nodeFormatter('process.stdout.write("x".repeat(21*1024*1024))')), /超过 20 MB/);
  await assert.rejects(formatDocument(fixture('original', 'customlang'), nodeFormatter('process.stdout.write(Buffer.from([255,254,0]))')), /二进制|UTF-8/);
});

test('command args and document contents are never interpreted by a shell', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'luma-formatter-test-'));
  try {
    const marker = join(temporary, 'shell-ran');
    const literal = `; touch ${marker}; $(touch ${marker})`;
    const script = 'process.stdin.setEncoding("utf8");let text="";process.stdin.on("data",x=>text+=x);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({arg:process.argv[1],text})))';
    const result = await formatDocument(fixture(literal, 'customlang'), nodeFormatter(script, [literal]));
    assert.deepEqual(JSON.parse(result.content), { arg: literal, text: literal });
    await assert.rejects(access(marker));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('{filepath} receives a disposable snapshot preserving filename; original stays untouched', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'luma-formatter-test-'));
  try {
    const original = join(temporary, 'My Document.xyz');
    await writeFile(original, 'SAVED ORIGINAL');
    const script = 'const fs=require("fs");const path=process.argv[1];const text=fs.readFileSync(path,"utf8");fs.writeFileSync(path,"formatter modified snapshot");process.stdin.resume();process.stdout.write(JSON.stringify({path,text}))';
    const { content } = await formatDocument(fixture('UNSAVED BUFFER', 'customlang', { filePath: original }), nodeFormatter(script, ['{filepath}']));
    const result = JSON.parse(content);
    assert.equal(result.text, 'UNSAVED BUFFER');
    assert.equal(basename(result.path), 'My Document.xyz');
    assert.notEqual(result.path, original);
    assert.equal(await readFile(original, 'utf8'), 'SAVED ORIGINAL');
    await assert.rejects(access(result.path));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('concurrent external formats use separate document snapshots', async () => {
  const script = 'const fs=require("fs");process.stdin.resume();setTimeout(()=>process.stdout.write(fs.readFileSync(process.argv[1],"utf8")),30)';
  const values = ['first', 'second', 'third'];
  const results = await Promise.all(values.map((content) => formatDocument(fixture(content, 'customlang', { filePath: '/not-used/same.xyz' }), nodeFormatter(script, ['{filepath}']))));
  assert.deepEqual(results.map((result) => result.content), values);
});

test('external formatter configuration is validated and copied', () => {
  const original = { python: { command: 'ruff', args: ['format', '-'] } };
  const valid = validateExternalFormatters(original);
  assert.deepEqual(valid, original);
  valid.python.args.push('extra');
  assert.equal(original.python.args.length, 2);
  for (const invalid of [null, [], { python: { command: 'ruff format', args: [] } }, { python: { command: './formatter', args: [] } }, { python: { command: 'ruff', args: [1] } }, { python: { command: 'ruff', args: [], shell: true } }, JSON.parse('{"__proto__":{"command":"node","args":[]}}')]) {
    assert.throws(() => validateExternalFormatters(invalid));
  }
});

test('status distinguishes bundled, custom and missing formatters', async () => {
  const statuses = await getFormatterStatus({ ...nodeFormatter(echoScript), javascript: { command: '/does/not/exist/luma-test', args: [] } });
  assert.equal(statuses.find((entry) => entry.language === 'java').kind, 'builtin');
  assert.equal(statuses.find((entry) => entry.language === 'customlang').kind, 'external');
  assert.equal(statuses.find((entry) => entry.language === 'customlang').available, true);
  assert.equal(statuses.find((entry) => entry.language === 'javascript').kind, 'missing');
  assert.equal(statuses.find((entry) => entry.language === 'kotlin').available, false);
  await assert.rejects(formatDocument(fixture('text', 'customlang'), { customlang: { command: '/does/not/exist/luma-test', args: [] } }), /未找到命令/);
});

test('bundled formatters do not execute project configuration', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'luma-formatter-test-'));
  try {
    const marker = join(temporary, 'config-ran');
    await writeFile(join(temporary, '.prettierrc.cjs'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); module.exports={tabWidth:8}`);
    const result = await formatDocument(fixture('function x(){return 1}', 'javascript', { filePath: join(temporary, 'test.js') }));
    assert.match(result.content, /\n {2}return 1;/);
    await assert.rejects(access(marker));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
