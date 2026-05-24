import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 10% of transactions sampled — keeps Sentry free-tier quota comfortable.
  // Raise to 1.0 only during incident investigation.
  tracesSampleRate: 0.1,
  debug: false,
  replaysOnErrorSampleRate: 1.0,  // always capture replays on error
  replaysSessionSampleRate: 0.05, // 5% of sessions (down from 10%)
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
})
