import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import EmailProvider from 'next-auth/providers/email'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { cookies } from 'next/headers'
import { prisma } from './prisma'
import { mintInboxHandle } from './auth/handle-mint'
import { captureReferral, REFERRAL_COOKIE } from './referral'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
    }),
    EmailProvider({
      server: {
        host: 'smtp.resend.com',
        port: 465,
        auth: {
          user: 'resend',
          pass: process.env.RESEND_API_KEY,
        },
      },
      from: process.env.RESEND_FROM ?? 'noreply@resumeai-bot.ru',
    }),
  ],
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: {
            stripeCustomerId: true,
            stripeSubscriptionId: true,
            stripePriceId: true,
            stripeCurrentPeriodEnd: true,
            firstPaidAt: true,
            refundedAt: true,
            role: true,
          },
        })
        if (dbUser) {
          session.user.stripeCustomerId = dbUser.stripeCustomerId
          session.user.stripeSubscriptionId = dbUser.stripeSubscriptionId
          session.user.stripePriceId = dbUser.stripePriceId
          session.user.stripeCurrentPeriodEnd = dbUser.stripeCurrentPeriodEnd
          session.user.firstPaidAt = dbUser.firstPaidAt
          session.user.refundedAt = dbUser.refundedAt
          session.user.role = dbUser.role
        }
      }
      return session
    },
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
  events: {
    /**
     * Fires exactly once per user — when their account is first created via
     * the Prisma adapter.  We mint the inbox forwarding handle here so it is
     * always set before the user reaches the dashboard.
     */
    async createUser({ user }) {
      if (user.id && user.email) {
        try {
          await mintInboxHandle(user.id, user.email)
        } catch (err) {
          // Non-fatal — user can still sign in; handle can be minted later
          console.error('[auth] failed to mint inboxHandle for', user.id, err)
        }

        // Capture referral: read the referral_code cookie set by /r/[code]
        // cookies() works here because createUser fires inside a Route Handler context
        try {
          const cookieStore = await cookies()
          const refCode = cookieStore.get(REFERRAL_COOKIE)?.value
          if (refCode) {
            await captureReferral(user.id, refCode)
          }
        } catch (err) {
          // Non-fatal — user is still created; referral can be captured manually
          console.error('[auth] referral capture failed for', user.id, err)
        }
      }
    },
  },
}
