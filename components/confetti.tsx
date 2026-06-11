/**
 * confetti.tsx — CSS-only celebration burst for the interview "aha" moment (P3.14).
 *
 * Deterministic pieces (no Math.random → no SSR/CSR mismatch). Pure presentation;
 * place inside a `relative overflow-hidden` container. Honors reduced-motion.
 */
const COLORS = ['#059669', '#34d399', '#fbbf24', '#38bdf8', '#f472b6']

// Fixed, varied pieces so the burst looks organic without randomness.
const PIECES = Array.from({ length: 36 }, (_, i) => ({
  left: (i * 2.8 + (i % 5) * 3.5) % 100,
  delay: (i % 9) * 0.18,
  duration: 2.4 + (i % 6) * 0.4,
  color: COLORS[i % COLORS.length],
  size: 6 + (i % 3) * 2,
  rotate: (i % 2 === 0 ? 1 : -1) * (180 + (i % 4) * 90),
}))

export function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <style>{`
        @keyframes cf-fall { 0%{transform:translateY(-20%) rotate(0);opacity:1} 100%{transform:translateY(260%) rotate(var(--cf-r));opacity:0} }
        @media (prefers-reduced-motion: reduce){ .cf-pc{display:none} }
      `}</style>
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="cf-pc absolute top-0 rounded-[1px]"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size + 2,
            background: p.color,
            ['--cf-r' as string]: `${p.rotate}deg`,
            animation: `cf-fall ${p.duration}s ${p.delay}s ease-in forwards`,
          }}
        />
      ))}
    </div>
  )
}
