/**
 * lib/site.ts — the single source of truth for our domain and contact
 * addresses (P1.1 domain-migration prep).
 *
 * WHY: the domain was hardcoded as "resumeai-bot.ru" in 60+ places. Migrating
 * to a new domain meant a 64-file sweep with a real chance of missing one and
 * shipping a canonical, a JSON-LD `url`, or a support mailto pointing at a
 * domain we no longer own. Everything now derives from NEXT_PUBLIC_APP_URL, so
 * the migration is one env change plus a deploy.
 *
 * Deliberately NOT changed here: INBOX_DOMAIN. Reply-inbox handles are minted
 * per user and 9 accounts already hold @<old-domain> addresses; repointing that
 * would silently break inbound mail for them. The inbox domain migrates on its
 * own schedule, once MX for the new domain is live and the old one keeps
 * accepting mail. See docs/DOMAIN_MIGRATION.md.
 */

/** Canonical origin, e.g. "https://resumeai-bot.ru". No trailing slash. */
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru').replace(
  /\/$/,
  '',
)

/** Bare host, e.g. "resumeai-bot.ru" — for copy that shouldn't show a scheme. */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, '')

/**
 * Address on the *email* domain, which is not necessarily the site domain
 * during a migration: mail keeps flowing from the verified Resend domain until
 * the new one is verified. Override with EMAIL_DOMAIN when they differ.
 */
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN ?? SITE_HOST

export const SUPPORT_EMAIL = `support@${EMAIL_DOMAIN}`
export const HELLO_EMAIL = `hello@${EMAIL_DOMAIN}`

/** Absolute URL for a site-relative path: absoluteUrl('/pricing'). */
export function absoluteUrl(path = '/'): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}
