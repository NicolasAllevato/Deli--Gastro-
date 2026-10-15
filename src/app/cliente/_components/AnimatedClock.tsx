/** Reloj con agujas que giran: indica que el pedido está en marcha. Decorativo. */
export function AnimatedClock({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className="text-brand-orange">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      {[0, 90, 180, 270].map((deg) => (
        <line key={deg} x1="12" y1="3.6" x2="12" y2="4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" transform={`rotate(${deg} 12 12)`} />
      ))}
      <line className="clock-hand-hour" x1="12" y1="12" x2="12" y2="8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <line className="clock-hand-minute" x1="12" y1="12" x2="12" y2="5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </svg>
  );
}
