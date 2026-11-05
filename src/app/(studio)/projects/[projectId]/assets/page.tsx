import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AssetCenterOverview } from '@/components/assets/AssetCenterOverview'
import { AiTaskLauncher } from '@/components/studio/AiTaskLauncher'
import { aiProviderStatus } from '@/lib/ai/provider-status'
import { getAssetCenter } from '@/lib/asset-center'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { getFxRates } from '@/lib/settings'

export const metadata: Metadata = { title: '素材資產中心' }

type Params = { params: Promise<{ projectId: string }> }

/**
 * 81 素材資產中心總覽 (Z4).
 *
 * Everything shown is counted on read. There is nothing cached and no
 * revalidation window to get wrong — the session makes the page dynamic
 * anyway, and a stale asset count is the kind of wrong number nobody notices
 * until it matters.
 */
export default async function AssetCenterPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const [data, fx, provider] = await Promise.all([
    getAssetCenter(project.id),
    getFxRates(),
    aiProviderStatus('ASSET_GENERATE'),
  ])

  return (
    <AssetCenterOverview
      projectId={project.id}
      data={data}
      currency={user.displayCurrency}
      fx={fx}
      /*
       * 素材提示詞生成 (Z153).
       *
       * 這個任務寫的是**提示詞**，不是圖：圖片 adapter 還沒有，所以文字模型
       * 能做的就是把「要什麼」寫成正負向提示詞。按鈕上的字照這件事實寫，別
       * 讓人以為按下去會跑出一張圖。
       */
      ai={
        <AiTaskLauncher
          label="AI 寫提示詞"
          title="AI 撰寫素材生成提示詞"
          description="把你要的素材寫成正向與負向提示詞，拿去生圖工具用。這裡不會生出圖片。"
          projectId={project.id}
          scopeLabel="世界觀與角色設定會一併送進去，提示詞才接得上這部作品的美術方向"
          currency={user.displayCurrency}
          fx={fx}
          providerReady={provider.available}
          {...(provider.detail ? { providerDetail: provider.detail } : {})}
          tasks={[
            {
              kind: 'ASSET_GENERATE',
              label: '素材生成提示詞',
              hint: '在補充指示裡寫要什麼素材（場景、服裝、道具），產出正負向提示詞。',
            },
          ]}
        />
      }
    />
  )
}
