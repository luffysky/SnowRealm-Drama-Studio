import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { BookTabs } from '@/components/studio/BookTabs'
import { listArcs } from '@/lib/arcs'
import { getSessionUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getCharacters } from '@/lib/characters'
import { db } from '@/db'
import { assets, episodes } from '@/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { novelTitleOf } from '@/lib/project-titles'
import { requireProjectPage } from '@/lib/project-access'
import { novelToc } from '@/lib/writing'

type Params = { params: Promise<{ projectId: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const user = await getSessionUser()
  if (!user) return { title: '看小說' }

  const { projectId } = await params
  try {
    const project = await requireProjectPage(projectId, user.id)
    return { title: novelTitleOf(project) }
  } catch {
    return { title: '看小說' }
  }
}

/**
 * 一本書 (Z136).
 *
 * 目錄、簡介、有聲三個分頁，正文另開——閱讀器是 `fixed inset-0` 的覆蓋層，
 * 放進分頁會蓋掉分頁列本身，而且讀小說本來就該佔滿整個螢幕。
 *
 * 刻意**沒有**排行榜、分類篩選、字數級距那些：那是幾十萬本書撐起來的東西，
 * 兩部作品套上去就是一堆空畫面（spec v2 §4）。留下的是這裡真的有資料的部分。
 */
export default async function BookPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const [toc, arcs, characters, audio] = await Promise.all([
    novelToc(project.id, 'NOVEL'),
    listArcs(project.id),
    getCharacters(project.id),
    /*
     * 已經做好的有聲書。讀的是素材，不是任務——任務跑完就結束了，而檔案留著。
     * 一集可能做過好幾次（換了音色重做），所以取最新的那一個。
     */
    db
      .select({
        assetId: assets.id,
        episodeId: assets.episodeId,
        title: assets.title,
        durationSec: assets.durationSec,
        sizeBytes: assets.sizeBytes,
        createdAt: assets.createdAt,
      })
      .from(assets)
      .where(
        and(
          eq(assets.projectId, project.id),
          eq(assets.kind, 'VOICE'),
          eq(assets.uploadStatus, 'COMPLETED'),
          isNull(assets.deletedAt)
        )
      ),
  ])

  if (toc.length === 0) notFound()

  /** Which 卷 each episode sits in, so 目錄 can be three levels deep. */
  const arcOf = new Map<string, { id: string; title: string; index: number }>()
  const episodeArcs = await db
    .select({ id: episodes.id, arcId: episodes.arcId })
    .from(episodes)
    .where(and(eq(episodes.projectId, project.id), isNull(episodes.deletedAt)))

  const arcById = new Map(arcs.map((arc) => [arc.id, arc]))
  for (const row of episodeArcs) {
    const arc = arcById.get(row.arcId)
    if (arc) arcOf.set(row.id, { id: arc.id, title: arc.title, index: arc.index })
  }

  /** Newest audiobook per episode. */
  const audioByEpisode = new Map<string, (typeof audio)[number]>()
  for (const row of audio) {
    if (!row.episodeId) continue
    const existing = audioByEpisode.get(row.episodeId)
    if (!existing || row.createdAt > existing.createdAt) audioByEpisode.set(row.episodeId, row)
  }

  return (
    <BookTabs
      projectId={project.id}
      title={novelTitleOf(project)}
      logline={project.logline}
      synopsis={project.synopsis}
      targetChars={project.targetChars}
      canGenerate={can(user, 'ai.run')}
      arcs={arcs.map((arc) => ({
        id: arc.id,
        index: arc.index,
        title: arc.title,
        logline: arc.logline,
      }))}
      episodes={toc.map((episode) => ({
        episodeId: episode.episodeId,
        number: episode.number,
        title: episode.title,
        charCount: episode.charCount,
        chapters: episode.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          charCount: chapter.charCount,
        })),
        arcId: arcOf.get(episode.episodeId)?.id ?? null,
        audio: (() => {
          const row = audioByEpisode.get(episode.episodeId)
          if (!row) return null
          return {
            assetId: row.assetId,
            durationSec: row.durationSec,
            sizeBytes: Number(row.sizeBytes),
          }
        })(),
      }))}
      cast={characters.characters.map((character) => ({
        id: character.id,
        name: character.name,
        alias: character.alias,
        tier: character.tier,
        gender: character.gender,
        /*
         * 性格當作一句話介紹。角色沒有 logline 欄位，而外觀提示詞是給生圖用
         * 的、背景往往是劇透——性格是唯一適合放在書籍簡介頁上的那一欄。
         */
        note: character.personality,
        episodeCount: character.episodeCount,
      }))}
    />
  )
}
