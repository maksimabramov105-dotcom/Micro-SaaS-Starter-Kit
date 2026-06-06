import { MetadataRoute } from 'next'
import seo from '@/lib/seo-data.json'
import { REMOTE_GUIDES } from '@/lib/remote-guides'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'
  const now = new Date()

  // ── Existing English-only public routes (unchanged) ──────────────────────
  const core: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${baseUrl}/login`, lastModified: now, changeFrequency: 'yearly', priority: 0.7 },
    { url: `${baseUrl}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${baseUrl}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${baseUrl}/refund-policy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/changelog`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ]

  // ── Marketing landers added with the SEO bundle ──────────────────────────
  const marketing: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/compare`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/free-resume-teardown`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
  ]

  // ── Programmatic SEO routes (driven by lib/seo-data.json) ─────────────────
  const programmatic: MetadataRoute.Sitemap = [
    ...seo.countries.map((c) => ({
      url: `${baseUrl}/jobs-in/${c.slug}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    ...seo.jobBoards.map((b) => ({
      url: `${baseUrl}/auto-apply/${b.slug}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...seo.professions.map((p) => ({
      url: `${baseUrl}/resume/${p.slug}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...seo.competitors.map((c) => ({
      url: `${baseUrl}/alternatives/${c.slug}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    // Eligibility/remote-first landing pages (D3 — the wedge).
    ...REMOTE_GUIDES.map((g) => ({
      url: `${baseUrl}/remote/${g.slug}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ]

  return [...core, ...marketing, ...programmatic]
}
