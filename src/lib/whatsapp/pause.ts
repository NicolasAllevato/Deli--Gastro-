/** Pausa temporal del bot (coexistencia): `bot_paused_until` vigente. Sin fecha o inválida = sin pausa. */
export function isBotPausedUntil(until: string | null | undefined, now: number = Date.now()): boolean {
  if (!until) return false;
  const at = Date.parse(until);
  return Number.isFinite(at) && at > now;
}

/** El bot calla si una persona tomó el chat (panel) o hay una pausa por eco vigente. */
export function isBotSilenced(
  conversation: { human_takeover: boolean; bot_paused_until?: string | null },
  now: number = Date.now(),
): boolean {
  return conversation.human_takeover || isBotPausedUntil(conversation.bot_paused_until, now);
}
