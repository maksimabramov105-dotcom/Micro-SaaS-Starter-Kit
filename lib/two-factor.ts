import speakeasy from 'speakeasy'
import QRCode from 'qrcode'
import { prisma } from './prisma'

export async function generate2FASecret(userId: string, email: string) {
  const secret = speakeasy.generateSecret({
    name: `${process.env.NEXT_PUBLIC_APP_NAME} (${email})`,
    issuer: process.env.NEXT_PUBLIC_APP_NAME,
  })

  // Store secret temporarily (will be saved permanently after verification)
  return {
    secret: secret.base32,
    qrCodeUrl: await QRCode.toDataURL(secret.otpauth_url!),
  }
}

export async function verify2FAToken(secret: string, token: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 2, // Allow 2 time steps before/after
  })
}

export async function enable2FA(userId: string, secret: string, token: string) {
  const isValid = await verify2FAToken(secret, token)

  if (!isValid) {
    throw new Error('Invalid 2FA token')
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: true,
      twoFactorSecret: secret,
    },
  })

  return true
}

export async function disable2FA(userId: string, token: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  })

  if (!user?.twoFactorSecret) {
    throw new Error('2FA not enabled')
  }

  const isValid = await verify2FAToken(user.twoFactorSecret, token)

  if (!isValid) {
    throw new Error('Invalid 2FA token')
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null,
    },
  })

  return true
}

export async function generateBackupCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: 10 }, () =>
    Math.random().toString(36).substring(2, 10).toUpperCase()
  )

  // Store hashed backup codes
  const bcrypt = require('bcrypt')
  const hashedCodes = await Promise.all(
    codes.map((code) => bcrypt.hash(code, 10))
  )

  await prisma.user.update({
    where: { id: userId },
    data: {
      preferences: {
        backupCodes: hashedCodes,
      },
    },
  })

  return codes
}
