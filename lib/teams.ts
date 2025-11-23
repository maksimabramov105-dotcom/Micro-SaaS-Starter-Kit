import { prisma } from './prisma'
import slugify from 'slugify'
import { nanoid } from 'nanoid'

export async function createTeam(userId: string, name: string) {
  const baseSlug = slugify(name, { lower: true, strict: true })
  const slug = `${baseSlug}-${nanoid(6)}`

  const team = await prisma.team.create({
    data: {
      name,
      slug,
      ownerId: userId,
      members: {
        create: {
          userId,
          role: 'owner',
          permissions: ['read', 'write', 'admin'],
        },
      },
    },
    include: {
      members: true,
    },
  })

  return team
}

export async function inviteTeamMember(
  teamId: string,
  email: string,
  role: string = 'member'
) {
  const token = nanoid(32)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7) // 7 days

  const invite = await prisma.teamInvite.create({
    data: {
      teamId,
      email,
      role,
      token,
      expiresAt,
    },
  })

  return { invite, inviteUrl: `${process.env.NEXT_PUBLIC_APP_URL}/teams/invite/${token}` }
}

export async function acceptTeamInvite(token: string, userId: string) {
  const invite = await prisma.teamInvite.findUnique({
    where: { token },
  })

  if (!invite || invite.expiresAt < new Date()) {
    throw new Error('Invalid or expired invite')
  }

  const member = await prisma.teamMember.create({
    data: {
      teamId: invite.teamId,
      userId,
      role: invite.role,
    },
  })

  await prisma.teamInvite.delete({
    where: { token },
  })

  return member
}

export async function getUserTeams(userId: string) {
  return prisma.team.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
      ],
    },
    include: {
      owner: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      },
      _count: {
        select: {
          members: true,
        },
      },
    },
  })
}

export async function checkTeamPermission(
  userId: string,
  teamId: string,
  permission: string
): Promise<boolean> {
  const member = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
  })

  if (!member) return false
  return member.permissions.includes(permission) || member.role === 'owner'
}
