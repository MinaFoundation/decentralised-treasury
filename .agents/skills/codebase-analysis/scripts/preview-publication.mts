import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'));
const publicationArg = process.argv[2];
const port = Number(process.argv[3] ?? '3000');
if (!publicationArg || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('usage: preview-publication.mts PUBLICATION_DIRECTORY [PORT]');
}

const publication = realpathSync(resolve(publicationArg));
if (!(publication === repository || publication.startsWith(`${repository}${sep}`)) || !statSync(publication).isDirectory()) {
  throw new Error('publication directory must be an existing repository directory');
}
if (!existsSync(resolve(publication, 'index.md'))) throw new Error('publication/index.md is missing');

const pnpm = resolve(repository, 'node_modules/.pnpm');
const packageDirectory = (prefix: string) => {
  const matches = readdirSync(pnpm).filter((name) => name.startsWith(`${prefix}@`)).sort();
  if (matches.length !== 1) throw new Error(`expected one installed ${prefix} package, found ${matches.length}`);
  return resolve(pnpm, matches[0], 'node_modules', prefix, 'index.js');
};
const { micromark } = await import(pathToFileURL(packageDirectory('micromark')).href);
const { gfm, gfmHtml } = await import(pathToFileURL(packageDirectory('micromark-extension-gfm')).href);

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const pages: string[] = [];
const collect = (directory: string) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile() && entry.name.endsWith('.md')) pages.push(relative(publication, path).replaceAll('\\', '/'));
  }
};
collect(publication);
pages.sort((left, right) => left.localeCompare(right));

const navigation = pages.map((page) => `<li><a href="/${encodeURI(page)}">${escapeHtml(page.replace(/\.md$/, ''))}</a></li>`).join('');
const server = createServer((request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    let requested = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!requested) requested = 'index.md';
    if (!requested.endsWith('.md')) requested += '.md';
    if (requested.split('/').includes('..')) throw new Error('unsafe path');
    const lexical = resolve(publication, requested);
    if (!(lexical === publication || lexical.startsWith(`${publication}${sep}`))) throw new Error('unsafe path');
    const path = realpathSync(lexical);
    if (!path.startsWith(`${publication}${sep}`) || !statSync(path).isFile() || !path.endsWith('.md')) throw new Error('not a Markdown page');

    const markdown = readFileSync(path, 'utf8');
    const rendered = micromark(markdown, { allowDangerousHtml: true, extensions: [gfm()], htmlExtensions: [gfmHtml()] });
    const nonce = randomBytes(18).toString('base64');
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(requested.replace(/\.md$/, ''))} — Codebase Analysis</title>
<style nonce="${nonce}">:root{color-scheme:light dark;font:16px/1.55 system-ui,sans-serif}body{margin:0;display:grid;grid-template-columns:minmax(16rem,22rem) minmax(0,1fr);min-height:100vh}nav{padding:1rem;overflow:auto;border-right:1px solid #8885}nav ul{list-style:none;padding:0}nav li{margin:.25rem 0}main{max-width:1100px;padding:2rem 3rem;overflow:auto}table{border-collapse:collapse;display:block;overflow:auto}th,td{border:1px solid #8886;padding:.4rem .6rem;vertical-align:top}code,pre{font-family:ui-monospace,monospace}pre{overflow:auto;padding:1rem;background:#8882}a{color:#3976d3}blockquote{border-left:.25rem solid #8886;margin-left:0;padding-left:1rem}@media(max-width:800px){body{display:block}nav{border-right:0;border-bottom:1px solid #8885}main{padding:1rem}}</style>
</head><body><nav><strong>Codebase analysis</strong><ul>${navigation}</ul></nav><main>${rendered}</main>
<script nonce="${nonce}" type="module">const blocks=[...document.querySelectorAll('pre > code.language-mermaid')];if(blocks.length){try{const {default:mermaid}=await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');for(const code of blocks){const view=document.createElement('pre');view.className='mermaid';view.textContent=code.textContent;code.parentElement.replaceWith(view)}mermaid.initialize({startOnLoad:false,securityLevel:'strict'});await mermaid.run({querySelector:'.mermaid'})}catch(error){console.warn('Mermaid renderer unavailable; diagrams remain as source.',error)}}</script>
</body></html>`;
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
      'x-content-type-options': 'nosniff',
    });
    response.end(html);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
    response.end('Markdown page not found.');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Static analysis publication: http://127.0.0.1:${port}`);
  console.log(`Serving read-only Markdown from ${publication}`);
});
