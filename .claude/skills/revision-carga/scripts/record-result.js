#!/usr/bin/env node
'use strict';
// Deja el resultado de una prueba en ROADMAP.md.
// Estructurado (aparece como tarjeta en el panel, sección "Revisiones"):
//   node record-result.js --tipo load --entorno staging --p95 "640 ms" --errores "0,2 %" --usuarios 50 --resultado OK [--task "tarea"]
// Texto libre (queda como nota):
//   node record-result.js "texto" [--task "tarea"]
// Opcional: --root <carpeta del proyecto>
const fs = require('fs');
const path = require('path');
const R = require('../../../roadmap-panel/roadmap.js');

const flags = {}, pos = [];
const a = process.argv.slice(2);
for (let i = 0; i < a.length; i++) {
  if (a[i].startsWith('--')) { flags[a[i].slice(2)] = a[i + 1] !== undefined && !a[i + 1].startsWith('--') ? a[++i] : ''; }
  else pos.push(a[i]);
}
const root = path.resolve(flags.root || path.resolve(__dirname, '..', '..', '..', '..'));
const file = path.join(root, 'ROADMAP.md');
if (!fs.existsSync(file)) { console.error('No hay ROADMAP.md en ' + root + '. Corré /roadmap init primero.'); process.exit(1); }

let t = fs.readFileSync(file, 'utf8');
if (flags.tipo) {
  t = R.mutateText(t, { op: 'addReview', type: flags.tipo, env: flags.entorno, p95: flags.p95, err: flags.errores, users: flags.usuarios, result: flags.resultado });
} else if (pos[0]) {
  t = R.mutateText(t, { op: 'addNote', text: 'Revisión de carga · ' + pos[0] });
} else { console.error('Falta --tipo (resultado estructurado) o un texto.'); process.exit(1); }

if (flags.task) {
  if (!R.parse(t).milestones.length) console.error('El ROADMAP.md no tiene hitos para agregar la tarea; dejé solo el resultado.');
  else t = R.mutateText(t, { op: 'addTask', g: 0, text: flags.task });
}
fs.writeFileSync(file, t);
console.log('Resultado guardado en ' + file);
