'use client'

/**
 * RescueForm — the /resume-rescue purchase form (A2).
 * Collects the job target + resume, then redirects to Stripe Checkout.
 * Fires `tripwire_view` once on mount and `checkout_started` server-side.
 */
import { useEffect, useRef, useState } from 'react'

const MAX_PDF_BYTES = 5 * 1024 * 1024

export function RescueForm() {
  const [email, setEmail] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [jobCompany, setJobCompany] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [resumeText, setResumeText] = useState('')
  const [pdf, setPdf] = useState<{ base64: string; name: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const viewFired = useRef(false)

  useEffect(() => {
    if (viewFired.current) return
    viewFired.current = true
    fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'tripwire_view', page: '/resume-rescue' }),
    }).catch(() => {})
  }, [])

  async function onPdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) {
      setPdf(null)
      return
    }
    if (file.size > MAX_PDF_BYTES) {
      setError('PDF is larger than 5 MB — please paste your resume text instead.')
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!resumeText.trim() && !pdf) {
      setError('Add your resume — paste the text or upload a PDF.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/rescue/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          jobTitle,
          jobCompany,
          jobUrl,
          jobDescription,
          resumeText: resumeText.trim(),
          ...(pdf ? { resumePdfBase64: pdf.base64, resumeFilename: pdf.name } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Something went wrong — please try again.')
        setSubmitting(false)
        return
      }
      window.location.href = data.url
    } catch {
      setError('Network error — please try again.')
      setSubmitting(false)
    }
  }

  const inputClass =
    'w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary'

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-6">
      <div>
        <label htmlFor="rescue-email" className="mb-1 block text-sm font-medium">
          Your email (results go here)
        </label>
        <input
          id="rescue-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="you@example.com"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rescue-title" className="mb-1 block text-sm font-medium">
            Job title <span className="text-red-500">*</span>
          </label>
          <input
            id="rescue-title"
            required
            minLength={3}
            maxLength={200}
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            className={inputClass}
            placeholder="Senior Support Engineer"
          />
        </div>
        <div>
          <label htmlFor="rescue-company" className="mb-1 block text-sm font-medium">
            Company
          </label>
          <input
            id="rescue-company"
            maxLength={200}
            value={jobCompany}
            onChange={(e) => setJobCompany(e.target.value)}
            className={inputClass}
            placeholder="Acme Inc"
          />
        </div>
      </div>

      <div>
        <label htmlFor="rescue-desc" className="mb-1 block text-sm font-medium">
          Job description{' '}
          <span className="text-muted-foreground">(paste it — the more, the better the rescue)</span>
        </label>
        <textarea
          id="rescue-desc"
          rows={6}
          maxLength={12000}
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          className={inputClass}
          placeholder="Paste the full job description here..."
        />
      </div>

      <div>
        <label htmlFor="rescue-url" className="mb-1 block text-sm font-medium">
          Job posting URL <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="rescue-url"
          type="url"
          maxLength={500}
          value={jobUrl}
          onChange={(e) => setJobUrl(e.target.value)}
          className={inputClass}
          placeholder="https://..."
        />
      </div>

      <div>
        <label htmlFor="rescue-resume" className="mb-1 block text-sm font-medium">
          Your current resume <span className="text-red-500">*</span>
        </label>
        <textarea
          id="rescue-resume"
          rows={8}
          maxLength={20000}
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
          className={inputClass}
          placeholder="Paste your resume text here..."
        />
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <span>or upload PDF:</span>
          <input type="file" accept="application/pdf" onChange={onPdfChange} className="text-sm" />
          {pdf && <span className="text-green-600">✓ {pdf.name}</span>}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? 'Preparing checkout…' : 'Rescue my resume — $4.99'}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        One-time payment. Delivered in ~5 minutes. Auto-refund if we fail.
      </p>
    </form>
  )
}
