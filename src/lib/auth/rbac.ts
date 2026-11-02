import type { RoleValue } from '@/lib/constants'
import type { SessionUser } from './session'

/**
 * Both real members are OWNER today, so in practice every permission below is
 * granted. The table exists so adding a narrower account later is a data change
 * rather than a refactor — and so the dangerous operations have a named
 * permission to check rather than an inline role comparison.
 */
export const PERMISSIONS = [
  // Production content — read and write for everyone.
  'project.read',
  'project.write',
  'episode.write',
  'document.write',
  'character.write',
  'world.write',
  'shot.write',
  'asset.upload',
  'asset.write',
  'task.write',
  'expense.write',
  'ai.run',
  // Restricted to OWNER.
  'project.delete',
  'asset.delete',
  'member.manage',
  'ai.provider.manage',
  'system.settings',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const OWNER_ONLY: ReadonlySet<Permission> = new Set([
  'project.delete',
  'asset.delete',
  'member.manage',
  'ai.provider.manage',
  'system.settings',
])

export function roleCan(role: RoleValue, permission: Permission): boolean {
  if (role === 'OWNER') return true
  return !OWNER_ONLY.has(permission)
}

export function can(user: Pick<SessionUser, 'role'> | null, permission: Permission): boolean {
  if (!user) return false
  return roleCan(user.role, permission)
}

/**
 * Operations that cannot be undone. The UI makes the user retype the record's
 * name before these run, which is the real guard now that both members are
 * OWNER and the role check alone stops nothing.
 */
export const DESTRUCTIVE_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'project.delete',
  'asset.delete',
])

export function isDestructive(permission: Permission): boolean {
  return DESTRUCTIVE_PERMISSIONS.has(permission)
}
