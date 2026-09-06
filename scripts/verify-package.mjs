import { _electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
const output = process.env.LUMA_OUTPUT_DIR ? path.resolve(process.env.LUMA_OUTPUT_DIR) : path.join(root, 'release');
const app = await _electron.launch({ executablePath: path.join(output, 'Luma Editor.app/Contents/MacOS/Luma Editor') });
const results = [];
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.locator('.tab.selected').waitFor();
  await page.frameLocator('#preview-frame').locator('h1').waitFor();
  const samples = [
    ['javascript','const x={a:1,b:[2,3]}'],['typescript','const x:number=1'],['json','{"a":1}'],
    ['java','class Main{public static void main(String[] a){System.out.println("Hi");}}'],
    ['php','<?php $x=[1,2]; echo $x[0];'],['xml','<root><item x="1"/><item x="2"/></root>'],
    ['toml','name="luma"\nitems=[1,2,3]\n'],['sql','select id,name from users where active=1'],
    ['c','int main(){return 0;}'],['cpp','int main(){return 0;}'],['csharp','class C{void F(){int i=1;}}'],['swift','let x=[1,2,3]'],
  ];
  for(const [language,content] of samples){
    const result=await page.evaluate(async ({language,content})=>window.luma.format({language,content,tabSize:2}),{language,content});
    assert.ok(result.content.trim()); results.push({language,formatter:result.formatter,result:result.content});
  }
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(output,'编辑器预览.png')});
  await fs.writeFile(path.resolve(root,'../../work/package-verification.json'),JSON.stringify({packaged:true,checks:results,pageErrors:errors},null,2));
  console.log(`Packaged application: ${results.length} formatter checks passed; page errors: ${errors.length}.`);
} finally { await app.close(); }
