import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(
  password: string,
  passwordHash: string,
): boolean {
  const [salt, hash] = passwordHash.split(':')
  if (!salt || !hash) {
    return false
  }

  const candidate = scryptSync(password, salt, KEY_LENGTH)
  const stored = Buffer.from(hash, 'hex')

  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  )
}
