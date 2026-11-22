'use strict';
// Límites de uso: ventana de 5 horas y semanal (datos reales de Claude Code)
// y gasto estimado del mes (acumulado localmente). Archivo global compartido por todos los proyectos.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = process.env.ROADMAP_USAGE_FILE || path.join(os.homedir(), '.claude', 'roadmap-usage.json');
const DAY = 86400000;

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; }
}

function save(d) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d));
  fs.renameSync(tmp, FILE);
}

function monthKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function pct(x) {
  const n = Number(x);
  return isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

// Acepta segundos, milisegundos o fecha ISO.
function epoch(x) {
  if (x == null) return null;
  if (typeof x === 'number') return x > 1e12 ? x : x * 1000;
  const t = Date.parse(x);
  return isNaN(t) ? null : t;
}

// Guarda lo que Claude Code manda al script de la barra de estado.
function record(input, now) {
  now = now || Date.now();
  const d = load();
  d.config = d.config || {};

  const rl = input && input.rate_limits;
  if (rl) {
    d.limits = d.limits || {};
    ['five_hour', 'seven_day'].forEach((k) => {
      if (rl[k] && pct(rl[k].used_percentage) != null) {
        d.limits[k] = { pct: pct(rl[k].used_percentage), resets: epoch(rl[k].resets_at) };
      }
    });
    d.limits.updated = now;
  }

  const cost = input && input.cost ? Number(input.cost.total_cost_usd) : NaN;
  const sid = input && input.session_id;
  if (sid && isFinite(cost)) {
    const key = monthKey(now);
    if (!d.month || d.month.key !== key) d.month = { key, spent_usd: 0 };
    d.sessions = d.sessions || {};
    const prev = d.sessions[sid] ? d.sessions[sid].cost : 0;
    d.month.spent_usd = Math.round((d.month.spent_usd + Math.max(0, cost - prev)) * 10000) / 10000;
    d.sessions[sid] = { cost, seen: now };
    Object.keys(d.sessions).forEach((k) => { if (now - d.sessions[k].seen > 45 * DAY) delete d.sessions[k]; });
  }
  save(d);
  return d;
}

function setBudget(usd) {
  const d = load();
  d.config = d.config || {};
  const n = Number(usd);
  if (usd === null || usd === '' || !isFinite(n) || n <= 0) delete d.config.mensual_usd;
  else d.config.mensual_usd = n;
  save(d);
  return d;
}

function windowView(w, now) {
  if (!w) return null;
  if (w.resets && w.resets <= now) return { pct: 0, resets: null, left: 0, reset: true };
  return { pct: Math.round(w.pct), resets: w.resets, left: w.resets ? w.resets - now : null, reset: false };
}

function summary(d, now) {
  now = now || Date.now();
  d = d || load();
  const lim = d.limits || {};
  const key = monthKey(now);
  const spent = d.month && d.month.key === key ? d.month.spent_usd : 0;
  const budget = d.config && d.config.mensual_usd ? d.config.mensual_usd : null;
  return {
    five_hour: windowView(lim.five_hour, now),
    seven_day: windowView(lim.seven_day, now),
    month: {
      key, spent: Math.round(spent * 100) / 100, budget,
      pct: budget ? Math.min(100, Math.round((spent / budget) * 100)) : null,
      tracked: !!d.month,
    },
    updated: lim.updated || null,
    ageMs: lim.updated ? now - lim.updated : null,
  };
}

function fmtLeft(ms) {
  if (ms == null) return '';
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') + 'm' : '');
  const dd = Math.floor(h / 24);
  return dd + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}

module.exports = { FILE, load, save, record, setBudget, summary, fmtLeft };
