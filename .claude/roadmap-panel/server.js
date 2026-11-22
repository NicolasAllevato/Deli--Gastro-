#!/usr/bin/env node
'use strict';
// Panel local del roadmap. Lee y escribe ROADMAP.md del proyecto.
// Uso: node .claude/roadmap-panel/server.js [--port 4317] [--root <carpeta>] [--file ROADMAP.md]

const http = require('http');
const fs = require('fs');
const path = require('path');
const R = require('./roadmap');
const U = require('./usage');

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const parentName = path.basename(path.dirname(__dirname));
const defaultRoot = parentName === '.claude' ? path.resolve(__dirname, '..', '..') : process.cwd();
const ROOT = path.resolve(arg('root', defaultRoot));
const FILE = path.resolve(ROOT, arg('file', 'ROADMAP.md'));
const START_PORT = parseInt(arg('port', '4317'), 10);

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function detectStack() {
  const out = [];
  const pkg = readJSON(path.join(ROOT, 'package.json'));
  if (pkg) {
    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
    const map = { next: 'Next.js', react: 'React', vue: 'Vue', svelte: 'Svelte', express: 'Express',
      '@supabase/supabase-js': 'Supabase', tailwindcss: 'Tailwind', typescript: 'TypeScript',
      '@anthropic-ai/claude-agent-sdk': 'Claude Agent SDK', prisma: 'Prisma' };
    Object.keys(map).forEach((k) => { if (deps[k]) out.push(map[k]); });
    if (!out.length) out.push('Node');
  }
  const files = { 'pyproject.toml': 'Python', 'requirements.txt': 'Python', 'go.mod': 'Go',
    'Cargo.toml': 'Rust', 'composer.json': 'PHP', 'Gemfile': 'Ruby', 'wrangler.toml': 'Cloudflare' };
  Object.keys(files).forEach((f) => {
    if (fs.existsSync(path.join(ROOT, f)) && !out.includes(files[f])) out.push(files[f]);
  });
  return out;
}

function readmeSummary() {
  for (const f of ['README.md', 'readme.md']) {
    try {
      const t = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
      const p = t.find((l) => l.trim() && !/^[#>!\[<`-]/.test(l.trim()));
      if (p) return p.trim().slice(0, 200);
    } catch (e) { /* sin README */ }
  }
  return '';
}

function gitBranch() {
  try {
    const h = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim();
    const m = h.match(/^ref: refs\/heads\/(.+)$/);
    return m ? m[1] : h.slice(0, 7);
  } catch (e) { return ''; }
}

function detectAgents() {
  const dir = path.join(ROOT, '.claude', 'agents');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch (e) { return []; }
  return files.map((f) => {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    const fm = (t.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
    const get = (k) => ((fm.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [])[1] || '').trim();
    return { name: get('name') || f.replace(/\.md$/, ''), model: get('model') || 'heredado' };
  });
}

function projectName(st) {
  if (st && st.meta.proyecto) return st.meta.proyecto;
  const pkg = readJSON(path.join(ROOT, 'package.json'));
  if (pkg && pkg.name) return pkg.name;
  return path.basename(ROOT);
}

function info(st) {
  const pkg = readJSON(path.join(ROOT, 'package.json'));
  return {
    proyecto: projectName(st),
    descripcion: (pkg && pkg.description) || readmeSummary(),
    stack: detectStack(),
    rama: gitBranch(),
    archivo: path.relative(ROOT, FILE) || path.basename(FILE),
  };
}

function template() {
  const name = projectName(null);
  const agents = detectAgents();
  const L = ['---', 'proyecto: ' + name, 'actualizado: ' + R.today(), '---', '# Roadmap', '', '## Agentes'];
  agents.forEach((a) => L.push('- ' + a.name + ' · ' + a.model + ' · libre'));
  L.push('', '## Preguntas',
    '- [?] ¿Cuál es el objetivo del próximo hito de ' + name + '?',
    '  - Opciones:',
    '  - Sugerencia: Pedile a Claude "/roadmap init" para que lea el proyecto y proponga hitos reales.',
    '  - R:',
    '', '## H1 · Primer hito [pendiente]', '- [ ] Definir alcance',
    '', '## Notas', '- ' + R.today() + ' · Roadmap creado desde el panel');
  return L.join('\n') + '\n';
}

function payload(since) {
  const exists = fs.existsSync(FILE);
  if (!exists) return { exists: false, info: info(null), mtime: 0 };
  const mtime = fs.statSync(FILE).mtimeMs;
  if (since && Number(since) === mtime) return { unchanged: true, mtime };
  const st = R.parse(fs.readFileSync(FILE, 'utf8'));
  return Object.assign({ exists: true, info: info(st), mtime }, R.view(st));
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 100000) { reject(new Error('Cuerpo muy grande')); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(new Error('JSON inválido')); } });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return send(res, 403, { error: 'Host no permitido' });
    if (req.method === 'POST' && req.headers.origin) {
      let oh = '';
      try { oh = new URL(req.headers.origin).host; } catch (e) { /* inválido */ }
      if (oh !== host) return send(res, 403, { error: 'Origen no permitido' });
    }
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return send(res, 200, payload(url.searchParams.get('since')));
    }
    if (req.method === 'GET' && url.pathname === '/api/usage') {
      return send(res, 200, U.summary(U.load()));
    }
    if (req.method === 'POST' && url.pathname === '/api/usage-config') {
      const body = await readBody(req);
      U.setBudget(body.mensual_usd);
      return send(res, 200, U.summary(U.load()));
    }
    if (req.method === 'POST' && url.pathname === '/api/init') {
      if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, template());
      return send(res, 200, payload());
    }
    if (req.method === 'POST' && url.pathname === '/api/op') {
      if (!fs.existsSync(FILE)) return send(res, 404, { error: 'No existe ROADMAP.md' });
      const op = await readBody(req);
      const next = R.mutateText(fs.readFileSync(FILE, 'utf8'), op);
      fs.writeFileSync(FILE, next);
      return send(res, 200, payload());
    }
    send(res, 404, { error: 'No encontrado' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

function listen(port, tries) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries > 0) listen(port + 1, tries - 1);
    else { console.error('No pude abrir el panel:', e.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('Panel de ' + projectName(null) + ': http://localhost:' + port);
    console.log('Archivo: ' + FILE);
  });
}
listen(START_PORT, 10);
