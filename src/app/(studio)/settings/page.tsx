import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SystemSettings } from '@/components/studio/SystemSettings'
import { BUILT_IN_PRICING, DEFAULT_MODEL } from '@/lib/ai/anthropic'
import { can } from '@/lib/auth/rbac'
import { turnConfigured } from '@/lib/turn'
import { getSessionUser } from '@/lib/auth/session'
import { AI_JOB_KIND_LABEL, AI_JOB_KINDS } from '@/lib/constants'
import {
  DEFAULT_STORAGE_COST,
  getFxRates,
  getIceServers,
  getModelPricing,
  getStorageCost,
  getTaskProfiles,
} from '@/lib/settings'

export const metadata: Metadata = { title: '系統設定' }
/** Rates change under you; a cached render would show yesterday's numbers. */
export const dynamic = 'force-dynamic'

/**
 * 系統設定 (Z87).
 *
 * Everything here is a number that **changes outside this codebase** and that
 * something else is computed from: an exchange rate, Cloudflare's published
 * storage price, what Anthropic charges per million tokens. Hardcoded, each
 * one goes stale silently, and every total derived from it is wrong without
 * anything on screen looking wrong.
 *
 * So the test for belonging on this page is not 「可以設定很好」. It is
 * 「這個數字會變，而且變了之後算出來的東西就是錯的」. A constant that is a
 * decision rather than a fact — the 24px tap target floor, the 50-second SSE
 * lifetime — stays in the source where its reasoning is.
 */
export default async function SystemSettingsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const [fx, storage, pricing, profiles, ice] = await Promise.all([
    getFxRates(),
    getStorageCost(),
    getModelPricing(BUILT_IN_PRICING),
    getTaskProfiles({}),
    getIceServers(),
  ])

  return (
    <SystemSettings
      canEdit={can(user, 'system.settings')}
      fx={fx}
      storage={storage}
      storageDefault={DEFAULT_STORAGE_COST}
      pricing={pricing}
      builtInPricing={BUILT_IN_PRICING}
      profiles={profiles}
      defaultModel={DEFAULT_MODEL}
      ice={ice}
      /* 只傳布林——金鑰永遠不離開伺服器 (Z103)。 */
      relayConfigured={turnConfigured()}
      tasks={AI_JOB_KINDS.map((kind) => ({ kind, label: AI_JOB_KIND_LABEL[kind] }))}
    />
  )
}
