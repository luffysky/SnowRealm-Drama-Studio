import type { Metadata } from 'next'
import { LiveData } from '@/components/studio/LiveData'
import { notFound, redirect } from 'next/navigation'
import { AiTaskLauncher } from '@/components/studio/AiTaskLauncher'
import { ProjectOverview } from '@/components/studio/ProjectOverview'
import { fetchProjectBriefDigest } from '@/lib/ai/digest-server'
import { aiProviderStatus } from '@/lib/ai/provider-status'
import { getSessionUser } from '@/lib/auth/session'
import { getProjectOverview } from '@/lib/project-overview'
import { getFxRates } from '@/lib/settings'

type Params = { params: Promise<{ projectId: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const user = await getSessionUser()
  if (!user) return { title: '作品總覽' }

  const { projectId } = await params
  const project = await getProjectOverview(projectId, user.id)
  return { title: project ? `${project.title}｜作品總覽` : '作品總覽' }
}

/**
 * 作品總覽 (design 04).
 *
 * Everything the page shows is derived on read, so there is nothing to cache
 * and no revalidation window to get wrong: the session makes it dynamic
 * anyway.
 */
export default async function ProjectOverviewPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const [project, fx, provider, brief] = await Promise.all([
    getProjectOverview(projectId, user.id),
    getFxRates(),
    aiProviderStatus('PROJECT_PLAN'),
    fetchProjectBriefDigest(projectId),
  ])
  if (!project) notFound()

  return (
    <>
      {/* 數字自己跟上，不用手動重新整理 (Z117)。 */}
      <LiveData />
      <ProjectOverview
        project={project}
        currency={user.displayCurrency}
        fx={fx}
        /*
         * 作品企劃生成 (Z153).
         *
         * 產出不會自動寫進任何欄位——企劃是一份要讀、要討論的東西，不是一個
         * 可以覆蓋的欄位。面板在採用時會照實說「還沒有自動寫回」，不會謊稱
         * 寫進去了。
         */
        ai={
          <AiTaskLauncher
            label="AI 寫企劃"
            title="AI 生成作品企劃"
            description="核心賣點、目標觀眾、風格定位、分部規劃與每集長度建議。產出不會自動寫進設定。"
            projectId={project.id}
            sourceText={brief}
            scopeLabel="作品現況、世界觀與角色設定會一併送進去"
            currency={user.displayCurrency}
            fx={fx}
            providerReady={provider.available}
            {...(provider.detail ? { providerDetail: provider.detail } : {})}
            tasks={[
              {
                kind: 'PROJECT_PLAN',
                label: '作品企劃生成',
                hint: '依題材與受眾提出企劃；在補充指示裡寫平台、受眾與想走的路線。',
              },
            ]}
          />
        }
      />
    </>
  )
}
