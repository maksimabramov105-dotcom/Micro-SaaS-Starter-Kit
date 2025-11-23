import { NextResponse } from 'next/server'
import { getServerSession } from 'next/auth'
import { authOptions } from '@/lib/auth'
import { createTeam, getUserTeams } from '@/lib/teams'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const teams = await getUserTeams(session.user.id)

    return NextResponse.json({ teams })
  } catch (error: any) {
    console.error('Error fetching teams:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const { name } = await req.json()

    if (!name) {
      return new NextResponse('Team name is required', { status: 400 })
    }

    const team = await createTeam(session.user.id, name)

    return NextResponse.json({ team })
  } catch (error: any) {
    console.error('Error creating team:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
