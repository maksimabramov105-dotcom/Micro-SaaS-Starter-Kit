import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { isPdfTemplatesV1 } from '@/lib/flags'
import { TemplatePicker } from '@/components/resume/TemplatePicker'
import type { TemplateId } from '@/components/resume/TemplatePicker'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ResumeDetailPage({ params }: PageProps) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user) return null

  const resume = await prisma.resume.findFirst({
    where: { id, userId: session.user.id },
  })

  if (!resume) notFound()

  // generated is a Json field — cast to a loose object for rendering
  const generated = resume.generated as Record<string, unknown>
  const showTemplatePicker = await isPdfTemplatesV1(session.user.id)
  const templateId = ((resume as Record<string, unknown>).templateId as TemplateId | undefined)
    ?? 'modern_minimalist'

  return (
    <div className="container mx-auto max-w-4xl py-10 px-4">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{resume.title}</h1>
          {resume.targetRole && (
            <p className="text-slate-500">{resume.targetRole}</p>
          )}
        </div>
        <div className="flex gap-3">
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard">← Dashboard</Link>
          </Button>
          {!showTemplatePicker && (
            <Button asChild size="sm">
              <a href={`/api/resumes/${id}/pdf`} download>
                Download PDF
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Template picker — shown only when PDF_TEMPLATES_V1=true */}
      {showTemplatePicker && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Template</CardTitle>
          </CardHeader>
          <CardContent>
            <TemplatePicker resumeId={id} initialTemplateId={templateId} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Resume content</CardTitle>
        </CardHeader>
        <CardContent>
          <ResumeDisplay data={generated} />
        </CardContent>
      </Card>
    </div>
  )
}

function ResumeDisplay({ data }: { data: Record<string, unknown> }) {
  if (!data || Object.keys(data).length === 0) {
    return <p className="text-slate-400">Resume content not yet generated.</p>
  }

  // Error state — show message clearly
  if (typeof data.error === 'string') {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-semibold">Error</p>
        <p className="mt-1">{data.error}</p>
      </div>
    )
  }

  // Primary case: worker returned { resume_text: "..." }
  if (typeof data.resume_text === 'string') {
    return (
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">
        {data.resume_text}
      </pre>
    )
  }

  // Structured JSON from V2 pipeline — render section by section
  return (
    <div className="space-y-6 text-sm text-slate-700">
      {Object.entries(data).map(([section, value]) => (
        <section key={section}>
          <h3 className="mb-2 text-base font-semibold capitalize text-slate-900">
            {section.replace(/_/g, ' ')}
          </h3>
          <SectionValue value={value} />
        </section>
      ))}
    </div>
  )
}

function SectionValue({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    return <p className="whitespace-pre-wrap text-slate-600">{value}</p>
  }
  if (Array.isArray(value)) {
    return (
      <ul className="list-inside list-disc space-y-1 text-slate-600">
        {value.map((item, i) => (
          <li key={i}>
            {typeof item === 'object' && item !== null ? (
              <span>{JSON.stringify(item)}</span>
            ) : (
              String(item)
            )}
          </li>
        ))}
      </ul>
    )
  }
  if (typeof value === 'object' && value !== null) {
    return (
      <div className="space-y-1">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k}>
            <span className="font-medium capitalize">{k.replace(/_/g, ' ')}: </span>
            <span className="text-slate-600">{String(v)}</span>
          </div>
        ))}
      </div>
    )
  }
  return <span className="text-slate-600">{String(value)}</span>
}
