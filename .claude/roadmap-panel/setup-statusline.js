#!/usr/bin/env node
'use strict';
// Activa la barra de estado en este proyecto escribiendo .claude/settings.local.json
// (personal, no se sube a git). No pisa una statusLine existente salvo con --force.
// Uso: node .claude/roadmap-panel/setup-statusline.js [--root <carpeta>] [--force]

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const ri = args.indexOf('--root');
const parentName = path.basename(path.dirname(__dirname));
const root = path.resolve(ri >= 0 && args[ri + 1] ? args[ri + 1] : parentName === '.claude' ? path.resolve(__dirname, '..', '..') : process.cwd());
const file = path.join(root, '.claude', 'settings.local.json');
const script = path.join(root, '.claude', 'roadmap-panel', 'statusline.js');

let cfg = {};
if (fs.existsSync(file)) {
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    console.error('No pude leer ' + file + ': no es un JSON válido. No lo toqué.');
    process.exit(1);
  }
}
if (cfg.statusLine && !args.includes('--force')) {
  console.log('Ya hay una statusLine en ' + file + '. No la cambié.');
  console.log('Para usar esta barra, llamá desde tu script a: node "' + script + '" (recibe el mismo JSON por stdin), o corré de nuevo con --force.');
  process.exit(0);
}
cfg.statusLine = { type: 'command', command: 'node "' + script + '"' };
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
console.log('Barra de estado activada en ' + file);
console.log('Abrí una sesión nueva de Claude Code y mandá un mensaje: los límites aparecen después de la primera respuesta.');
