import { MetadataRoute } from 'next'
import seo from '@/lib/seo-data.json'
import { REMOTE_GUIDES } from '@/lib/remote-guides'
import { APPLY_COMPANIES } from '@/lib/seo/apply-companies'
import ROLE_KEYWORDS from '@/lib/seo/role-keywords.json'
import { SITE_URL } from '@/lib/site'

/**
 * Rendered per request, not baked at build.
 *
 * The Docker image is built with NEXT_PUBLIC_APP_URL hardcoded in deploy.yml, so
 * a statically generated sitemap freezes whatever domain was set at BUILD time.
 * During the .ru -> .com migration that meant the live site served 301 URLs all
 * still pointing at the old domain, with no way to fix it short of a rebuild.
 * The data here is a handful of in-memory arrays, so generating it per request
 * costs nothing and the sitemap now always matches the running env.
 */
export const dynamic = 'force-dynamic'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_URL
  // Honest lastmod (B1): a stable content-release date for pages whose copy
  // only changes with deploys. Stamping `new Date()` on every request told
  // crawlers everything changed constantly — a credibility-burning signal.
  // Bump CONTENT_UPDATED when marketing/program page content meaningfully
  // changes. `now` stays only for genuinely live pages (e.g. /proof).
  const CONTENT_UPDATED = new Date('2026-07-17')
  const now = new Date()

  // ── Existing English-only public routes (unchanged) ──────────────────────
  const core: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: CONTENT_UPDATED, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/pricing`, lastModified: CONTENT_UPDATED, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${baseUrl}/login`, lastModified: CONTENT_UPDATED, changeFrequency: 'yearly', priority: 0.7 },
    { url: `${baseUrl}/faq`, lastModified: CONTENT_UPDATED, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/terms`, lastModified: CONTENT_UPDATED, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${baseUrl}/privacy`, lastModified: CONTENT_UPDATED, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${baseUrl}/refund-policy`, lastModified: CONTENT_UPDATED, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/contact`, lastModified: CONTENT_UPDATED, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/changelog`, lastModified: CONTENT_UPDATED, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/proof`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${baseUrl}/ats-check`, lastModified: CONTENT_UPDATED, changeFrequency: 'monthly', priority: 0.8 },
  ]

  // ── Marketing landers added with the SEO bundle ──────────────────────────
  const marketing: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/compare`, lastModified: CONTENT_UPDATED, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/free-resume-teardown`, lastModified: CONTENT_UPDATED, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/resume-rescue`, lastModified: CONTENT_UPDATED, changeFrequency: 'monthly', priority: 0.9 },
  ]

  // ── Programmatic SEO routes (driven by lib/seo-data.json) ─────────────────
  const programmatic: MetadataRoute.Sitemap = [
    ...seo.countries.map((c) => ({
      url: `${baseUrl}/jobs-in/${c.slug}`,
      lastModified: CONTENT_UPDATED,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    ...seo.jobBoards.map((b) => ({
      url: `${baseUrl}/auto-apply/${b.slug}`,
      lastModified: CONTENT_UPDATED,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...seo.professions.map((p) => ({
      url: `${baseUrl}/resume/${p.slug}`,
      lastModified: CONTENT_UPDATED,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...seo.competitors.map((c) => ({
      url: `${baseUrl}/alternatives/${c.slug}`,
      lastModified: CONTENT_UPDATED,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    // Eligibility/remote-first landing pages (D3 — the wedge).
    ...REMOTE_GUIDES.map((g) => ({
      url: `${baseUrl}/remote/${g.slug}`,
      lastModified: CONTENT_UPDATED,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    // Per-company application guides (B2) — hub + one page per curated company.
    { url: `${baseUrl}/apply-to`, lastModified: CONTENT_UPDATED, changeFrequency: 'weekly' as const, priority: 0.8 },
    ...APPLY_COMPANIES.map((c) => ({
      url: `${baseUrl}/apply-to/${c.slug}`,
      lastModified: CONTENT_UPDATED,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    // Telemetry blog (B3) — stats sections update daily via ISR.
    { url: `${baseUrl}/blog`, lastModified: CONTENT_UPDATED, changeFrequency: 'weekly' as const, priority: 0.7 },
    { url: `${baseUrl}/blog/how-many-applications-reach-a-human`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.7 },
    { url: `${baseUrl}/blog/auto-apply-failure-modes`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.7 },
    // Role keyword pages (B2) — corpus-backed only; grows with the crawler.
    { url: `${baseUrl}/resume-keywords`, lastModified: CONTENT_UPDATED, changeFrequency: 'monthly' as const, priority: 0.7 },
    ...ROLE_KEYWORDS.map((r) => ({
      url: `${baseUrl}/resume-keywords/${r.slug}`,
      lastModified: CONTENT_UPDATED,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ]

  return [...core, ...marketing, ...programmatic]
}
