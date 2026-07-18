import { MetadataRoute } from 'next'
import seo from '@/lib/seo-data.json'
import { REMOTE_GUIDES } from '@/lib/remote-guides'
import { APPLY_COMPANIES } from '@/lib/seo/apply-companies'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'
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
  ]

  return [...core, ...marketing, ...programmatic]
}
