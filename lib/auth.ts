import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import EmailProvider from 'next-auth/providers/email'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { cookies } from 'next/headers'
import { prisma } from './prisma'
import { mintInboxHandle } from './auth/handle-mint'
import { captureReferral, REFERRAL_COOKIE } from './referral'
import { trackEvent } from './analytics-advanced'

/** Magic-link email body. Plain, single CTA, no tracking pixels. */
function signInEmailHtml(url: string, host: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color:#111;">Sign in to ResumeAI</h2>
      <p>Click the button below to sign in. This link works once and expires in 24 hours.</p>
      <p style="margin:28px 0;">
        <a href="${url}"
           style="background:#4f46e5;color:#fff;padding:12px 22px;border-radius:8px;
                  text-decoration:none;font-weight:600;display:inline-block;">
          Sign in to ResumeAI
        </a>
      </p>
      <p style="color:#666;font-size:13px;">
        If the button doesn't work, paste this into your browser:<br>
        <span style="word-break:break-all;">${url}</span>
      </p>
      <p style="color:#666;font-size:13px;">
        You're receiving this because someone entered your address at ${host}.
        If that wasn't you, you can safely ignore it — no account is created until
        the link is used.
      </p>
    </div>
  `
}

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
      // Magic links go out over Resend's HTTPS API, NOT SMTP.
      //
      // This used to be `server: { host: 'smtp.resend.com', port: 465 }`, which
      // silently broke email sign-in for the entire life of the deployment:
      // Hetzner blocks outbound 25 and 465 (verified from the host — only 587 is
      // open), so nodemailer hung until the request timed out. The
      // VerificationToken row was still written, so it looked half-working, but
      // Resend had never delivered a single sign-in email.
      //
      // Using the same sendEmail() path as every other email in the app means one
      // transport (443, always open), one place to debug, and magic links show up
      // in the Resend dashboard like everything else. `server` is still required
      // by the provider's types, so it stays as an unused placeholder.
      server: { host: 'api.resend.com', port: 443 },
      from: process.env.RESEND_FROM ?? 'noreply@resumeai-bot.com',
      async sendVerificationRequest({ identifier, url }) {
        // Imported lazily on purpose: lib/email.ts pulls in the Resend SDK (and
        // through it react-dom/server). At module scope that would load on every
        // request that touches auth — and it broke the auth test suite outright
        // ("TextEncoder is not defined"). This path runs only when someone
        // actually requests a magic link.
        const { sendEmail } = await import('./email')
        const { host } = new URL(url)
        const result = await sendEmail({
          to: identifier,
          subject: `Sign in to ${host}`,
          html: signInEmailHtml(url, host),
        })
        // Throwing here makes next-auth surface the failure instead of
        // pretending a link was sent (the old failure mode).
        if (!result.success) throw new Error('Failed to send the sign-in email')
      },
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

        // Acquisition-funnel telemetry (lib/pmf/user-funnel.ts step 2)
        try {
          await trackEvent({ event: 'signup', userId: user.id })
        } catch (err) {
          console.error('[auth] signup event failed for', user.id, err)
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
