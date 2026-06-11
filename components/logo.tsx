/**
 * Brand logo — paper-plane mark (auto-apply / "send") + wordmark.
 * Replaces the text-only "ResumeAI" so the brand reads as a real product.
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width="26"
        height="26"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="32" height="32" rx="7" fill="#059669" />
        <path
          d="M24.5 8L8 14.2c-.7.26-.66 1.27.06 1.47l5.9 1.66 1.66 5.9c.2.72 1.21.76 1.47.06L24.5 8z"
          fill="#fff"
        />
        <path d="M24.5 8L14.9 17.3" stroke="#059669" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
      <span className="text-xl font-bold tracking-tight text-slate-900">
        Resume<span className="text-brand">AI</span>
      </span>
    </span>
  )
}
