import Link from 'next/link'
import { Logo } from '@/components/logo'

/**
 * SiteHeader — ONE navigation for every public/marketing page (E2).
 *
 * Before this, the homepage inlined its own <nav>, most other pages used the
 * session-aware <Navbar>, and the ~290 programmatic SEO pages had no nav at
 * all. Now they all render the same links.
 *
 * Deliberately a SERVER component with static links: it ships zero client JS,
 * so dropping it onto every static SEO page costs nothing in Lighthouse. The
 * session-aware header (avatar, Dashboard, sign-out) stays in <Navbar> for the
 * logged-in app shell under /dashboard.
 */
export function SiteHeader() {
  const links = [
    { href: '/ats-check', label: 'Free fit check' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/proof', label: 'Proof' },
    { href: '/blog', label: 'Blog' },
  ]

  return (
    <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" aria-label="ResumeAI home">
          <Logo />
        </Link>
        <div className="flex items-center gap-4 sm:gap-6">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="hidden text-sm text-slate-600 hover:text-slate-900 sm:block"
            >
              {l.label}
            </Link>
          ))}
          <Link href="/login" className="text-sm text-slate-600 hover:text-slate-900">
            Sign in
          </Link>
          <Link
            href="/login?ref=nav"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            Get Started
          </Link>
        </div>
      </nav>
    </header>
  )
}
