import { eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { episodes } from '@/db/schema'
import { syncAppearances } from '@/lib/character-appearances'
import { END_MARKER_SOURCE } from '@/lib/novel-progress'

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
        /*
         * 寫完了沒有，看作者自己標的（Z118）。
         *
         * The last chapter ending in 「第001集 完」 is the author saying so.
         * A word count cannot: a chapter at 110% of target can still be half
         * a scene short, and one at 60% can be finished because it came out
         * tighter than planned.
         *
         * Tags are stripped before matching, so a marker the editor split
         * across elements still reads as one phrase.
         */
        case
          when exists (
            select 1
              from chapters ch
              join documents d on d.id = ch.document_id
             where d.episode_id = e.id
               and d.kind = 'NOVEL'
               and d.deleted_at is null
               and ch.sort_order = (
                 select max(ch2.sort_order)
                   from chapters ch2
                   join documents d2 on d2.id = ch2.document_id
                  where d2.episode_id = e.id and d2.kind = 'NOVEL' and d2.deleted_at is null
               )
               and regexp_replace(ch.content, '<[^>]*>', '', 'g') ~ ${sql.raw(`'${END_MARKER_SOURCE}'`)}
          )
          then 1.0
          else least(
            0.99,
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
          )
        end as fraction
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
       set status = case
             /*
              * 1.0 for 小說 means the author wrote 「第NNN集 完」, which is
              * the one source that can say a chapter is finished. For the
              * other stages it is only ever a measurement, so they stay
              * 進行中 until a person decides.
              */
             when m.stage_key = 'novel' and m.fraction >= 1 then 'completed'
             else 'in_progress'
           end::production_stage_status,
           progress_percent = greatest(
             s.progress_percent,
             round(coalesce(m.fraction, 0) * 100)::int
           ),
           started_at = coalesce(s.started_at, now()),
           completed_at = case
             when m.stage_key = 'novel' and m.fraction >= 1
               then coalesce(s.completed_at, now())
             else s.completed_at
           end,
           updated_at = now()
      from measured m
     where s.episode_id = m.episode_id
       and s.stage_key = m.stage_key::production_stage_key
       and m.fraction is not null
       /*
        * Never walk back 完成 — except for 小說, where 完成 is itself derived
        * from the text, so deleting the 「第NNN集 完」 line has to be able to
        * take it back. The other stages are a human's call and stay put.
        */
       and (s.status <> 'completed' or m.stage_key = 'novel')
       -- Only when the measurement says something has actually happened.
       and (m.fraction > 0 or s.stage_key in ('storyboard', 'assets'))
       -- And only when it would change something, so this is cheap to re-run.
       and (
         s.status = 'not_started'
         or s.progress_percent < round(coalesce(m.fraction, 0) * 100)::int
         -- Reaching 完成 is a change even when the percentage did not move.
         or (m.stage_key = 'novel' and m.fraction >= 1 and s.status <> 'completed')
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
           completed_at = null,
           updated_at = now()
      from episodes e
     where e.id = s.episode_id
       and ${scope}
       and s.stage_key = 'novel'
       and s.status in ('in_progress', 'completed')
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

    /*
     * 角色出場也是從同一份正文推導的 (P0-1)，所以一起跟上。
     *
     * Scoped to the project rather than the episode because a name can be
     * written out of one episode and into another in the same sitting, and
     * recomputing only the episode just saved would leave the other wrong.
     */
    const [row] = await db
      .select({ projectId: episodes.projectId })
      .from(episodes)
      .where(eq(episodes.id, episodeId))
      .limit(1)

    if (row) await syncAppearances(row.projectId)
  } catch {
    /* 進度條與出場統計都不值得讓人家的存檔失敗。 */
  }
}
