/**
 * lib/seo/indexnow.ts — IndexNow submission (Session B, B1).
 *
 * IndexNow instantly notifies Bing/Yandex/Seznam/Naver (shared endpoint) of
 * new or changed URLs. The key is public by design — the protocol verifies
 * ownership by fetching https://host/{key}.txt, which we serve from /public.
 *
 * Google does not support IndexNow; Google discovery runs through the
 * sitemap + Search Console (owner-gated — see MASTER_PLAN owner actions).
 */

export const INDEXNOW_KEY = '9a95557e770ff35b9d7b8bbd4e6547e5'

const ENDPOINT = 'https://api.indexnow.org/indexnow'

export interface IndexNowResult {
  submitted: number
  status: number | null
  ok: boolean
}

/** Submit up to 10,000 URLs in one call. Never throws. */
export async function submitIndexNow(urls: string[]): Promise<IndexNowResult> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'
  const host = new URL(appUrl).host
  const list = urls.filter((u) => u.includes(host)).slice(0, 10000)
  if (list.length === 0) return { submitted: 0, status: null, ok: true }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `${appUrl}/${INDEXNOW_KEY}.txt`,
        urlList: list,
      }),
    })
    // 200 = processed, 202 = accepted (key check pending) — both fine.
    const ok = res.status === 200 || res.status === 202
    if (!ok) console.warn('[indexnow] submission rejected:', res.status, await res.text().catch(() => ''))
    return { submitted: list.length, status: res.status, ok }
  } catch (err) {
    console.warn('[indexnow] submission failed (non-fatal):', err)
    return { submitted: 0, status: null, ok: false }
  }
}

/** Fetch our own sitemap and return every <loc> URL. Throws on fetch/parse failure. */
export async function getSitemapUrls(): Promise<string[]> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'
  const res = await fetch(`${appUrl}/sitemap.xml`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`sitemap.xml returned ${res.status}`)
  const xml = await res.text()
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
  if (urls.length === 0) throw new Error('sitemap.xml parsed to zero URLs')
  return urls
}
