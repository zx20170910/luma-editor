import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
const sections = ['Luma Editor — Third-party notices\n\nElectron and Chromium licenses are also included in the application bundle.\n'];
const seen = new Set();
async function collect(name, from = root) {
  let cursor = from, folder;
  for (;;) {
    const candidate = path.join(cursor, 'node_modules', name);
    try { await fs.access(path.join(candidate, 'package.json')); folder = candidate; break; } catch {}
    const parent = path.dirname(cursor); if (parent === cursor) return; cursor = parent;
  }
  if (seen.has(folder)) return; seen.add(folder);
  const pkg = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
  const names = (await fs.readdir(folder)).filter(n => /^(licen[sc]e|copying|notice)(\.|$)/i.test(n));
  let text = `\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)}\n${pkg.homepage || ''}\n`;
  for (const name of names) { try { text += `\n${name}\n${await fs.readFile(path.join(folder,name),'utf8')}\n`; } catch {} }
  sections.push(text);
  for (const dependency of Object.keys(pkg.dependencies || {})) await collect(dependency, folder);
}
for (const name of Object.keys(manifest.dependencies)) await collect(name);
await fs.writeFile('public/THIRD_PARTY_NOTICES.txt', sections.join('\n'));
console.log(`Wrote notices for ${seen.size} runtime libraries.`);
