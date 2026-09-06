import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { EditorAPI } from '../shared/contracts';

export async function markdownHTML(source: string, path: string | null, api: EditorAPI, light: boolean): Promise<string> {
  const html = await marked.parse(source, { gfm: true, breaks: false });
  const wrapper = document.createElement('div');
  wrapper.innerHTML = DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed'], FORBID_ATTR: ['style', 'srcset'] });
  wrapper.querySelectorAll('input').forEach(input => {
    if (input.type === 'checkbox') { const mark = document.createElement('span'); mark.textContent = input.checked ? '☑ ' : '☐ '; input.replaceWith(mark); }
    else input.remove();
  });
  await Promise.all([...wrapper.querySelectorAll('img')].map(async img => {
    const src = img.getAttribute('src') || '';
    if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)) return;
    let data: string | null = null;
    if (path && src && !/^[a-z]+:|^\/\/|^#/i.test(src)) {
      try { data = await api.readAsset(src, path); } catch { /* Show alt text when unavailable. */ }
    }
    if (data) img.src = data;
    else { const placeholder = document.createElement('span'); placeholder.className = 'image-placeholder'; placeholder.textContent = `▧ ${img.alt || '图片'}（${/^https?:/i.test(src) ? '远程图片未加载' : '图片不可用'}）`; img.replaceWith(placeholder); }
  }));
  wrapper.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => { h.id = (h.textContent || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, ''); });
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; form-action 'none'"><style>
  :root{color-scheme:${light ? 'light' : 'dark'};--text:${light ? '#354152' : '#c2c9d5'};--heading:${light ? '#152233' : '#ecf0f6'};--muted:${light ? '#718094' : '#748193'};--line:${light ? '#dde3eb' : '#2d333e'};--code:${light ? '#edf1f6' : '#202630'};--accent:${light ? '#16856b' : '#8ad9bd'};background:${light ? '#fafbfd' : '#1b2028'}}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;padding:36px 38px 80px;font:14px/1.9 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;color:var(--text);overflow-wrap:anywhere}h1,h2,h3,h4,h5,h6{color:var(--heading);font-weight:600;line-height:1.45;scroll-margin-top:20px}h1{font-size:30px;letter-spacing:-.8px;margin:4px 0 24px;padding-bottom:18px;border-bottom:1px solid var(--line)}h2{font-size:20px;margin:30px 0 14px}h3{font-size:16px;margin:25px 0 10px}p{margin:13px 0}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}code{font:12px/1.8 'SFMono-Regular',Menlo,monospace;background:var(--code);padding:3px 6px;border-radius:4px;color:var(--accent)}pre{padding:18px 20px;background:var(--code);border:1px solid var(--line);border-radius:8px;overflow:auto;line-height:1.7}pre code{padding:0;background:none;white-space:pre;overflow-wrap:normal}blockquote{margin:22px 0;border-left:3px solid var(--accent);padding:4px 18px;background:var(--code);color:var(--muted);border-radius:0 6px 6px 0}blockquote p{margin:7px 0}ul,ol{padding-left:23px}li{padding:3px 0}li::marker{color:var(--muted)}table{border-collapse:collapse;width:100%;margin:20px 0;font-size:13px}th,td{text-align:left;border:1px solid var(--line);padding:9px 13px}th{background:var(--code);color:var(--heading);font-weight:500}hr{border:0;border-top:1px solid var(--line);margin:30px 0}img{max-width:100%;height:auto;border-radius:6px}.image-placeholder{display:block;padding:18px;border:1px dashed var(--line);color:var(--muted);border-radius:6px}input{accent-color:var(--accent)}::-webkit-scrollbar{width:7px;height:7px}::-webkit-scrollbar-thumb{background:var(--line);border-radius:5px}::selection{background:#449f8840}
  </style></head><body><article>${wrapper.innerHTML}</article></body></html>`;
}
