/**
 * hero-demo.tsx — the hero's product-proof visual (P2.9).
 *
 * A CSS-only looped animation styled like the real dashboard: a matched job card
 * cycles through "new match → tailoring resume → submitting → submitted ✓
 * confirmed by ATS". No video file, no JS timers. Honors prefers-reduced-motion
 * (shows the final confirmed state, static).
 */
export function HeroDemo() {
  return (
    <div className="relative w-full max-w-md">
      <style>{`
        @keyframes hd-bar { 0%{width:4%} 100%{width:100%} }
        /* Non-overlapping windows with blank gaps so two status lines are NEVER
           visible at once (no text-on-text). Each fades fully out before the next
           fades in. */
        @keyframes hd-s1 { 0%,20%{opacity:1} 23%,100%{opacity:0} }
        @keyframes hd-s2 { 0%,25%{opacity:0} 28%,45%{opacity:1} 48%,100%{opacity:0} }
        @keyframes hd-s3 { 0%,50%{opacity:0} 53%,70%{opacity:1} 73%,100%{opacity:0} }
        @keyframes hd-s4 { 0%,75%{opacity:0} 78%,98%{opacity:1} 100%{opacity:0} }
        @keyframes hd-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
        /* Hidden by default — only the animation reveals one at a time. */
        .hd-step{position:absolute;inset:0;display:flex;align-items:center;gap:.5rem;opacity:0}
        .hd-bar{animation:hd-bar 8s linear infinite}
        .hd-s1{animation:hd-s1 8s linear infinite}
        .hd-s2{animation:hd-s2 8s linear infinite}
        .hd-s3{animation:hd-s3 8s linear infinite}
        .hd-s4{animation:hd-s4 8s linear infinite}
        .hd-dot{animation:hd-pulse 1.6s ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){
          .hd-bar{animation:none;width:100%}
          .hd-s1,.hd-s2,.hd-s3{animation:none;opacity:0}
          .hd-s4{animation:none;opacity:1}
        }
      `}</style>

      {/* window chrome */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
          <span className="ml-2 text-xs font-medium text-slate-500">ResumeAI · auto-apply</span>
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand">
            <span className="hd-dot h-1.5 w-1.5 rounded-full bg-brand" /> live
          </span>
        </div>

        {/* job card */}
        <div className="p-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-sm font-bold text-brand-deep">
              A
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">Customer Support Specialist</p>
              <p className="truncate text-xs text-slate-500">Acme · Remote (APAC) · eligible ✓</p>
            </div>
          </div>

          {/* progress bar */}
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="hd-bar h-full rounded-full bg-brand" />
          </div>

          {/* cycling status line */}
          <div className="relative mt-3 h-6 text-sm">
            <div className="hd-step hd-s1 text-slate-600">
              <span className="h-2 w-2 rounded-full bg-slate-400" /> New match found
            </div>
            <div className="hd-step hd-s2 text-amber-700">
              <span className="h-2 w-2 rounded-full bg-amber-500" /> Tailoring your resume…
            </div>
            <div className="hd-step hd-s3 text-sky-700">
              <span className="h-2 w-2 rounded-full bg-sky-500" /> Submitting application…
            </div>
            <div className="hd-step hd-s4 font-medium text-brand-deep">
              <span className="h-2 w-2 rounded-full bg-brand" /> Submitted ✓ — confirmed by ATS
            </div>
          </div>
        </div>
      </div>

      {/* soft brand glow */}
      <div className="absolute -inset-4 -z-10 rounded-3xl bg-brand-soft/40 blur-2xl" aria-hidden="true" />
    </div>
  )
}
