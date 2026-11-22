#!/usr/bin/env node
'use strict';
// Barra de estado de Claude Code, dentro de un recuadro:
// avance del roadmap + límites de 5 horas, semanal y mensual.
// Claude Code le manda un JSON por stdin en cada actualización.

const fs = require('fs');
const path = require('path');
const U = require('./usage');
const R = require('./roadmap');

const C = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };
const col = (p) => (p >= 80 ? C.r : p >= 50 ? C.y : C.g);
const bar = (p, w) => { const f = Math.round((p / 100) * w); return '█'.repeat(f) + '░'.repeat(w - f); };
const vis = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
const W = 10;

// Una fila: etiqueta fija, barra, valor y nota.
function row(label, p, value, note, color) {
  const c = color || col(p);
  return label.padEnd(9) + c + bar(p, W) + C.x + ' ' + c + value.padStart(4) + C.x + (note ? C.d + '  ' + note + C.x : '');
}
function plain(label, text) { return label.padEnd(9) + C.d + text + C.x; }

function limitRow(label, v) {
  if (!v) return plain(label, 'sin datos');
  if (v.reset) return plain(label, 'ventana reiniciada');
  return row(label, v.pct, v.pct + '%', v.left != null ? 'reinicia en ' + U.fmtLeft(v.left) : '');
}

function box(title, rows) {
  const inner = Math.max(vis(title) + 2, ...rows.map(vis)) + 2;
  const out = [C.d + '╭─ ' + C.x + C.b + title + C.x + C.d + ' ' + '─'.repeat(inner - vis(title) - 3) + '╮' + C.x];
  rows.forEach((r) => out.push(C.d + '│ ' + C.x + r + ' '.repeat(inner - vis(r) - 1) + C.d + '│' + C.x));
  out.push(C.d + '╰' + '─'.repeat(inner) + '╯' + C.x);
  return out.join('\n');
}

let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch (e) { /* sin datos */ }
  try { U.record(input); } catch (e) { /* no frenar la barra */ }

  const rows = [];
  const model = input.model && (input.model.display_name || input.model.id);
  if (model) rows.push('Modelo'.padEnd(9) + C.b + model + C.x);
  let title = 'Claude Code';
  try {
    const root = (input.workspace && (input.workspace.project_dir || input.workspace.current_dir)) || input.cwd || process.cwd();
    title = path.basename(root);
    const f = path.join(root, 'ROADMAP.md');
    if (fs.existsSync(f)) {
      const st = R.parse(fs.readFileSync(f, 'utf8'));
      const v = R.view(st);
      if (st.meta.proyecto) title = st.meta.proyecto;
      let note = v.stats.done + ' de ' + v.stats.total + ' tareas';
      if (v.stats.urgent) note += C.x + C.r + ' · ' + v.stats.urgent + ' decisi' + (v.stats.urgent > 1 ? 'ones urgentes' : 'ón urgente');
      else if (v.stats.open) note += ' · ' + v.stats.open + ' pregunta' + (v.stats.open > 1 ? 's' : '');
      rows.push(row('Roadmap', v.stats.pct, v.stats.pct + '%', note, C.g));
    }
  } catch (e) { /* sin roadmap */ }

  const s = U.summary(U.load());
  rows.push(limitRow('5 horas', s.five_hour));
  rows.push(limitRow('Semanal', s.seven_day));
  if (s.month.budget) rows.push(row('Mensual', s.month.pct, s.month.pct + '%', '$' + s.month.spent + ' de $' + s.month.budget));
  else rows.push(plain('Mensual', '~$' + s.month.spent + ' estimado · sin tope'));

  process.stdout.write(box(title, rows) + '\n');
});
