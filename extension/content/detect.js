/**
 * detect.js — Detect which ATS the current page belongs to.
 *
 * Sets window.__resumeai_ats to one of:
 *   'greenhouse' | 'lever' | 'workable' | 'smartrecruiters' |
 *   'jobvite'    | 'ashby' | 'linkedin' | 'workday' | 'icims' |
 *   'taleo'      | 'generic'
 *
 * Also notifies overlay.js via a custom event.
 */
;(function detectAts() {
  const url = location.href.toLowerCase()

  function classify(u) {
    if (u.includes('greenhouse.io')) return 'greenhouse'
    if (u.includes('lever.co')) return 'lever'
    if (u.includes('workable.com')) return 'workable'
    if (u.includes('smartrecruiters.com')) return 'smartrecruiters'
    if (u.includes('jobvite.com')) return 'jobvite'
    if (u.includes('ashbyhq.com')) return 'ashby'
    if (u.includes('linkedin.com')) return 'linkedin'
    if (u.includes('myworkdayjobs.com')) return 'workday'
    if (u.includes('icims.com')) return 'icims'
    if (u.includes('taleo.net') || u.includes('taleo.com')) return 'taleo'
    return 'generic'
  }

  const ats = classify(url)
  window.__resumeai_ats = ats

  /**
   * Best-effort job context for the "Tailor for this job" button.
   *
   * Ordered from most reliable to least: JSON-LD JobPosting is structured and
   * most ATSes emit it, og: tags are next, and only then do we fall back to
   * scraping headings. Returning empty strings is fine — the API rejects a
   * request with no title/company rather than tailoring against garbage.
   */
  function extractJob() {
    let title = '', company = '', description = ''

    // 1. schema.org JobPosting
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(node.textContent || '{}')
        for (const item of Array.isArray(data) ? data : [data, ...(data['@graph'] || [])]) {
          if (item && item['@type'] === 'JobPosting') {
            title = title || item.title || ''
            company = company || item.hiringOrganization?.name || ''
            description = description || item.description || ''
          }
        }
      } catch { /* malformed JSON-LD is common; ignore */ }
    }

    // 2. Open Graph / meta
    const meta = (sel) => document.querySelector(sel)?.getAttribute('content') || ''
    title = title || meta('meta[property="og:title"]')
    description = description || meta('meta[property="og:description"]') || meta('meta[name="description"]')

    // 3. Visible headings, last resort
    if (!title) title = document.querySelector('h1')?.textContent?.trim() || document.title || ''
    if (!company) {
      company =
        document.querySelector('[class*="company"], [data-company]')?.textContent?.trim() ||
        meta('meta[property="og:site_name"]') || ''
    }
    if (!description) {
      const main = document.querySelector('main, [class*="description"], article')
      description = main?.textContent?.trim() || ''
    }

    const clean = (v, max) => String(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    return { title: clean(title, 200), company: clean(company, 200), description: clean(description, 12000) }
  }

  window.__resumeai_job = extractJob()

  // Let overlay.js know the ATS is identified
  document.dispatchEvent(new CustomEvent('resumeai:ats_detected', { detail: { ats } }))
})()
