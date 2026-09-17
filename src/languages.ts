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

/**
 * Guess a formatter language from a pasted snippet. This intentionally uses
 * conservative, high-signal syntax checks and falls back to the active tab's
 * language when a snippet is ambiguous.
 */
export function detectContentLanguage(content: string, fallback = 'plaintext'): string {
  const text = content.trim();
  if (!text) return fallback;

  try {
    if (/^[\[{]/.test(text)) {
      JSON.parse(text);
      return 'json';
    }
  } catch { /* Keep checking other languages for incomplete JSON snippets. */ }

  if (/^<\?php\b/i.test(text)) return 'php';
  if (/^<template\b/i.test(text)) return 'vue';
  if (/^<!doctype\s+html\b|^<[a-z][\s\S]*>/i.test(text)) return 'html';
  if (/^\s*(?:query|mutation|subscription|fragment)\s+\w+/i.test(text)) return 'graphql';
  if (/^\s*(?:select|with|insert|update|delete|create|alter)\b[\s\S]*\b(?:from|into|table|set)\b/i.test(text)) return 'sql';
  if (/^---\s*$|^[\w.-]+\s*:\s*[^:=]/m.test(text) && !/[{};]/.test(text)) return 'yaml';
  if (/^#!.*\b(?:sh|bash|zsh)\b|^\s*set\s+-e\b/m.test(text)) return 'shell';
  if (/^\s*#include\s*[<"]|\bstd::|\btemplate\s*</.test(text)) return 'cpp';
  if (/\b(?:interface|type)\s+\w+|\b(?:as\s+const|implements)\b|:\s*(?:string|number|boolean)\b/.test(text)) return 'typescript';
  if (/^\s*(?:package\s+\w+|func\s+\w+\s*\()/m.test(text)) return 'go';
  if (/\b(?:fn|impl|trait|use)\s+\w+/.test(text)) return 'rust';
  if (/\b(?:public\s+class|System\.out|@Override)\b/.test(text)) return 'java';
  if (/\b(?:namespace|using\s+System;|Console\.WriteLine)\b/.test(text)) return 'csharp';
  if (/\bimport\s+(?:Foundation|UIKit)\b|^\s*func\s+\w+\s*\(/m.test(text)) return 'swift';
  if (/\b(?:fun|data\s+class|sealed\s+class)\s+\w+|:\s*(?:String|Int|Boolean)\b/.test(text)) return 'kotlin';
  if (/^\s*FROM\s+\S+\s*$|\b(?:RUN|COPY|CMD|ENTRYPOINT)\s+/m.test(text)) return 'dockerfile';
  if (/^\s*(?:param\(|Write-Host|Get-ChildItem)\b|^#!.*powershell/im.test(text)) return 'powershell';
  if (/\b(?:const|let|var|function|import|export)\b|=>/.test(text)) return 'javascript';
  if (/^\s*(?:def|class)\s+\w+.*:|^\s*from\s+\w+\s+import\b/m.test(text)) return 'python';
  if (/^\s*(?:module|class|def)\s+\w+|\brequire\s+['"]/m.test(text)) return 'ruby';
  if (/^\s*local\s+\w+\s*=|^\s*function\s+\w+\s*\(/m.test(text)) return 'lua';
  if (/^\s*(?:library\s*\(|[\w.]+\s*<-|function\s*\()/m.test(text)) return 'r';
  if (/[.#]?[a-z][\w-]*\s*\{[^}]*:[^}]+;/.test(text)) return 'css';
  if (/^#{1,6}\s+|^```|^\s*[-*+]\s+\S+/m.test(text)) return 'markdown';
  return fallback;
}
