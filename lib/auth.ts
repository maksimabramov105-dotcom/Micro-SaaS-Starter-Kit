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
      // Allow sign-in even when this Google account isn't the one that was
      // originally used to create the DB user — e.g. user signed up via GitHub,
      // then tries Google with the same email.  Without this flag NextAuth throws
      // OAuthAccountNotLinked and the user can never sign in.
      allowDangerousEmailAccountLinking: true,
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
      // Same as above — permit GitHub sign-in to link to an existing email.
      allowDangerousEmailAccountLinking: true,
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
        // Always set the user ID from the JWT — this must never fail.
        session.user.id = token.sub

        // Augment the session with Stripe / role fields from the DB.
        // Wrapped in try/catch so a DB hiccup never invalidates the session
        // and sends the user back to the login page.
        try {
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
        } catch (err) {
          // Non-fatal: the JWT is still valid; user is authenticated.
          // Dashboard loads without Stripe metadata rather than redirect-looping.
          console.error('[auth:session] DB lookup failed, continuing with JWT claims', err)
        }
      }
      return session
    },

    // Guarantee that post-sign-in redirects always land somewhere safe.
    // Default NextAuth behaviour already allows same-origin URLs; we add an
    // explicit fallback to /dashboard so /login never becomes the destination.
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`
      if (url.startsWith(baseUrl)) return url
      return `${baseUrl}/dashboard`
    },
  },
  session: {
    strategy: 'jwt',
  },
  // Behind the Caddy TLS proxy the app receives HTTP internally but is served
  // over HTTPS. Derive secure cookies from the PUBLIC scheme (NEXTAUTH_URL), not
  // NODE_ENV — so prod (https) gets Secure + __Host-/__Secure- cookies (fixing
  // first-attempt OAuth flakes), while an http origin (local/CI `next start`,
  // which still runs NODE_ENV=production) uses non-secure cookies that actually
  // work over http. This matches getToken's own cookie-name detection.
  useSecureCookies: (process.env.NEXTAUTH_URL ?? '').startsWith('https://'),
  // Surface NextAuth failures into the container logs with their error code so
  // an intermittent sign-in failure is actually diagnosable when it recurs
  // (previously these were swallowed — zero auth errors were ever captured).
  logger: {
    error(code, metadata) {
      console.error('[next-auth][error]', code, JSON.stringify(metadata))
    },
    warn(code) {
      console.warn('[next-auth][warn]', code)
    },
    debug() {},
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
