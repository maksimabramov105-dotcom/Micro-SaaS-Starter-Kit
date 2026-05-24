// Force dynamic so cookies() is available inside NextAuth event callbacks
// (e.g. createUser reads the referral_code cookie from the OAuth callback request).
export const dynamic = 'force-dynamic'

import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
