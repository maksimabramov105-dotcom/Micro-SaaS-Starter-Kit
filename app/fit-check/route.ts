/**
 * /fit-check → /ats-check permanent alias (Session C naming; the original
 * URL keeps its SEO equity, both names work in copy and emails).
 */
import { NextResponse } from 'next/server'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

export function GET() {
  return NextResponse.redirect(`${APP_URL}/ats-check`, 308)
}
