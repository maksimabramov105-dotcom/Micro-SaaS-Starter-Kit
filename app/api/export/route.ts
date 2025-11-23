import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { exportUserData } from '@/lib/export'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const data = await exportUserData(session.user.id)

    // Return as downloadable JSON file
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="user-data-${session.user.id}-${Date.now()}.json"`,
      },
    })
  } catch (error: any) {
    console.error('Error exporting data:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
