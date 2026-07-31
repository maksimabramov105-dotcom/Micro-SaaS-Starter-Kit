/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },
  turbopack: {
    root: __dirname,
  },
  output: 'standalone',
  async redirects() {
    return [
      // The /companies/* namespace resolves to the canonical per-company
      // application guides (G1). We keep a single canonical URL space
      // (/apply-to/*) rather than duplicating ~150 pages of ATS content, so
      // these are permanent redirects, not a parallel section.
      { source: '/companies', destination: '/apply-to', permanent: true },
      { source: '/companies/:slug', destination: '/apply-to/:slug', permanent: true },
      // The competitor-comparison hub lives at /compare, but the pages it links
      // to are under /alternatives/*. Anyone truncating one of those URLs — a
      // habit search users genuinely have — hit a 404 on the way to the hub.
      { source: '/alternatives', destination: '/compare', permanent: true },
    ]
  },
}

// Only wire up the Sentry webpack plugin when we have real credentials.
// Without SENTRY_AUTH_TOKEN the plugin cannot upload source maps and in some
// @sentry/nextjs v9 versions it will hard-fail the build even with silent:true.
// Runtime error tracking (sentry.client/server.config.ts) is unaffected.
if (process.env.SENTRY_AUTH_TOKEN) {
  const { withSentryConfig } = require('@sentry/nextjs')
  module.exports = withSentryConfig(nextConfig, {
    silent: true,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    widenClientFileUpload: true,
    tunnelRoute: '/monitoring',
    hideSourceMaps: true,
    disableLogger: true,
  })
} else {
  module.exports = nextConfig
}
