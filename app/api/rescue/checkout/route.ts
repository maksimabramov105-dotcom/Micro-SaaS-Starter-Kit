/**
 * POST /api/rescue/checkout — start a Resume Rescue purchase (A2).
 *
 * Guest checkout: no auth required. Accepts the job target + resume (pasted
 * text or base64 PDF, which the worker extracts BEFORE payment so an
 * unreadable file never gets charged), stores a PENDING_PAYMENT order, and
 * returns a Stripe Checkout URL (mode=payment, $4.99 one-time).
 */
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { trackEvent } from '@/lib/analytics-advanced'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRedis } from '@/lib/redis'
import { stripe } from '@/lib/stripe'
import { callWorker, WorkerError } from '@/lib/worker-client'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'
const RATE_LIMIT_PER_HOUR = 10

// Linear-time email shape check (no regex — user-provided input, ReDoS-safe).
function isValidEmail(email: string): boolean {
  if (email.length < 5 || email.length > 254 || email.includes(' ')) return false
  const at = email.indexOf('@')
  if (at <= 0 || at !== email.lastIndexOf('@')) return false
  const domain = email.slice(at + 1)
  const dot = domain.lastIndexOf('.')
  return dot > 0 && dot < domain.length - 1
}

async function rateLimited(ip: string): Promise<boolean> {
  try {
    const key = `rl:rescue:${ip}`
    const count = await getRedis().incr(key)
    if (count === 1) await getRedis().expire(key, 3600)
    return count > RATE_LIMIT_PER_HOUR
  } catch {
    return false // Redis down must not block checkout
  }
}

export async function POST(req: Request) {
  try {
    const fwd = req.headers.get('x-forwarded-for')
    const ip = (fwd ? fwd.split(',')[0] : req.headers.get('x-real-ip') || 'unknown').trim()
    if (await rateLimited(ip)) {
      return NextResponse.json({ error: 'Too many attempts — try again later.' }, { status: 429 })
    }

    const body = await req.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const jobTitle = typeof body.jobTitle === 'string' ? body.jobTitle.trim() : ''
    const jobCompany = typeof body.jobCompany === 'string' ? body.jobCompany.trim().slice(0, 200) : ''
    const jobUrl = typeof body.jobUrl === 'string' ? body.jobUrl.trim().slice(0, 500) : ''
    const jobDescription =
      typeof body.jobDescription === 'string' ? body.jobDescription.trim().slice(0, 12000) : ''

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
    }
    if (jobTitle.length < 3 || jobTitle.length > 200) {
      return NextResponse.json({ error: 'Job title is required (3-200 chars).' }, { status: 400 })
    }

    // Resume: pasted text, or a PDF the worker extracts pre-payment
    let resumeText = typeof body.resumeText === 'string' ? body.resumeText.trim() : ''
    if (!resumeText && typeof body.resumePdfBase64 === 'string' && body.resumePdfBase64) {
      try {
        const extracted = await callWorker<{ text: string }>('/jobs/extract-resume', {
          pdf_base64: body.resumePdfBase64,
          filename: typeof body.resumeFilename === 'string' ? body.resumeFilename : 'resume.pdf',
        })
        resumeText = extracted.text
      } catch (err) {
        const detail =
          err instanceof WorkerError && err.status === 422
            ? 'We could not read that PDF — please paste your resume text instead.'
            : 'Resume upload failed — please paste your resume text instead.'
        return NextResponse.json({ error: detail }, { status: 422 })
      }
    }
    if (resumeText.length < 200) {
      return NextResponse.json(
        { error: 'Please provide your resume (at least a few paragraphs of text).' },
        { status: 400 },
      )
    }

    const priceId = process.env.STRIPE_PRICE_ID_RESCUE
    if (!priceId) {
      return NextResponse.json({ error: 'Resume Rescue is not available right now.' }, { status: 503 })
    }

    // Logged-in buyers get the order attached to their account immediately
    const session = await getServerSession(authOptions)

    const order = await prisma.rescueOrder.create({
      data: {
        email,
        userId: session?.user?.id ?? null,
        jobTitle: jobTitle.slice(0, 200),
        jobCompany: jobCompany || null,
        jobUrl: jobUrl || null,
        jobDescription: jobDescription || null,
        resumeText: resumeText.slice(0, 20000),
      },
    })

    const checkout = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      metadata: { rescueOrderId: order.id, kind: 'resume_rescue' },
      payment_intent_data: { metadata: { rescueOrderId: order.id } },
      success_url: `${APP_URL}/resume-rescue/result?order=${order.id}`,
      cancel_url: `${APP_URL}/resume-rescue?canceled=1`,
    })

    await prisma.rescueOrder.update({
      where: { id: order.id },
      data: { stripeSessionId: checkout.id },
    })

    await trackEvent({
      event: 'checkout_started',
      userId: session?.user?.id ?? undefined,
      properties: { kind: 'tripwire', orderId: order.id },
    }).catch(() => {})

    return NextResponse.json({ url: checkout.url, orderId: order.id })
  } catch (err) {
    console.error('[rescue/checkout] error:', err)
    return NextResponse.json({ error: 'Something went wrong — please try again.' }, { status: 500 })
  }
}
