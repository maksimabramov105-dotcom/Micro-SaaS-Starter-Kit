/**
 * lib/seo/gsc.ts — Google Search Console impressions/clicks for the weekly report.
 *
 * Until this existed the growth report printed "pending owner GSC API access",
 * which meant the one number that says whether SEO is working — is Google
 * SHOWING these pages — was invisible. Referrer data cannot answer it: a page
 * can rank and collect impressions for weeks before anyone clicks, and
 * referrers only ever see the clicks.
 *
 * NO NEW DEPENDENCIES. Node's crypto signs RS256 natively, so the service-account
 * JWT is minted here rather than pulling google-auth into the image for one call.
 *
 * Everything degrades to null. A missing key, an expired key, a revoked
 * permission or a Google outage must never break the Monday email — the rest of
 * that report is still worth sending.
 *
 * KEY FILE OWNERSHIP — the thing that actually bit us. The web container runs
 * as uid 1001, not root. A key written by root at mode 600 mounts fine, the env
 * var resolves fine, and the file is visibly there — and the app still cannot
 * open it (EACCES). Because every failure here degrades to null, the only
 * symptom is the report quietly saying "unavailable" forever.
 *
 * On the host:
 *   chown 1001 /opt/resumeai/gsc-key.json && chmod 400 /opt/resumeai/gsc-key.json
 *
 * Redo that after any key rotation. scp restores root ownership every time.
 */
import crypto from 'crypto'
import fs from 'fs'

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const TOKEN_URI = 'https://oauth2.googleapis.com/token'

/** Property to query. Domain properties are prefixed `sc-domain:`. */
const PROPERTY = process.env.GSC_PROPERTY ?? 'sc-domain:resumeai-bot.com'
const KEY_PATH = process.env.GSC_KEY_PATH ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? ''

interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function readKey(): ServiceAccount | null {
  if (!KEY_PATH) return null
  try {
    const raw = fs.readFileSync(KEY_PATH, 'utf8')
    const parsed = JSON.parse(raw) as ServiceAccount
    return parsed.client_email && parsed.private_key ? parsed : null
  } catch {
    return null
  }
}

/** Mint a short-lived access token from the service-account key. */
async function accessToken(): Promise<string | null> {
  const key = readKey()
  if (!key) return null
  try {
    const now = Math.floor(Date.now() / 1000)
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claim = b64url(
      JSON.stringify({
        iss: key.client_email,
        scope: SCOPE,
        aud: key.token_uri ?? TOKEN_URI,
        iat: now,
        exp: now + 3600,
      }),
    )
    const signingInput = `${header}.${claim}`
    const signature = b64url(crypto.sign('RSA-SHA256', Buffer.from(signingInput), key.private_key))

    const res = await fetch(key.token_uri ?? TOKEN_URI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${signingInput}.${signature}`,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { access_token?: string }
    return json.access_token ?? null
  } catch {
    return null
  }
}

export interface GscWindow {
  impressions: number
  clicks: number
  /** Mean position across the window, or null when there were no impressions. */
  position: number | null
  topQueries: { query: string; impressions: number; clicks: number }[]
}

async function query(
  token: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  rowLimit = 1,
): Promise<Array<{ keys?: string[]; impressions: number; clicks: number; position: number }>> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }),
      signal: AbortSignal.timeout(20_000),
    },
  )
  if (!res.ok) return []
  const json = (await res.json()) as { rows?: Array<{ keys?: string[]; impressions: number; clicks: number; position: number }> }
  return json.rows ?? []
}

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)

/**
 * Impressions and clicks for the last `days`, plus the prior equal window for a
 * week-over-week comparison. Returns null when GSC is unavailable for any
 * reason — the caller prints an honest "unavailable" line rather than a zero,
 * because zero impressions and no-data mean very different things.
 */
export async function getSearchConsole(
  days = 7,
): Promise<{ current: GscWindow; previous: GscWindow | null } | null> {
  const token = await accessToken()
  if (!token) return null

  try {
    // GSC data lags ~2 days; ending "today" reports an artificial slump.
    const LAG = 2
    const [curTotals, prevTotals, curQueries] = await Promise.all([
      query(token, day(days + LAG), day(LAG), []),
      query(token, day(days * 2 + LAG), day(days + LAG + 1), []),
      query(token, day(days + LAG), day(LAG), ['query'], 5),
    ])

    const shape = (
      rows: Array<{ impressions: number; clicks: number; position: number }>,
    ): GscWindow => {
      const r = rows[0]
      return {
        impressions: r?.impressions ?? 0,
        clicks: r?.clicks ?? 0,
        position: r?.impressions ? Math.round((r.position ?? 0) * 10) / 10 : null,
        topQueries: [],
      }
    }

    const current = shape(curTotals)
    current.topQueries = curQueries.map((r) => ({
      query: r.keys?.[0] ?? '?',
      impressions: r.impressions,
      clicks: r.clicks,
    }))

    return { current, previous: prevTotals.length ? shape(prevTotals) : null }
  } catch {
    return null
  }
}

/** Report lines. Distinguishes "no data" from a genuine zero. */
export function formatGscLines(
  data: { current: GscWindow; previous: GscWindow | null } | null,
): string[] {
  if (!data) return ['  GSC impressions       unavailable (key missing or API error)']

  const { current, previous } = data
  const wow = (now: number, before: number | undefined) => {
    if (before === undefined || before === 0) return ''
    return ` (${now - before >= 0 ? '+' : ''}${Math.round(((now - before) / before) * 100)}% WoW)`
  }

  const lines = [
    `  GSC impressions       ${current.impressions}${wow(current.impressions, previous?.impressions)}`,
    `  GSC clicks            ${current.clicks}${wow(current.clicks, previous?.clicks)}`,
    `  GSC avg position      ${current.position ?? 'n/a'}`,
  ]

  if (current.impressions === 0) {
    // Zero impressions is not a soft number — it means Google is not showing
    // these pages at all, which needs a different response from a low CTR.
    lines.push('  ^ zero impressions: pages are not being shown yet, not merely unclicked')
  }
  for (const q of current.topQueries.slice(0, 3)) {
    lines.push(`    "${q.query.slice(0, 38)}" — ${q.impressions} impr, ${q.clicks} clicks`)
  }
  return lines
}
