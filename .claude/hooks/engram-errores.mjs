// Hook PostToolUseFailure: aprende de los errores con engram.
// 1) Busca en engram errores parecidos ya resueltos y se los inyecta al modelo.
// 2) Registra el error nuevo (deduplicado) para que quede historial.
// Nunca bloquea: ante cualquier falla sale en silencio con código 0.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PROJECT = "deli-gastro-";
const IGNORAR = /user (denied|rejected)|permission|interrupted|cancel|no matches found|file has not been read|old_string/i;
const SECRETO = /(sk-[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9._-]{20,}|(?:token|secret|password|api[_-]?key)\s*[:=]\s*\S+)/gi;

function leerEntrada() {
  try { return JSON.parse(readFileSync(0, "utf8").replace(/^﻿/, "")); } catch { return null; }
}

function texto(v) {
  if (v == null) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

function engram(args) {
  return execFileSync("engram", args, { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "ignore"] });
}

function yaVisto(hash, sesion) {
  const dir = join(tmpdir(), "engram-errores");
  mkdirSync(dir, { recursive: true });
  const archivo = join(dir, `${sesion || "sin-sesion"}.json`);
  const vistos = existsSync(archivo) ? JSON.parse(readFileSync(archivo, "utf8")) : [];
  if (vistos.includes(hash)) return true;
  writeFileSync(archivo, JSON.stringify([...vistos, hash].slice(-200)));
  return false;
}

function main() {
  const e = leerEntrada();
  if (!e) return;
  const herramienta = e.tool_name || "herramienta";
  const error = texto(e.error ?? e.tool_response).replace(SECRETO, "[oculto]").slice(0, 600);
  if (!error || IGNORAR.test(error)) return;

  const entrada = texto(e.tool_input?.command ?? e.tool_input?.file_path ?? e.tool_input).replace(SECRETO, "[oculto]").slice(0, 200);
  const firma = error.replace(/\d+/g, "#").replace(/[A-Z]:\\[^\s"']+/g, "<ruta>").slice(0, 200);
  const hash = createHash("sha1").update(herramienta + firma).digest("hex").slice(0, 12);
  if (yaVisto(hash, e.session_id)) return;

  let previos = "";
  try {
    const consulta = firma.replace(/[^\p{L}\p{N}\s_.-]/gu, " ").split(/\s+/).filter((w) => w.length > 3).slice(0, 6).join(" ");
    if (consulta) previos = engram(["search", consulta, "--project", PROJECT, "--limit", "3"]).trim();
  } catch { /* sin resultados */ }

  try {
    engram(["save", `Error ${herramienta} [${hash}]`, `Entrada: ${entrada}\nError: ${error}`, "--type", "bugfix", "--project", PROJECT]);
  } catch { /* engram no disponible */ }

  const hayPrevios = previos && !/no (memories|results)|0 results/i.test(previos);
  const contexto = [
    `[engram-errores] Falló ${herramienta}. Registrado como [${hash}].`,
    hayPrevios ? `Errores parecidos en memoria (revisá si ya se resolvió antes):\n${previos.slice(0, 1500)}` : "No hay errores parecidos en memoria.",
    "Cuando lo resuelvas, guardá la causa raíz y la solución con mem_save (type: bugfix, título con la etiqueta del error).",
  ].join("\n");

  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUseFailure", additionalContext: contexto } }));
}

try { main(); } catch { /* nunca romper la sesión */ }
