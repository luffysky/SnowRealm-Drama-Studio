import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { StoryboardWorkbench } from '@/components/studio/StoryboardWorkbench'
import { EmptyState } from '@/components/ui/StateViews'
import { aiProviderStatus } from '@/lib/ai/provider-status'
import { can } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { getFxRates } from '@/lib/settings'
import { storyboardFor, storyboardIndex } from '@/lib/storyboard'

export const metadata: Metadata = { title: '分鏡工作台' }

type Params = {
  params: Promise<{ projectId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** First value only: `?ep=a&ep=b` must not become "a,b". */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

/**
 * 12–13 分鏡工作台 (Z39/Z40/Z71).
 *
 * 路由是作品級的（spec v3 §11.1 的路由表只列 `/projects/[id]/storyboard`，
 * 12 跟 13 兩張設計都掛在它底下），所以集數與選取的鏡頭都放在 query string
 * ——不是放在元件的 state 裡。`docs/ROUTES.md` §4 要求深連結、重新整理、兩
 * 個分頁各看一集都要成立。
 *
 * 預設落在**第一集有鏡頭的**，而不是第 1 集：120 集裡只有兩集有分鏡的時候，
 * 每次打開都停在空白的 EP001 等於每次都要自己找。
 */
export default async function StoryboardPage({ params, searchParams }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const sp = await searchParams
  const index = await storyboardIndex(project.id)

  if (index.length === 0) {
    return (
      <div className="p-3 sm:p-4 lg:p-6">
        <EmptyState
          title="尚未建立集數"
          description="分鏡是以集為單位規劃的。先在「集數管理」建立集數，再回來分鏡。"
          className="py-20"
        />
      </div>
    )
  }

  const wanted = one(sp.ep)
  const episodeId =
    index.find((row) => row.id === wanted)?.id ??
    index.find((row) => row.shotCount > 0)?.id ??
    index[0]!.id

  const [view, fx, provider] = await Promise.all([
    storyboardFor(project.id, episodeId),
    getFxRates(),
    aiProviderStatus('STORYBOARD_GENERATE'),
  ])

  // `storyboardIndex` 剛剛才確認過這一集存在，所以這裡只可能是競態（有人在這
  // 兩次查詢之間刪了它）。當成沒有鏡頭處理，不要讓整頁 500。
  if (!view) redirect(`/projects/${project.id}/storyboard`)

  const shotParam = one(sp.shot)
  const selectedShotId = view.shots.some((shot) => shot.id === shotParam) ? shotParam : null

  return (
    <StoryboardWorkbench
      projectId={project.id}
      episodes={index.map((row) => ({
        id: row.id,
        number: row.number,
        title: row.title,
        shotCount: row.shotCount,
        totalSec: row.totalSec,
        targetSec: row.targetSec,
      }))}
      episode={view.episode}
      shots={view.shots.map((shot) => ({
        id: shot.id,
        order: shot.order,
        sceneCode: shot.sceneCode,
        durationSec: shot.durationSec,
        shotSize: shot.shotSize,
        camera: shot.camera,
        location: shot.location,
        timeOfDay: shot.timeOfDay,
        action: shot.action,
        dialogue: shot.dialogue,
        speakerId: shot.speakerId,
        speakerName: shot.speakerName,
        prompt: shot.prompt,
        negativePrompt: shot.negativePrompt,
        status: shot.status,
        notes: shot.notes,
      }))}
      duration={view.duration}
      cast={view.cast}
      hasScript={view.hasScript}
      canWrite={can(user, 'episode.write')}
      currency={user.displayCurrency}
      fx={fx}
      providerReady={provider.available}
      {...(provider.detail ? { providerDetail: provider.detail } : {})}
      selectedShotId={selectedShotId}
    />
  )
}
