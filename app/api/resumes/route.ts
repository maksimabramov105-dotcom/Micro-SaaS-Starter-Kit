import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { callWorker } from '@/lib/worker-client'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 })

  const resumes = await prisma.resume.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(resumes)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 })
  }

  type WorkHistoryItem = { company?: string; role?: string; startDate?: string; endDate?: string; bullets?: string[] }
  type EducationItem   = { school?: string; degree?: string; year?: string }

  const {
    fullName,
    email,
    phone,
    linkedin,
    targetRole,
    yearsExp,
    location,
    remote,
    workHistory,
    education,
    skills,
    tone,
  } = body as Record<string, unknown>

  if (!targetRole) return new NextResponse('targetRole is required', { status: 400 })

  // Serialize structured form arrays into readable plain text for the AI.
  const workHistoryText = Array.isArray(workHistory)
    ? (workHistory as WorkHistoryItem[])
        .filter(j => j.company || j.role)
        .map(j => {
          const period = [j.startDate, j.endDate || 'Present'].filter(Boolean).join(' – ')
          const bullets = (j.bullets ?? []).filter(Boolean).map(b => `  • ${b}`).join('\n')
          return `${j.role ?? ''}${j.company ? ` at ${j.company}` : ''}${period ? ` (${period})` : ''}${bullets ? '\n' + bullets : ''}`
        })
        .join('\n\n')
    : String(workHistory ?? '')

  const educationText = Array.isArray(education)
    ? (education as EducationItem[])
        .filter(e => e.school || e.degree)
        .map(e => `${e.degree ?? ''}${e.school ? ` — ${e.school}` : ''}${e.year ? ` (${e.year})` : ''}`)
        .join('\n')
    : String(education ?? '')

  const skillsText = Array.isArray(skills)
    ? (skills as string[]).filter(Boolean).join(', ')
    : String(skills ?? '')

  // Build a plain-text user profile from form fields to send to the worker.
  // Contact info is passed first so the AI can include it in the resume header.
  const profileParts: string[] = []
  if (fullName)         profileParts.push(`Candidate name: ${fullName}`)
  if (email)            profileParts.push(`Email: ${email}`)
  if (phone)            profileParts.push(`Phone: ${phone}`)
  if (linkedin)         profileParts.push(`LinkedIn: ${linkedin}`)
  if (location)         profileParts.push(`Location: ${location}`)
  if (remote)           profileParts.push('Open to remote work.')
  if (yearsExp)         profileParts.push(`Years of experience: ${yearsExp}`)
  if (workHistoryText)  profileParts.push(`Work History:\n${workHistoryText}`)
  if (educationText)    profileParts.push(`Education:\n${educationText}`)
  if (skillsText)       profileParts.push(`Skills:\n${skillsText}`)
  if (tone)             profileParts.push(`Preferred tone: ${tone}`)
  const resumeInput = profileParts.join('\n\n') || String(targetRole)

  let generated: unknown = {}
  try {
    type WorkerJob = {
      status: string
      result?: { resume_text?: string }
      error?: string | null
    }
    const job = await callWorker<WorkerJob>('/jobs/resume/generate', {
      user_id: session.user.id,
      resume_input: resumeInput,
      job_title: String(targetRole),
      company: '',
      job_description: `Target role: ${targetRole}`,
    })
    // Unwrap the JobRecord envelope — store only the result payload
    if (job.status === 'done' && job.result) {
      generated = job.result          // { resume_text: "..." }
    } else {
      generated = { error: job.error ?? 'Generation failed — please try again.' }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Distinguish a real network/timeout failure from a validation error
    generated = {
      error: msg.includes('Worker responded 4')
        ? `Worker rejected request: ${msg}`
        : 'Worker unavailable — resume will be generated when the worker is back online.',
    }
  }

  const title = `${targetRole} — ${new Date().getFullYear()}`

  const resume = await prisma.resume.create({
    data: {
      userId: session.user.id,
      title,
      targetRole: String(targetRole),
      input: body as object,
      generated: generated as object,
      language: 'en',
    },
  })

  return NextResponse.json(resume, { status: 201 })
}
