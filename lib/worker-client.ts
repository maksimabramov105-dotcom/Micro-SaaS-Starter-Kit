/**
 * worker-client.ts — thin bridge from Next.js → Python FastAPI worker.
 *
 * All server-side calls to the worker go through here so that:
 *  - WORKER_SECRET is never leaked to the browser
 *  - Sentry captures every non-2xx unconditionally
 *  - Caller only needs to handle the already-parsed JSON body
 */
import * as Sentry from '@sentry/nextjs'

export class WorkerError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'WorkerError'
  }
}

/**
 * POST `path` to the Python worker and return the parsed JSON response.
 *
 * @param path  Worker-relative path, e.g. `/health` or `/jobs/scrape/adzuna`
 * @param body  Request body — omit or pass `undefined` for bodyless requests
 */
export async function callWorker<T = unknown>(
  path: string,
  body?: unknown,
): Promise<T> {
  const baseUrl = process.env.WORKER_URL
  const secret = process.env.WORKER_SECRET

  if (!baseUrl || !secret) {
    throw new Error(
      'WORKER_URL and WORKER_SECRET must be set before calling the worker',
    )
  }

  const url = `${baseUrl.replace(/\/$/, '')}${path}`

  let response: Response
  try {
    response = await fetch(url, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch (networkErr) {
    const err = new WorkerError(0, path, `Worker unreachable: ${String(networkErr)}`)
    Sentry.captureException(err, { extra: { path, url } })
    throw err
  }

  if (!response.ok) {
    let detail = ''
    try {
      const payload = await response.json()
      detail = payload?.detail ?? JSON.stringify(payload)
    } catch {
      detail = await response.text().catch(() => '')
    }

    const err = new WorkerError(
      response.status,
      path,
      `Worker responded ${response.status}: ${detail}`,
    )
    Sentry.captureException(err, {
      extra: { path, url, status: response.status, detail },
    })
    throw err
  }

  return response.json() as Promise<T>
}

// ── PDF template renderer ─────────────────────────────────────────────────────

/**
 * Call the WeasyPrint render endpoint on the worker.
 *
 * Returns the raw PDF as a Buffer. Only called when PDF_TEMPLATES_V1=true.
 */
export async function renderResumePdf(args: {
  resumeId: string
  templateId: string
  resumeData: Record<string, unknown>
}): Promise<Buffer> {
  const baseUrl = process.env.WORKER_URL
  const secret = process.env.WORKER_SECRET

  if (!baseUrl || !secret) {
    throw new Error('WORKER_URL and WORKER_SECRET must be set')
  }

  const url = `${baseUrl.replace(/\/$/, '')}/jobs/resumes/${args.resumeId}/render`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        template_id: args.templateId,
        resume_data: args.resumeData,
      }),
    })
  } catch (networkErr) {
    const err = new WorkerError(0, url, `Worker unreachable: ${String(networkErr)}`)
    Sentry.captureException(err)
    throw err
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const err = new WorkerError(response.status, url, `Render failed ${response.status}: ${detail}`)
    Sentry.captureException(err)
    throw err
  }

  const ab = await response.arrayBuffer()
  return Buffer.from(ab)
}

/**
 * adaptResumeData — §3.2 JSON shape adapter.
 *
 * Templates need structured data, not a plain text string.
 * Priority order:
 *   1. `generated.resume_structured` — present when V2 pipeline ran (preferred)
 *   2. Parse `generated.resume_text` with a best-effort line-splitter
 *   3. Return a minimal stub so rendering never throws
 */
export function adaptResumeData(
  generated: Record<string, unknown>,
  fallbackName = '',
): Record<string, unknown> {
  // Prefer fully-structured JSON produced by V2 pipeline
  if (generated.resume_structured && typeof generated.resume_structured === 'object') {
    return generated.resume_structured as Record<string, unknown>
  }

  // V2 tailor output shape (top-level keys: summary, experience, education, skills)
  if (generated.summary || generated.experience) {
    return generated
  }

  // Best-effort parse of plain resume_text string
  const text = typeof generated.resume_text === 'string' ? generated.resume_text : ''
  if (!text) return { name: fallbackName, summary: '', experience: [], education: [], skills: [] }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const sectionKeywords = ['summary', 'experience', 'education', 'skills', 'projects']

  let currentSection = ''
  const sections: Record<string, string[]> = {}

  for (const line of lines) {
    const lower = line.toLowerCase()
    const matched = sectionKeywords.find((k) => lower === k || lower.startsWith(k + ':'))
    if (matched) {
      currentSection = matched
      sections[currentSection] = sections[currentSection] ?? []
    } else if (currentSection) {
      sections[currentSection]!.push(line)
    }
  }

  return {
    name: fallbackName || (lines[0] ?? ''),
    summary: (sections['summary'] ?? []).join(' '),
    experience: (sections['experience'] ?? []).map((b) => ({
      title: b,
      company: '',
      years: '',
      bullets: [],
    })),
    education: (sections['education'] ?? []).map((e) => ({ degree: e, school: '', year: '' })),
    skills: sections['skills'] ?? [],
  }
}
