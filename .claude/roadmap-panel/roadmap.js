'use strict';
// Parser y editor de ROADMAP.md. Sin dependencias.
// Edita línea por línea para no tocar nada que el usuario haya escrito a mano.

const SPECIAL = { agentes: 'agents', preguntas: 'questions', notas: 'notes', revisiones: 'reviews' };
const BOX = [' ', '~', 'x'];
const STATUS = ['pendiente', 'en curso', 'hecho'];
const URG = { urgent: '!!', soon: '!', normal: '' };

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim().slice(0, max || 500);
}

function parse(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let trail = false;
  if (lines.length && lines[lines.length - 1] === '') { lines.pop(); trail = true; }

  const st = {
    eol, trail, lines, meta: {}, metaEnd: -1, title: null,
    sec: {}, agents: [], reviews: [], questions: [], milestones: [], notes: [],
  };

  let i = 0;
  if (lines[0] && lines[0].trim() === '---') {
    let j = 1;
    for (; j < lines.length && lines[j].trim() !== '---'; j++) {
      const m = lines[j].match(/^([^:\s]+):\s*(.*)$/);
      if (m) st.meta[m[1].toLowerCase()] = m[2].trim();
    }
    if (j < lines.length) { st.metaEnd = j; i = j + 1; }
  }

  let sec = null, cur = null, q = null;
  for (; i < lines.length; i++) {
    const ln = lines[i];
    let m;
    if ((m = ln.match(/^# (.+)/))) { if (!st.title) st.title = m[1].trim(); continue; }
    if ((m = ln.match(/^##\s+(.+?)\s*$/))) {
      const head = m[1];
      const key = SPECIAL[head.toLowerCase()];
      q = null;
      if (key) { sec = key; cur = null; st.sec[key] = i; }
      else {
        const sm = head.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
        cur = { line: i, name: (sm ? sm[1] : head).trim(), status: sm ? sm[2].trim() : null, tasks: [] };
        st.milestones.push(cur);
        sec = 'milestone';
      }
      continue;
    }
    if (sec === 'agents') {
      if ((m = ln.match(/^- (.+)/))) {
        const p = m[1].split(/\s+·\s+/);
        st.agents.push({ line: i, name: p[0], model: p[1] || '', state: p[2] || '', detail: p.slice(3).join(' · ') });
      }
    } else if (sec === 'reviews') {
      if ((m = ln.match(/^- (.+)/))) {
        const p = m[1].split(/\s+·\s+/);
        st.reviews.push({ line: i, date: p[0] || '', type: p[1] || '', env: p[2] || '', p95: p[3] || '', err: p[4] || '', users: p[5] || '', result: p[6] || '' });
      }
    } else if (sec === 'notes') {
      if ((m = ln.match(/^- (.+)/))) st.notes.push({ line: i, text: m[1] });
    } else if (sec === 'questions') {
      if ((m = ln.match(/^- \[\?\]\s*(!{1,2})?\s*(.+)/))) {
        q = {
          line: i, end: i, urgency: m[1] ? (m[1].length === 2 ? 'urgent' : 'soon') : 'normal',
          title: m[2].trim(), options: [], suggestion: '', answer: '', answerLine: -1,
        };
        st.questions.push(q);
      } else if (q && (m = ln.match(/^\s+- (Opciones|Sugerencia|R):\s*(.*)$/i))) {
        const k = m[1].toLowerCase();
        q.end = i;
        if (k === 'opciones') q.options = m[2].split('|').map((s) => s.trim()).filter(Boolean);
        else if (k === 'sugerencia') q.suggestion = m[2].trim();
        else {
          q.answerLine = i;
          q.answer = /^\(.*\)$/.test(m[2].trim()) ? '' : m[2].trim();
        }
      } else if (q && /^\s+\S/.test(ln)) {
        q.end = i;
      }
    } else if (sec === 'milestone' && cur) {
      if ((m = ln.match(/^- \[([ xX~])\]\s*(.+)/))) {
        cur.tasks.push({ line: i, state: m[1] === '~' ? 1 : m[1] === ' ' ? 0 : 2, text: m[2].trim() });
      }
    }
  }
  return st;
}

function serialize(st) {
  return st.lines.join(st.eol) + (st.trail !== false ? st.eol : '');
}

function reparse(st) {
  const fresh = parse(serialize(st));
  Object.keys(st).forEach((k) => delete st[k]);
  Object.assign(st, fresh);
}

function calcStatus(tasks) {
  if (!tasks.length) return null;
  if (tasks.every((t) => t.state === 2)) return 'hecho';
  if (tasks.some((t) => t.state > 0)) return 'en curso';
  return 'pendiente';
}

// Deja el estado de cada hito coherente con sus tareas y actualiza la fecha.
function normalize(st) {
  st.milestones.forEach((m) => {
    const s = calcStatus(m.tasks);
    if (s && s !== m.status) st.lines[m.line] = '## ' + m.name + ' [' + s + ']';
  });
  if (st.metaEnd > 0) {
    let found = false;
    for (let i = 1; i < st.metaEnd; i++) {
      if (/^actualizado:/i.test(st.lines[i])) { st.lines[i] = 'actualizado: ' + today(); found = true; }
    }
    if (!found) st.lines.splice(st.metaEnd, 0, 'actualizado: ' + today());
  }
}

function lastContent(st, head) {
  let last = head;
  for (let i = head + 1; i < st.lines.length; i++) {
    if (/^#{1,2}\s/.test(st.lines[i])) break;
    if (st.lines[i].trim()) last = i;
  }
  return last;
}

function ensureSection(st, key, title) {
  if (st.sec[key] !== undefined) return st.sec[key];
  let at = st.lines.length;
  if (key !== 'notes') {
    if (st.milestones.length) at = st.milestones[0].line;
    else if (st.sec.notes !== undefined) at = st.sec.notes;
  }
  if (at === st.lines.length && st.lines.length && st.lines[st.lines.length - 1].trim()) st.lines.push('');
  at = Math.min(at, st.lines.length);
  st.lines.splice(at, 0, '## ' + title, '');
  reparse(st);
  return st.sec[key];
}

function need(cond, msg) { if (!cond) throw new Error(msg); }

function apply(st, op) {
  switch (op.op) {
    case 'task': {
      const m = st.milestones[op.g];
      need(m && m.tasks[op.t], 'Tarea inexistente');
      const cur = m.tasks[op.t];
      const next = op.state === 'cycle' ? (cur.state + 1) % 3 : Number(op.state);
      need(next >= 0 && next <= 2, 'Estado inválido');
      st.lines[cur.line] = st.lines[cur.line].replace(/^(- \[)[ xX~](\])/, '$1' + BOX[next] + '$2');
      break;
    }
    case 'answer': {
      const q = st.questions[op.q];
      need(q, 'Pregunta inexistente');
      const text = clean(op.text);
      if (q.answerLine >= 0) {
        st.lines[q.answerLine] = st.lines[q.answerLine].replace(/^(\s*- R:).*$/i, '$1' + (text ? ' ' + text : ''));
      } else {
        st.lines.splice(q.end + 1, 0, '  - R:' + (text ? ' ' + text : ''));
      }
      break;
    }
    case 'urgency': {
      const q = st.questions[op.q];
      need(q && op.level in URG, 'Pregunta o nivel inválido');
      st.lines[q.line] = '- [?]' + (URG[op.level] ? ' ' + URG[op.level] : '') + ' ' + q.title;
      break;
    }
    case 'addTask': {
      const m = st.milestones[op.g];
      const text = clean(op.text);
      need(m && text, 'Hito o texto inválido');
      const at = m.tasks.length ? m.tasks[m.tasks.length - 1].line : m.line;
      st.lines.splice(at + 1, 0, '- [ ] ' + text);
      break;
    }
    case 'addMilestone': {
      const name = clean(op.name, 120).replace(/[\[\]]/g, '');
      need(name, 'Nombre vacío');
      if (st.sec.notes !== undefined) st.lines.splice(st.sec.notes, 0, '## ' + name + ' [pendiente]', '');
      else {
        if (st.lines.length && st.lines[st.lines.length - 1].trim()) st.lines.push('');
        st.lines.push('## ' + name + ' [pendiente]');
      }
      break;
    }
    case 'addQuestion': {
      const title = clean(op.title, 300);
      need(title, 'Pregunta vacía');
      const level = op.level in URG ? op.level : 'normal';
      const opts = (Array.isArray(op.options) ? op.options : []).map((o) => clean(o, 80).replace(/\|/g, '/')).filter(Boolean);
      const head = ensureSection(st, 'questions', 'Preguntas');
      const at = lastContent(st, head);
      st.lines.splice(at + 1, 0,
        '- [?]' + (URG[level] ? ' ' + URG[level] : '') + ' ' + title,
        '  - Opciones: ' + opts.join(' | '),
        '  - Sugerencia: ' + clean(op.suggestion, 300),
        '  - R:');
      break;
    }
    case 'addNote': {
      const text = clean(op.text);
      need(text, 'Nota vacía');
      const head = ensureSection(st, 'notes', 'Notas');
      st.lines.splice(lastContent(st, head) + 1, 0, '- ' + today() + ' · ' + text);
      break;
    }
    case 'addReview': {
      const f = (k) => clean(op[k], 60).replace(/·/g, '-');
      need(f('type'), 'Falta el tipo de prueba');
      const row = [today(), f('type'), f('env') || '-', f('p95') || '-', f('err') || '-', f('users') || '-', f('result') || '-'];
      const head = ensureSection(st, 'reviews', 'Revisiones');
      st.lines.splice(lastContent(st, head) + 1, 0, '- ' + row.join(' · '));
      break;
    }
    case 'agent': {
      const a = st.agents[op.i];
      need(a, 'Agente inexistente');
      const parts = [a.name, a.model || '-', clean(op.state, 40)];
      if (a.detail) parts.push(a.detail);
      st.lines[a.line] = '- ' + parts.join(' · ');
      break;
    }
    default:
      throw new Error('Operación desconocida');
  }
}

function mutateText(text, op) {
  let st = parse(text);
  apply(st, op);
  reparse(st);
  normalize(st);
  return serialize(st);
}

function view(st) {
  const milestones = st.milestones.map((m, i) => {
    const total = m.tasks.length;
    const done = m.tasks.filter((t) => t.state === 2).length;
    const doing = m.tasks.filter((t) => t.state === 1).length;
    return {
      i, name: m.name, status: calcStatus(m.tasks) || m.status || 'pendiente',
      tasks: m.tasks.map((t, ti) => ({ t: ti, state: t.state, text: t.text })),
      total, done, doing, todo: total - done - doing, pct: total ? Math.round((done / total) * 100) : 0,
    };
  });
  const sum = (k) => milestones.reduce((a, m) => a + m[k], 0);
  const total = sum('total'), done = sum('done'), doing = sum('doing');
  const questions = st.questions.map((q, i) => ({
    i, urgency: q.urgency, title: q.title, options: q.options, suggestion: q.suggestion,
    answer: q.answer, answered: !!q.answer,
  }));
  const open = questions.filter((q) => !q.answered);
  return {
    meta: st.meta, title: st.title,
    agents: st.agents.map((a, i) => ({ i, name: a.name, model: a.model, state: a.state, detail: a.detail })),
    questions, milestones, notes: st.notes.map((n) => n.text),
    reviews: st.reviews.map((r) => ({ date: r.date, type: r.type, env: r.env, p95: r.p95, err: r.err, users: r.users, result: r.result })),
    stats: {
      total, done, doing, todo: total - done - doing, pct: total ? Math.round((done / total) * 100) : 0,
      open: open.length,
      urgent: open.filter((q) => q.urgency === 'urgent').length,
      soon: open.filter((q) => q.urgency === 'soon').length,
    },
  };
}

module.exports = { parse, serialize, apply, normalize, mutateText, view, today, STATUS };
