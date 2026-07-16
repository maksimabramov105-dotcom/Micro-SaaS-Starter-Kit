/**
 * instrumentation.ts — Next.js server error hook (P0.4 error alerting).
 *
 * onRequestError fires for every unhandled server-side error (RSC, route
 * handlers, middleware). We relay a compact summary to the founder's
 * Telegram via lib/alerts.ts, deduped per error+path per hour so an error
 * loop can't flood the chat.
 *
 * Edge runtime has no Redis access — alerts only run in the nodejs runtime.
 */
import type { Instrumentation } from 'next'

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { sendAdminAlert } = await import('@/lib/alerts')
    const message = err instanceof Error ? err.message : String(err)
    const digest =
      err && typeof err === 'object' && 'digest' in err ? String((err as { digest?: string }).digest) : ''
    const text = [
      `web ${context.routerKind} error`,
      `${request.method} ${request.path}`,
      message.slice(0, 400),
      digest && `digest: ${digest}`,
    ]
      .filter(Boolean)
      .join('\n')
    await sendAdminAlert(text, `web:${request.path}:${message.slice(0, 80)}`)
  } catch {
    // alerting must never throw into the framework
  }
}
