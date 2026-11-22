#!/usr/bin/env node
'use strict';
// Guarda de seguridad: decide si un objetivo se puede cargar con k6.
// Salida: 0 permitido, 1 bloqueado, 2 dudoso (pedir confirmación y repetir con --confirmed).
const args = process.argv.slice(2);
const confirmed = args.includes('--confirmed');
const raw = args.find((a) => !a.startsWith('--'));
if (!raw) { console.error('Uso: check-target.js <URL> [--confirmed]'); process.exit(1); }

let host;
try { host = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'http://' + raw).hostname.toLowerCase(); }
catch (e) { console.error('URL inválida'); process.exit(1); }
host = host.replace(/^\[|\]$/g, '');

const BLOCK = [/(^|\.)whatsapp\.(com|net)$/, /(^|\.)facebook\.(com|net)$/, /(^|\.)fbcdn\.net$/, /(^|\.)meta\.com$/,
  /(^|\.)instagram\.com$/, /(^|\.)chatwoot\.com$/, /(^|\.)openai\.com$/, /(^|\.)anthropic\.com$/,
  /(^|\.)twilio\.com$/, /(^|\.)stripe\.com$/, /(^|\.)google(apis)?\.com$/, /(^|\.)resend\.com$/];
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const PRIVATE_IP = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];
const PRIVATE_NAME = [/^localhost$/, /^::1$/, /\.local$/, /^host\.docker\.internal$/];
const isPrivate = (h) => (IPV4.test(h) ? PRIVATE_IP.some((r) => r.test(h)) : PRIVATE_NAME.some((r) => r.test(h)));
const STAGING = /(^|[.-])(staging|stg|stage|dev|test|qa|preview)([.-]|$)/;

if (BLOCK.some((r) => r.test(host))) {
  console.log('BLOQUEADO: ' + host + ' es un servicio de terceros. No se hace prueba de carga contra él.');
  process.exit(1);
}
if (isPrivate(host)) { console.log('OK: ' + host + ' es local o de red privada.'); process.exit(0); }
if (STAGING.test(host)) { console.log('OK: ' + host + ' parece un entorno de pruebas. Confirmá igual que es del usuario.'); process.exit(0); }
if (confirmed) { console.log('OK con confirmación del usuario: ' + host + '. Solo prueba de humo en producción.'); process.exit(0); }
console.log('DUDOSO: ' + host + ' no parece local ni de pruebas. Preguntale al usuario si es suyo y se puede cargar; si dice que sí, repetí con --confirmed.');
process.exit(2);
