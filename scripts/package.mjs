import { packager } from '@electron/packager';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputs = process.env.LUMA_OUTPUT_DIR ? path.resolve(process.env.LUMA_OUTPUT_DIR) : path.join(root, 'release');
const staging = path.join(root, '.package-staging');
const intermediate = path.join(root, '.package-build');
const packageJSON = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const runtimeNames = ['prettier', '@prettier/plugin-php', '@prettier/plugin-xml', 'prettier-plugin-java', 'prettier-plugin-toml', 'sql-formatter'];
await fs.access(path.join(root, 'dist', 'index.html'));
await fs.rm(staging, { recursive: true, force: true });
await fs.mkdir(staging, { recursive: true });
await fs.mkdir(outputs, { recursive: true });
for (const directory of ['dist', 'electron']) await fs.cp(path.join(root, directory), path.join(staging, directory), { recursive: true });
await fs.writeFile(path.join(staging, 'package.json'), JSON.stringify({ name: packageJSON.name, version: packageJSON.version, description: packageJSON.description, type: 'module', main: packageJSON.main, dependencies: Object.fromEntries(runtimeNames.map(name => [name, packageJSON.dependencies[name]])) }, null, 2));

const copied = new Set();
async function locate(name, fromDirectory) {
  let directory = fromDirectory;
  for (;;) {
    const candidate = path.join(directory, 'node_modules', name);
    try { await fs.access(path.join(candidate, 'package.json')); return candidate; }
    catch {}
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Runtime package missing: ${name}`);
    directory = parent;
  }
}
async function includePackage(name, fromDirectory, optional = false) {
  let source;
  try { source = await locate(name, fromDirectory); }
  catch (error) { if (optional) return; throw error; }
  if (copied.has(source)) return;
  copied.add(source);
  const relative = path.relative(root, source);
  if (relative.startsWith('..')) throw new Error(`Runtime package is outside project: ${name}`);
  const destination = path.join(staging, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true, filter: filename => path.basename(filename) !== 'node_modules' && path.basename(filename) !== '.git' });
  const metadata = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(metadata.dependencies ?? {})) await includePackage(dependency, source, Boolean(metadata.optionalDependencies?.[dependency]));
  for (const dependency of Object.keys(metadata.optionalDependencies ?? {})) await includePackage(dependency, source, true);
}
for (const name of runtimeNames) await includePackage(name, root);
const iconPath = path.join(root, 'public', 'icon.icns');
let icon;
try { await fs.access(iconPath); icon = iconPath; } catch {}
const bundled = await packager({ dir: staging, out: intermediate, name: 'Luma Editor', executableName: 'Luma Editor', appBundleId: 'com.luma.editor', appVersion: packageJSON.version, buildVersion: packageJSON.version, electronVersion: packageJSON.devDependencies.electron, platform: 'darwin', arch: process.arch, icon, asar: true, prune: false, overwrite: true, appCategoryType: 'public.app-category.developer-tools', darwinDarkModeSupport: true,
  extendInfo: {
    CFBundleDisplayName: 'Luma Editor',
    CFBundleDocumentTypes: [{ CFBundleTypeName: 'Text and Source Documents', CFBundleTypeRole: 'Editor', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.text', 'public.source-code', 'public.json', 'public.xml'], CFBundleTypeExtensions: ['txt', 'md', 'markdown', 'js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'scss', 'xml', 'yaml', 'yml', 'toml', 'java', 'py', 'go', 'rs', 'rb', 'php', 'sql', 'c', 'h', 'cpp', 'swift', 'kt', 'sh', 'vue', 'svelte'] }],
    NSHighResolutionCapable: true,
  },
});
const destination = path.join(outputs, 'Luma Editor.app');
const appPath = path.join(bundled[0], 'Luma Editor.app');
const previous = path.join(outputs, '.Luma Editor.previous.app');
await fs.rm(previous, { recursive: true, force: true });
try { await fs.rename(destination, previous); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { await fs.rename(appPath, destination); }
catch (error) {
  await fs.rename(previous, destination).catch(() => {});
  throw error;
}
await fs.rm(previous, { recursive: true, force: true });
await fs.rm(staging, { recursive: true, force: true });
await fs.rm(intermediate, { recursive: true, force: true });
console.log(`Packaged ${destination} (${process.arch}); included ${copied.size} runtime packages.`);
