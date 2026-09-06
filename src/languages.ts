import * as monaco from 'monaco-editor';
const extra = [
  { id: 'vue', extensions: ['.vue'], aliases: ['Vue'] },
  { id: 'toml', extensions: ['.toml'], aliases: ['TOML'] },
  { id: 'javascriptreact', extensions: ['.jsx'], aliases: ['JavaScript React'] },
  { id: 'typescriptreact', extensions: ['.tsx'], aliases: ['TypeScript React'] },
];
for (const lang of extra) if (!monaco.languages.getLanguages().some(l => l.id === lang.id)) monaco.languages.register(lang);
export function detectLanguage(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.vue')) return 'html';
  if (/\.(jsonc|json5)$/.test(lower)) return 'json';
  for (const l of monaco.languages.getLanguages()) {
    if (l.filenames?.some(n => n.toLowerCase() === lower) || l.extensions?.some(e => lower.endsWith(e.toLowerCase()))) return l.id;
  }
  return 'plaintext';
}
export const languageList = () => monaco.languages.getLanguages().map(l => ({ id: l.id, label: l.aliases?.[0] || l.id })).sort((a,b) => a.label.localeCompare(b.label));
export const languageLabel = (id: string) => languageList().find(l => l.id === id)?.label || id;
export function formatLanguage(language: string, name: string) {
  if (language === 'json' && /\.json[5c]$/i.test(name)) return 'jsonc';
  if (language === 'html' && /\.vue$/i.test(name)) return 'vue';
  return language;
}
