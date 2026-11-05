import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AiTaskLauncher } from '@/components/studio/AiTaskLauncher'
import { WorldBrowser } from '@/components/studio/WorldBrowser'
import { novelSources } from '@/lib/ai/jobs'
import { aiProviderStatus } from '@/lib/ai/provider-status'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { getFxRates } from '@/lib/settings'
import { getWorld } from '@/lib/world'

export const metadata: Metadata = { title: '世界觀設定' }

type Params = { params: Promise<{ projectId: string }> }

/**
 * 09 世界觀設定.
 *
 * spec v3 §09 covers 王朝、地圖、商路、制度、穿越規則、伏筆 — and says plainly
 * not to change story canon from the reference art. Nothing here is seeded:
 * 《一灶見山河》's dynasty name and the 120-episode canon are still undecided,
 * so the page opens empty and says why.
 */
export default async function WorldPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  /*
   * 世界觀生成與一致性檢查 (Z153).
   *
   * 兩種任務的 prompt、定價、佇列早就都在，就是沒有地方按得到。它們都屬於
   * 這一頁——生成的是設定條目，檢查的是「正文有沒有跟設定打架」。
   *
   * 一致性檢查讀的是某一集的小說，由伺服器讀（Z113）；這裡只要問出「哪幾集
   * 有正文」。一集都沒有的時候按鈕禁用並說原因，不是給一顆按下去才發現沒東
   * 西可讀的鈕。
   */
  const [world, fx, provider, sources] = await Promise.all([
    getWorld(project.id),
    getFxRates(),
    aiProviderStatus('WORLD_GENERATE'),
    novelSources(project.id),
  ])

  return (
    <WorldBrowser
      projectId={project.id}
      ai={
        <>
          <AiTaskLauncher
            label="AI 擴寫設定"
            title="AI 生成世界觀設定"
            description="依分類擴寫設定條目，內容需與既有正史相容。產出不會自動寫進設定，確認後自行建立條目。"
            projectId={project.id}
            scopeLabel={`已有 ${world.canonEntries} 條正史會一併送進去當作條件`}
            currency={user.displayCurrency}
            fx={fx}
            providerReady={provider.available}
            {...(provider.detail ? { providerDetail: provider.detail } : {})}
            tasks={[
              {
                kind: 'WORLD_GENERATE',
                label: '世界觀生成',
                hint: '依分類擴寫條目，並標示與哪些既有條目相關。在補充指示裡寫要擴寫什麼。',
              },
            ]}
          />

          <AiTaskLauncher
            label="AI 查矛盾"
            title="AI 世界觀一致性檢查"
            description="檢查某一集的正文有沒有跟既有設定打架。只報告位置與引文，不改設定也不改正文。"
            projectId={project.id}
            novelSources={sources}
            currency={user.displayCurrency}
            fx={fx}
            providerReady={provider.available}
            {...(provider.detail ? { providerDetail: provider.detail } : {})}
            {...(world.canonEntries === 0
              ? { disabledReason: '還沒有任何一條正史設定，沒有東西可以對照。' }
              : sources.length === 0
                ? { disabledReason: '還沒有任何一集寫了正文，沒有東西可以檢查。' }
                : {})}
            tasks={[
              {
                kind: 'WORLD_CONSISTENCY',
                label: '世界觀一致性檢查',
                hint: '逐條輸出衝突位置、引文、衝突的設定條目與可信度。',
              },
            ]}
          />
        </>
      }
      entries={world.entries.map((entry) => ({
        ...entry,
        updatedAt: entry.updatedAt.toISOString(),
      }))}
      events={world.events.map((event) => ({
        id: event.id,
        scope: event.scope,
        title: event.title,
        description: event.description,
        eraLabel: event.eraLabel,
        inUniverseOrder: event.inUniverseOrder,
        revealedInEpisode: event.revealedInEpisode,
        isCanon: event.isCanon,
      }))}
      countsByCategory={world.countsByCategory}
      totalEntries={world.totalEntries}
      canonEntries={world.canonEntries}
    />
  )
}
