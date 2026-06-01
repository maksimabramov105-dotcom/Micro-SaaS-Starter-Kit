'use client'

import { useState } from 'react'

export function LeadForm({ source }: { source: string }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setError(null)
    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Something went wrong. Please try again.')
      }
      setStatus('done')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  if (status === 'done') {
    return (
      <p style={{ padding: '14px 16px', background: '#ecfdf5', borderRadius: 10, color: '#065f46' }}>
        ✅ Thanks! Check your inbox — we&apos;ll send your free resume teardown shortly.
      </p>
    )
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        aria-label="Email address"
        style={{
          flex: '1 1 240px',
          padding: '12px 14px',
          border: '1px solid #cbd5e1',
          borderRadius: 10,
          fontSize: 16,
        }}
      />
      <button
        type="submit"
        disabled={status === 'loading'}
        style={{
          padding: '12px 22px',
          background: '#059669',
          color: '#fff',
          fontWeight: 600,
          border: 'none',
          borderRadius: 10,
          fontSize: 16,
          cursor: 'pointer',
        }}
      >
        {status === 'loading' ? 'Sending…' : 'Get my free teardown'}
      </button>
      {error && <p style={{ flexBasis: '100%', margin: 0, color: '#b91c1c', fontSize: 14 }}>{error}</p>}
    </form>
  )
}
