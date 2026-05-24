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
 *   2. Parse `generated.resume_text` with a robust line-splitter that handles
 *      both old (mixed-case) and new (ALL-CAPS) section heading formats
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

  // Section heading map — handles both formats produced by the AI:
  //   • New format: "PROFESSIONAL SUMMARY", "WORK EXPERIENCE", "KEY SKILLS"
  //   • Old format: "Summary", "Experience", "Skills", "Education"
  const SECTION_MAP: Record<string, string> = {
    'summary': 'summary',
    'professional summary': 'summary',
    'experience': 'experience',
    'work experience': 'experience',
    'professional experience': 'experience',
    'skills': 'skills',
    'key skills': 'skills',
    'core competencies': 'skills',
    'technical skills': 'skills',
    'education': 'education',
    'projects': 'projects',
    'additional information': 'additional',
    'certifications': 'certifications',
  }

  let currentSection = ''
  const sections: Record<string, string[]> = {}
  const contactLines: string[] = []

  for (const line of lines) {
    const lower = line.toLowerCase().trim()
    const sectionName = SECTION_MAP[lower]
    if (sectionName) {
      currentSection = sectionName
      sections[currentSection] = sections[currentSection] ?? []
    } else if (!currentSection) {
      // Lines before the first section heading = contact block
      contactLines.push(line)
    } else {
      sections[currentSection]!.push(line)
    }
  }

  // ── Extract contact info from the pre-section header block ───────────────
  const name = contactLines[0] ?? fallbackName
  let email = '', phone = '', location = '', linkedin = ''
  for (const line of contactLines.slice(1)) {
    if (/^email:/i.test(line)) {
      email = line.replace(/^email:\s*/i, '').trim()
    } else if (/^(?:phone|tel):/i.test(line)) {
      phone = line.replace(/^(?:phone|tel):\s*/i, '').trim()
    } else if (/^location:/i.test(line)) {
      location = line.replace(/^location:\s*/i, '').trim()
    } else if (/^linkedin:/i.test(line) || line.toLowerCase().includes('linkedin.com')) {
      linkedin = line.replace(/^linkedin:\s*/i, '').trim()
    } else if (line.includes('@') && !email) {
      email = line.trim()
    } else if (/^\+?[\d\s\-().]{7,}$/.test(line) && !phone) {
      phone = line.trim()
    }
  }

  // ── Parse skills — strip leading dash/bullet, split comma lists ──────────
  const skillLines = sections['skills'] ?? []
  const skills = skillLines
    .flatMap((l) => l.replace(/^[-•*·]\s*/, '').split(/,\s*/))
    .map((s) => s.trim())
    .filter((s) => s && !/^This resume/i.test(s) && !/^\[/i.test(s))

  // ── Parse experience into structured entries ──────────────────────────────
  const isBullet = (l: string) => /^[-•*·]/.test(l)
  const isDateRange = (l: string) =>
    (/\b\d{4}\b/.test(l) &&
      (/present|current/i.test(l) || (l.includes('–') || l.includes(' - ')) && /\d/.test(l))) ||
    /\d{2}[./]\d{2}[./]\d{4}/.test(l)

  const expLines = sections['experience'] ?? []
  const experience: Array<{ title: string; company: string; years: string; bullets: string[] }> = []
  let curExp: { title: string; company: string; years: string; bullets: string[] } | null = null

  for (const line of expLines) {
    if (isBullet(line)) {
      if (curExp) curExp.bullets.push(line.replace(/^[-•*·]\s*/, '').trim())
    } else if (isDateRange(line)) {
      if (curExp) curExp.years = line
    } else {
      // Non-bullet, non-date text: new title or company of current entry
      if (!curExp) {
        curExp = { title: line, company: '', years: '', bullets: [] }
      } else if (!curExp.company) {
        curExp.company = line
      } else {
        // Already have title + company → this is a new job entry
        experience.push(curExp)
        curExp = { title: line, company: '', years: '', bullets: [] }
      }
    }
  }
  if (curExp) experience.push(curExp)

  // ── Parse education into structured entries ───────────────────────────────
  const JUNK_LINE = /^This resume|^\[|^Note:|^References/i
  const eduLines = (sections['education'] ?? []).filter((l) => !JUNK_LINE.test(l) && !isBullet(l))
  const education: Array<{ degree: string; school: string; year: string }> = []
  let curEdu: { degree: string; school: string; year: string } | null = null

  for (const line of eduLines) {
    // "Degree — School (year)" or "Degree — School, year" on one line
    if (line.includes('—') || line.includes('–')) {
      const yearMatch = line.match(/[,(]\s*(\d{4})\s*[,)]?$/)
      const year = yearMatch?.[1] ?? ''
      const withoutYear = line.replace(/[,(]\s*\d{4}\s*[,)]?$/, '')
      const [deg, sch] = withoutYear.split(/\s*[—–]\s*/)
      if (curEdu) education.push(curEdu)
      curEdu = { degree: deg?.trim() ?? line, school: sch?.trim() ?? '', year }
    } else if (/^\d{4}$/.test(line)) {
      if (curEdu) curEdu.year = line
    } else if (!curEdu) {
      curEdu = { degree: line, school: '', year: '' }
    } else if (!curEdu.school) {
      curEdu.school = line
    } else {
      education.push(curEdu)
      curEdu = { degree: line, school: '', year: '' }
    }
  }
  if (curEdu) education.push(curEdu)

  return {
    name: name || fallbackName,
    email,
    phone,
    location,
    linkedin,
    summary: (sections['summary'] ?? [])
      .filter((l) => !JUNK_LINE.test(l))
      .join(' '),
    experience,
    education,
    skills,
  }
}
