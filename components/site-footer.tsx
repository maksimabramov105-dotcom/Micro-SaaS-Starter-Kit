import Link from 'next/link'

/**
 * SiteFooter — ONE footer for every public/marketing page (E2).
 * Server component, zero client JS. Carries the support email and the legal
 * links (refund/terms/privacy) that the trust block promises.
 */
export function SiteFooter() {
  const links = [
    { href: '/ats-check', label: 'Free fit check' },
    { href: '/resume-rescue', label: 'Resume Rescue' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/proof', label: 'Proof' },
    { href: '/blog', label: 'Blog' },
    { href: '/faq', label: 'FAQ' },
    { href: '/refund-policy', label: 'Refund Policy' },
    { href: '/terms', label: 'Terms' },
    { href: '/privacy', label: 'Privacy' },
    { href: '/contact', label: 'Contact' },
  ]

  return (
    <footer className="border-t border-slate-100 bg-slate-50 px-4 py-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 text-sm text-slate-600 sm:flex-row sm:justify-between">
        <span>
          &copy; {new Date().getFullYear()} ResumeAI ·{' '}
          <a href="mailto:support@resumeai-bot.ru" className="hover:text-slate-900">
            support@resumeai-bot.ru
          </a>
        </span>
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-slate-900">
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  )
}
