import { sql } from 'drizzle-orm'
import { db } from '@/db'

/**
 * 讓製作進度跟真正寫出來的東西對齊 (Z117).
 *
 * `episode_production_stages` was seeded when a project was created — nine
 * rows per episode, every one `not_started` — and **nothing in the codebase
 * ever wrote to it again**. No UI, no API, no hook on saving. So five written
 * episodes still reported 0%, 製作流程 showed 1,080 rows of 未開始 forever,
 * and the dashboard agreed with them. The numbers were not wrong about the
 * board; the board was never connected to the work.
 *
 * What this does **not** do is decide that something is finished. 完成 is a
 * judgement — a chapter at its word target may still be a draft — and it stays
 * a human's to make. What can be measured is measured:
 *
 * | 階段 | 從哪裡算 |
 * |---|---|
 * | 小說 | 這一集的字數 ÷ 作品的單集目標字數 |
 * | 劇本 | 場次的預估秒數 ÷ 這一集的目標片長 |
 * | 分鏡 | 有沒有鏡頭 |
 * | 素材 | 這一集有沒有素材 |
 *
 * The rest have no objective signal, so they are left alone rather than given
 * an invented one.
 *
 * **It only ever raises.** A stage a person marked 完成 stays 完成, and a
 * percentage someone typed is kept when it is higher than the measurement —
 * this fills in what nobody recorded, it does not overrule anybody.
 */

/** Stages this can measure. Everything else stays manual. */
export const DERIVED_STAGES = ['novel', 'script', 'storyboard', 'assets'] as const

/**
 * Recomputes the measurable stages for one project.
 *
 * One statement rather than a row at a time: 120 episodes × 4 stages is 480
 * updates, and doing them individually after every chapter save would make
 * saving a chapter slower than writing one.
 *
 * Idempotent — it reads the content and writes what it finds, so running it
 * twice changes nothing and running it late fixes everything.
 */
export async function syncProjectStages(projectId: string): Promise<number> {
  return syncStages(sql`e.project_id = ${projectId}`)
}

/**
 * The same, for one episode.
 *
 * Four rows instead of four hundred and eighty — cheap enough to run on every
 * chapter save, which is what keeps the board current without anybody
 * remembering to press anything. Autosave fires every few seconds while
 * someone is typing, so this had to be the narrow one.
 */
export async function syncEpisodeStages(episodeId: string): Promise<number> {
  return syncStages(sql`e.id = ${episodeId}`)
}

async function syncStages(scope: ReturnType<typeof sql>): Promise<number> {
  const result = await db.execute(sql`
    with measured as (
      select
        e.id as episode_id,
        'novel'::text as stage_key,
        least(
          1.0,
          coalesce(
            (
              select sum(ch.char_count)::numeric
                from chapters ch
                join documents d on d.id = ch.document_id
               where d.episode_id = e.id
                 and d.kind = 'NOVEL'
                 and d.deleted_at is null
            ),
            0
          ) / nullif(p.target_chars, 0)
        ) as fraction
      from episodes e
      join projects p on p.id = e.project_id
      where ${scope} and e.deleted_at is null

      union all

      select
        e.id,
        'script',
        least(
          1.0,
          coalesce(
            (
              select sum(sc.estimated_sec)::numeric
                from scenes sc
                join documents d on d.id = sc.document_id
               where d.episode_id = e.id
                 and d.kind = 'SCRIPT'
                 and d.deleted_at is null
            ),
            0
          ) / nullif(e.target_sec, 0)
        )
      from episodes e
      where ${scope} and e.deleted_at is null

      union all

      /*
       * 分鏡 and 素材 have no target to measure against, so they report
       * 「開始了」 and nothing more. A small non-zero fraction would be a
       * number nobody measured.
       */
      select
        e.id,
        'storyboard',
        case when exists (
          select 1 from shots sh
            join scenes sc on sc.id = sh.scene_id
            join documents d on d.id = sc.document_id
           where d.episode_id = e.id and d.deleted_at is null
        ) then 0.0 else null end
      from episodes e
      where ${scope} and e.deleted_at is null

      union all

      select
        e.id,
        'assets',
        case when exists (
          select 1 from assets a
           where a.episode_id = e.id
             and a.deleted_at is null
             and a.upload_status = 'COMPLETED'
             and a.origin = 'LIBRARY'
        ) then 0.0 else null end
      from episodes e
      where ${scope} and e.deleted_at is null
    )
    update episode_production_stages s
       set status = 'in_progress',
           progress_percent = greatest(
             s.progress_percent,
             round(coalesce(m.fraction, 0) * 100)::int
           ),
           started_at = coalesce(s.started_at, now()),
           updated_at = now()
      from measured m
     where s.episode_id = m.episode_id
       and s.stage_key = m.stage_key::production_stage_key
       and m.fraction is not null
       -- Never walk back a human's judgement.
       and s.status <> 'completed'
       -- Only when the measurement says something has actually happened.
       and (m.fraction > 0 or s.stage_key in ('storyboard', 'assets'))
       -- And only when it would change something, so this is cheap to re-run.
       and (
         s.status = 'not_started'
         or s.progress_percent < round(coalesce(m.fraction, 0) * 100)::int
       )
  `)

  return result.rowCount ?? 0
}

/**
 * Drops a stage back to 未開始 when its content is gone.
 *
 * Deleting every chapter of an episode has to be allowed to undo 「開始了」,
 * or the board would only ever ratchet upward and a mistake could never be
 * taken back. Still never touches `completed`.
 */
export async function clearEmptyStages(projectId: string): Promise<number> {
  return clearStages(sql`e.project_id = ${projectId}`)
}

export async function clearEmptyEpisodeStages(episodeId: string): Promise<number> {
  return clearStages(sql`e.id = ${episodeId}`)
}

async function clearStages(scope: ReturnType<typeof sql>): Promise<number> {
  const result = await db.execute(sql`
    update episode_production_stages s
       set status = 'not_started',
           progress_percent = 0,
           started_at = null,
           updated_at = now()
      from episodes e
     where e.id = s.episode_id
       and ${scope}
       and s.stage_key = 'novel'
       and s.status = 'in_progress'
       and not exists (
         select 1
           from chapters ch
           join documents d on d.id = ch.document_id
          where d.episode_id = e.id
            and d.kind = 'NOVEL'
            and d.deleted_at is null
            and ch.char_count > 0
       )
  `)

  return result.rowCount ?? 0
}

/** Both directions, for a write path that might have added or removed. */
export async function resyncStages(projectId: string): Promise<void> {
  await clearEmptyStages(projectId)
  await syncProjectStages(projectId)
}

/**
 * Both directions for one episode.
 *
 * Deliberately swallows its own failure: this keeps a progress bar honest, and
 * a progress bar is never worth failing somebody's save over. If it misses,
 * the next save or the project-wide sync picks it up.
 */
export async function resyncEpisodeStages(episodeId: string): Promise<void> {
  try {
    await clearEmptyEpisodeStages(episodeId)
    await syncEpisodeStages(episodeId)
  } catch {
    /* 進度條不值得讓人家的存檔失敗。 */
  }
}
