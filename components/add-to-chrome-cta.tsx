import { CHROME_STORE_URL } from '@/lib/site'

/**
 * "Add to Chrome — free" CTA (P2.5).
 *
 * Renders NOTHING until NEXT_PUBLIC_CHROME_EXTENSION_ID is set. The extension
 * is not in the Web Store yet (P2.4 is owner-gated on submission + review), and
 * a primary CTA that links to a listing which does not exist is a broken
 * promise — precisely the kind of thing the positioning cannot afford. When the
 * listing goes live, set the env var and the button appears everywhere at once,
 * no code change.
 *
 * Server component: zero client JS, safe on the statically rendered landing.
 */
export function AddToChromeCta({
  refTag,
  variant = 'primary',
}: {
  refTag: string
  variant?: 'primary' | 'secondary'
}) {
  if (!CHROME_STORE_URL) return null

  const base = 'rounded-lg font-semibold transition-colors inline-flex items-center gap-2'
  const styles =
    variant === 'primary'
      ? `${base} bg-slate-900 px-8 py-3 text-lg text-white hover:bg-slate-800`
      : `${base} border-2 border-slate-900 px-5 py-2.5 text-sm text-slate-900 hover:bg-slate-100`

  return (
    <a href={`${CHROME_STORE_URL}?ref=${refTag}`} className={styles} rel="noopener" target="_blank">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M12 2a10 10 0 0 1 8.66 5H12a5 5 0 0 0-4.9 4.02L3.34 5.5A10 10 0 0 1 12 2Zm10 10a10 10 0 0 1-9.2 9.97l3.79-6.56A5 5 0 0 0 17 12h5ZM2 12a10 10 0 0 0 8.2 9.83L6.4 15.27A5 5 0 0 1 2 12Zm10 3a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
      </svg>
      Add to Chrome &mdash; free
    </a>
  )
}
