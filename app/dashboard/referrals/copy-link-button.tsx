'use client'

/**
 * Copy-to-clipboard button for the referral link.
 * Client Component because it uses browser navigator.clipboard API.
 */

import { useState } from 'react'

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select the input text
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url}
        className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm font-mono truncate"
        onFocus={(e) => e.target.select()}
      />
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}
