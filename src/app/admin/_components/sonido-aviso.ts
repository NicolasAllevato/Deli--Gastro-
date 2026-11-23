/** Dos tonos cortos con WebAudio. false si el navegador lo bloquea (todavía no hubo interacción). */
export async function sonar(ctxRef: { current: AudioContext | null }): Promise<boolean> {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    ctxRef.current ??= new Ctor();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    if (ctx.state !== "running") return false;
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.22;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.21);
    });
    return true;
  } catch {
    return false;
  }
}
