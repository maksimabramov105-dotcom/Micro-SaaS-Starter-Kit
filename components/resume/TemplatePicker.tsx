'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export const TEMPLATES = [
  {
    id: 'modern_minimalist',
    name: 'Modern Minimalist',
    description: 'Clean Calibri typeface, thin accent rule. Default for most roles.',
  },
  {
    id: 'classic_executive',
    name: 'Classic Executive',
    description: 'Centered Garamond heading, double rule dividers. Finance, law, consulting.',
  },
  {
    id: 'tech_compact',
    name: 'Tech Compact',
    description: 'Helvetica 10pt, dense layout, skills up top. Ideal for engineers.',
  },
  {
    id: 'creative_accent',
    name: 'Creative Accent',
    description: 'Blue left-bar accent, still single-column ATS-safe. Marketing & design.',
  },
  {
    id: 'new_grad',
    name: 'New Grad',
    description: 'Education and Projects first, smaller Experience. Students & interns.',
  },
] as const

export type TemplateId = (typeof TEMPLATES)[number]['id']

interface TemplatePickerProps {
  resumeId: string
  initialTemplateId: TemplateId | string
}

export function TemplatePicker({ resumeId, initialTemplateId }: TemplatePickerProps) {
  const [selected, setSelected] = useState<string>(
    initialTemplateId || 'modern_minimalist',
  )
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Selecting a template applies it immediately: it persists to the DB AND the
  // Download button (below) carries ?template=<id>, so the downloaded PDF always
  // matches what is selected — no separate "Save" click required.
  function selectTemplate(id: string) {
    if (id === selected) return
    setSelected(id)
    setSaved(false)
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/resumes/${resumeId}/template`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId: id }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.error ?? `HTTP ${res.status}`)
        }
        setSaved(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save template')
      }
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Choose a template. All templates are single-column and ATS-parseable.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onClick={() => selectTemplate(tpl.id)}
            className={cn(
              'group flex flex-col items-center rounded-lg border-2 p-2 text-left transition-all',
              selected === tpl.id
                ? 'border-primary bg-primary/5 ring-2 ring-primary ring-offset-1'
                : 'border-slate-200 hover:border-slate-400',
            )}
          >
            <div className="relative mb-2 h-[130px] w-full overflow-hidden rounded border border-slate-100 bg-white">
              <Image
                src={`/template-thumbnails/${tpl.id}.svg`}
                alt={tpl.name}
                fill
                style={{ objectFit: 'contain' }}
                unoptimized
              />
            </div>
            <span className="block text-center text-xs font-semibold leading-tight text-slate-800">
              {tpl.name}
            </span>
            <span className="mt-1 hidden text-center text-[10px] leading-tight text-slate-500 group-hover:block">
              {tpl.description}
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button asChild size="sm">
          <a href={`/api/resumes/${resumeId}/pdf?template=${selected}`} download>
            Download PDF
          </a>
        </Button>

        <span className="text-sm text-slate-600">
          {isPending
            ? 'Saving…'
            : (
              <>
                Selected: <strong>{TEMPLATES.find((t) => t.id === selected)?.name}</strong>
                {saved && ' ✓'}
              </>
            )}
        </span>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  )
}
