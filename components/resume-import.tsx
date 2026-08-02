'use client'

/**
 * ResumeImport — step 0 of creating a resume (P4.1).
 *
 * WHY: the create-resume form is four steps of data entry — every job, every
 * bullet, every date. Someone who already has a resume was being asked to
 * retype it, and that is where new users quit. Time-to-first-value was bounded
 * by typing speed and patience, not by anything the product does.
 *
 * Upload the PDF or paste the text, and the form arrives prefilled. Everything
 * stays editable, and the next screen says plainly that it came from the import
 * and should be checked — an import the user cannot verify is worse than no
 * import, because they would be applying with fields they never read.
 *
 * A failed parse is not an error state. It drops straight into the empty form,
 * which is exactly the pre-P4.1 experience.
 */
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const MAX_PDF_BYTES = 5 * 1024 * 1024

export interface ParsedResume {
  fullName: string
  email: string
  phone: string
  linkedin: string
  targetRole: string
  yearsExp: number
  location: string
  workHistory: Array<{
    company: string
    role: string
    startDate: string
    endDate: string
    bullets: string[]
  }>
  education: Array<{ school: string; degree: string; year: string }>
  skills: string[]
}

export function ResumeImport({
  onImported,
  onSkip,
}: {
  onImported: (parsed: ParsedResume) => void
  onSkip: () => void
}) {
  const [text, setText] = useState('')
  const [pdf, setPdf] = useState<{ base64: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function onPdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) {
      setPdf(null)
      return
    }
    if (file.size > MAX_PDF_BYTES) {
      setError('That PDF is larger than 5 MB — paste the text instead.')
      e.target.value = ''
      return
    }
    const buf = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    setPdf({ base64: btoa(binary), name: file.name })
  }

  async function run() {
    setError(null)
    if (!text.trim() && !pdf) {
      setError('Upload a PDF or paste your resume text first.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/resumes/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          pdf ? { pdfBase64: pdf.base64, filename: pdf.name } : { text: text.trim() },
        ),
      })
      const data = (await res.json().catch(() => ({}))) as {
        parsed?: ParsedResume | null
        error?: string
      }
      if (!res.ok) {
        setError(data.error || 'Import failed — you can fill the form in instead.')
        setBusy(false)
        return
      }
      if (!data.parsed) {
        setError(
          'We could not read that as a resume. You can try pasting the text, or fill the form in directly.',
        )
        setBusy(false)
        return
      }
      onImported(data.parsed)
    } catch {
      setError('Import failed — you can fill the form in instead.')
      setBusy(false)
    }
  }

  if (busy) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
          <p className="text-lg font-medium text-slate-700">Reading your resume…</p>
          <p className="text-sm text-slate-400">Usually ~10 s. You&apos;ll get to check every field.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start from the resume you already have</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-slate-600">
          Upload it or paste it, and we&apos;ll fill in the next four steps for you. Nothing is
          rewritten — your wording is copied across exactly, and you get to check every field
          before anything is created.
        </p>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Upload a PDF
          </label>
          {/* Same non-shrinkable file input as components/rescue-form.tsx: it
              fits alone on a phone, and stops fitting the moment a filename is
              rendered beside it. Wrapping is what keeps that from overflowing. */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              onChange={onPdfChange}
              className="min-w-0 max-w-full text-sm"
            />
            {pdf && <span className="max-w-full break-all text-sm text-emerald-600">✓ {pdf.name}</span>}
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          or
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <div>
          <label htmlFor="resume-paste" className="mb-1.5 block text-sm font-medium text-slate-700">
            Paste your resume text
          </label>
          <textarea
            id="resume-paste"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={Boolean(pdf)}
            placeholder="Paste the whole thing — contact details, jobs, bullet points, education, skills."
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
          {pdf && (
            <p className="mt-1 text-xs text-slate-400">
              Using the uploaded PDF.{' '}
              <button
                type="button"
                onClick={() => {
                  setPdf(null)
                  if (fileInput.current) fileInput.current.value = ''
                }}
                className="text-emerald-600 underline"
              >
                Paste text instead
              </button>
            </p>
          )}
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="button" onClick={run}>
            Import and prefill
          </Button>
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-slate-500 underline hover:text-slate-700"
          >
            Start from scratch instead
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
