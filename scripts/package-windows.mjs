import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Arch, build, Platform } from 'electron-builder';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputs = process.env.LUMA_OUTPUT_DIR ? path.resolve(process.env.LUMA_OUTPUT_DIR) : path.join(root, 'release-win');
const staging = path.join(root, '.package-staging-win');
const packageJSON = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const runtimeNames = ['prettier', '@prettier/plugin-php', '@prettier/plugin-xml', 'prettier-plugin-java', 'prettier-plugin-toml', 'sql-formatter'];
const iconPath = path.join(root, '.windows-icon.ico');

await fs.access(path.join(root, 'dist', 'index.html'));
await fs.rm(staging, { recursive: true, force: true });
await fs.rm(outputs, { recursive: true, force: true });
await fs.mkdir(staging, { recursive: true });
await fs.mkdir(outputs, { recursive: true });
for (const directory of ['dist', 'electron']) await fs.cp(path.join(root, directory), path.join(staging, directory), { recursive: true });
await fs.writeFile(path.join(staging, 'package.json'), JSON.stringify({
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  type: 'module',
  main: packageJSON.main,
  dependencies: Object.fromEntries(runtimeNames.map(name => [name, packageJSON.dependencies[name]])),
}, null, 2));

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

await new Promise((resolve, reject) => {
  const worker = spawn(process.execPath, [path.join(root, 'scripts', 'create-windows-icon.mjs'), iconPath], { stdio: 'inherit' });
  worker.once('error', reject);
  worker.once('exit', code => code === 0 ? resolve() : reject(new Error(`无法生成 Windows 图标（退出码 ${code}）。`)));
});

const baseConfig = {
  appId: 'com.luma.editor',
  productName: 'Luma Editor',
  copyright: 'Copyright © 2026 Luma Editor contributors',
  directories: { app: staging, output: outputs, buildResources: root },
  files: ['**/*'],
  asar: true,
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  electronVersion: packageJSON.devDependencies.electron,
  win: {
    icon: iconPath,
    requestedExecutionLevel: 'asInvoker',
    signAndEditExecutable: false,
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Luma Editor',
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    installerLanguages: ['zh_CN', 'en_US'],
    artifactName: 'Luma-Editor-${version}-Setup-${arch}.${ext}',
  },
};

try {
  if (process.platform === 'win32') {
    await build({ projectDir: root, targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), config: baseConfig });
    await build({ projectDir: root, targets: Platform.WINDOWS.createTarget(['portable'], Arch.x64), config: { ...baseConfig, win: { ...baseConfig.win, target: [{ target: 'portable', arch: ['x64'] }] }, portable: { artifactName: 'Luma-Editor-${version}-Portable-${arch}.${ext}' } } });
    console.log(`Packaged Windows x64 installers in ${outputs}; included ${copied.size} runtime packages.`);
  } else {
    await build({ projectDir: root, targets: Platform.WINDOWS.createTarget(['dir'], Arch.x64), config: { ...baseConfig, win: { ...baseConfig.win, target: ['dir'] } } });
    console.warn('当前主机不是 Windows，已完成 Windows x64 运行目录构建；NSIS 和 portable 安装器由 GitHub Actions 的 Windows runner 生成。');
  }
} finally {
  await fs.rm(staging, { recursive: true, force: true });
  await fs.rm(iconPath, { force: true });
}
