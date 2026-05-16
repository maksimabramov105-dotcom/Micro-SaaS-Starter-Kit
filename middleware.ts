import { withAuth } from 'next-auth/middleware'

/**
 * Protect all /dashboard routes — redirect unauthenticated users to /login.
 * This explicit config overrides any stale build-cache artifact that may have
 * used the old default (signIn: "/auth/signin") which no longer exists.
 */
export default withAuth({
  pages: {
    signIn: '/login',
  },
})

export const config = {
  matcher: ['/dashboard/:path*'],
}
