import { sql } from 'drizzle-orm'
import { db } from '@/db'

/**
 * 產出跟設定對不上的地方 (Z127-4).
 *
 * The run that proved the AI queue works also said something nobody asked it
 * to: that the source chapter for EP001 is four to five minutes of material
 * against a 150-second target. That was the most useful sentence the model
 * produced all day, and it existed **only inside one draft's prose** — no
 * screen showed it, and the next episode would have hit the same wall with no
 * warning.
 *
 * So this does not go reading model output for sentences like it. It computes
 * the same class of mismatch from the content and the settings directly, which
 * means it answers for all 120 episodes rather than for whichever one a model
 * happened to comment on, and it answers *before* anything is generated.
 *
 * Running it found that the first finding is not about any episode at all:
 * 單集目標字數 is 4,000 and 目標片長 is 150 秒. 4,000 characters is about
 * seventeen minutes of reading. **The two settings cannot both be true**, and
 * every per-episode warning derived from them was really that one fact
 * repeated nine times.
 *
 * Which is the rule this file is built around: **one finding per fact, not
 * per row.** Nine identical warnings is a list nobody reads, and the episode
 * numbers belong inside the one finding rather than as nine of them.
 *
 * Also kept:
 *
 *  - **Nothing invented.** Every finding states the numbers it came from, so
 *    a person can disagree with it (spec v3 §0).
 *  - **No finding without a target.** Where there is no setting to be out of
 *    step with, there is nothing to report.
 *  - **Links somewhere.** A warning you cannot act on from where you read it
 *    is a warning that gets read once.
 */

export type FindingSeverity = 'warn' | 'info'

export type Finding = {
  /** Stable across runs, so 「已讀」 state and React keys have something. */
  id: string
  check: string
  severity: FindingSeverity
  title: string
  /** The numbers behind it, in the user's words. */
  detail: string
  projectTitle: string
  /** Episodes this covers. Empty when the finding is about the work itself. */
  episodes: number[]
  href: string | null
}

/**
 * Characters of Chinese prose read aloud per second.
 *
 * Measured, not assumed: 70 characters took 18.3 seconds in Chrome's speech
 * synthesis (`src/lib/speech.ts`). It is a **reading** rate, so what it gives
 * is 「唸完這些字要多久」 — an upper bound on how much story a chapter holds.
 * Findings say 朗讀 rather than 片長 for exactly that reason: the finished
 * runtime depends on the edit, and claiming otherwise would be inventing a
 * number.
 */
const CHARS_PER_SEC = 3.9

/** Below this an episode has barely been started; not worth a warning. */
const MIN_CHARS_TO_JUDGE = 300

/** 已寫字數 may differ from 單集目標字數 by this fraction before reporting. */
const CHAR_DRIFT = 0.4

/** 劇本預估片長 may differ from 目標片長 by this fraction either way. */
const SCRIPT_DRIFT = 0.25

/**
 * How far apart 單集目標字數 and 目標片長 have to be to call them
 * contradictory. 1.5 allows for prose being compressed into dialogue; past
 * that the two settings are describing different shows.
 */
const SETTINGS_TOLERANCE = 1.5

export async function productionFindings(limit = 40): Promise<Finding[]> {
  const [settings, lengths, scripts, missingScripts, exhausted, unseenCast] = await Promise.all([
    contradictorySettings(),
    novelLengthFindings(),
    scriptDriftFindings(),
    writtenButNoScript(),
    exhaustedJobs(),
    castWithNoAppearance(),
  ])

  /*
   * Settings first: when the work's own two targets disagree, every other
   * length finding is downstream of that one, and fixing it is what makes the
   * rest meaningful.
   */
  const all = [...settings, ...lengths, ...scripts, ...missingScripts, ...exhausted, ...unseenCast]
  return all
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warn' ? -1 : 1))
    .slice(0, limit)
}

/* -------------------------------------------------------------------------- */

/**
 * 單集目標字數 against 目標片長 — the work arguing with itself.
 *
 * Needs no written content at all, which is the point: it is wrong from the
 * moment the project is set up, and it is the reason the model refused to
 * write an outline rather than a reason any single episode is too long.
 */
async function contradictorySettings(): Promise<Finding[]> {
  const rows = await db.execute<{
    project_id: string
    project_title: string
    target_chars: number
    target_sec: string
  }>(sql`
    select p.id::text as project_id,
           p.title as project_title,
           p.target_chars,
           -- One number only when every episode agrees; otherwise the median.
           (percentile_cont(0.5) within group (order by e.target_sec))::text as target_sec
      from projects p
      join episodes e on e.project_id = p.id and e.deleted_at is null
     where p.deleted_at is null and p.target_chars > 0
     group by p.id, p.title, p.target_chars
  `)

  const out: Finding[] = []

  for (const row of rows.rows) {
    const targetSec = Number(row.target_sec)
    if (!Number.isFinite(targetSec) || targetSec <= 0) continue

    const impliedSec = row.target_chars / CHARS_PER_SEC
    if (impliedSec <= targetSec * SETTINGS_TOLERANCE) continue

    /** What a chapter would have to be to fit the target runtime. */
    const fits = Math.round(targetSec * CHARS_PER_SEC)

    out.push({
      id: `settings:${row.project_id}`,
      check: '兩個設定對不上',
      severity: 'warn',
      title: '單集目標字數跟目標片長互相矛盾',
      detail:
        `單集目標 ${row.target_chars.toLocaleString('zh-TW')} 字，朗讀約 ${minutes(impliedSec)}；` +
        `目標片長只有 ${minutes(targetSec)}，大約裝得下 ${fits.toLocaleString('zh-TW')} 字。` +
        `兩個數字不可能同時成立——要嘛原著當素材庫、一集小說拆成好幾集影片，` +
        `要嘛把其中一個設定改掉。AI 改編時每次都會撞到這件事。`,
      projectTitle: row.project_title,
      episodes: [],
      href: `/projects/${row.project_id}`,
    })
  }

  return out
}

/**
 * 已寫字數 against the work's own 單集目標字數.
 *
 * Measured against the character target rather than the runtime on purpose:
 * the runtime contradiction is `contradictorySettings`' finding, and saying it
 * again per episode is how nine rows became one fact nine times.
 */
async function novelLengthFindings(): Promise<Finding[]> {
  const rows = await db.execute<{
    project_id: string
    project_title: string
    target_chars: number
    number: number
    chars: string
  }>(sql`
    select p.id::text as project_id,
           p.title as project_title,
           p.target_chars,
           e.number,
           sum(ch.char_count)::text as chars
      from episodes e
      join projects p on p.id = e.project_id
      join documents d on d.episode_id = e.id and d.kind = 'NOVEL' and d.deleted_at is null
      join chapters ch on ch.document_id = d.id
     where e.deleted_at is null and p.target_chars > 0
     group by p.id, p.title, p.target_chars, e.number
    having sum(ch.char_count) >= ${MIN_CHARS_TO_JUDGE}
     order by p.title, e.number
  `)

  type Group = {
    projectId: string
    projectTitle: string
    targetChars: number
    over: { number: number; chars: number }[]
    under: { number: number; chars: number }[]
  }

  const groups = new Map<string, Group>()

  for (const row of rows.rows) {
    const chars = Number(row.chars)
    const drift = (chars - row.target_chars) / row.target_chars
    if (Math.abs(drift) < CHAR_DRIFT) continue

    const group = groups.get(row.project_id) ?? {
      projectId: row.project_id,
      projectTitle: row.project_title,
      targetChars: row.target_chars,
      over: [],
      under: [],
    }
    ;(drift > 0 ? group.over : group.under).push({ number: row.number, chars })
    groups.set(row.project_id, group)
  }

  const out: Finding[] = []

  for (const group of groups.values()) {
    for (const [side, rowsOnSide] of [
      ['over', group.over],
      ['under', group.under],
    ] as const) {
      if (rowsOnSide.length === 0) continue

      const average = rowsOnSide.reduce((n, r) => n + r.chars, 0) / rowsOnSide.length
      const ratio = Math.round((average / group.targetChars) * 100)
      const over = side === 'over'

      out.push({
        id: `novel-chars:${group.projectId}:${side}`,
        check: '字數離目標太遠',
        severity: 'info',
        title: `${rowsOnSide.length} 集的字數${over ? '遠超過' : '遠低於'}單集目標`,
        detail:
          `${episodeList(rowsOnSide.map((r) => r.number))}，平均 ` +
          `${Math.round(average).toLocaleString('zh-TW')} 字，是目標 ` +
          `${group.targetChars.toLocaleString('zh-TW')} 字的 ${ratio}%。` +
          (over
            ? '目標字數可能該往上調，不然進度條會一直顯示超過 100%。'
            : '可能還在寫，也可能目標訂得太高。'),
        projectTitle: group.projectTitle,
        episodes: rowsOnSide.map((r) => r.number),
        href: `/projects/${group.projectId}/novel`,
      })
    }
  }

  return out
}

/** 劇本預估片長 against 目標片長, once there is a script to measure. */
async function scriptDriftFindings(): Promise<Finding[]> {
  const rows = await db.execute<{
    project_id: string
    project_title: string
    episode_id: string
    number: number
    target_sec: number
    estimated_sec: string
    scenes: string
  }>(sql`
    select p.id::text as project_id,
           p.title as project_title,
           e.id::text as episode_id,
           e.number,
           e.target_sec,
           sum(sc.estimated_sec)::text as estimated_sec,
           count(*)::text as scenes
      from episodes e
      join projects p on p.id = e.project_id
      join documents d on d.episode_id = e.id and d.kind = 'SCRIPT' and d.deleted_at is null
      join scenes sc on sc.document_id = d.id
     where e.deleted_at is null
     group by p.id, p.title, e.id, e.number, e.target_sec
    having sum(sc.estimated_sec) > 0
     order by e.number
  `)

  const out: Finding[] = []

  for (const row of rows.rows) {
    const estimated = Number(row.estimated_sec)
    const target = row.target_sec
    if (target <= 0) continue

    const drift = (estimated - target) / target
    if (Math.abs(drift) < SCRIPT_DRIFT) continue

    const over = drift > 0
    out.push({
      id: `script-drift:${row.episode_id}`,
      check: '劇本片長偏離',
      severity: 'warn',
      title: `EP${pad(row.number)} 劇本預估片長${over ? '超過' : '不到'}目標`,
      detail:
        `${row.scenes} 場共 ${minutes(estimated)}，目標 ${minutes(target)}（` +
        `${over ? '+' : ''}${Math.round(drift * 100)}%）。`,
      projectTitle: row.project_title,
      episodes: [row.number],
      href: `/projects/${row.project_id}/episodes/${row.episode_id}/script`,
    })
  }

  return out
}

/**
 * 小說寫完了，劇本還是空的.
 *
 * Keyed off 小說 being `completed`, which only happens when the author wrote
 * 「第NNN集 完」 themselves (Z118) — the author's own signal that the episode
 * is ready for the next stage, not a word count's guess at it.
 */
async function writtenButNoScript(): Promise<Finding[]> {
  const rows = await db.execute<{
    project_id: string
    project_title: string
    number: number
  }>(sql`
    select p.id::text as project_id,
           p.title as project_title,
           e.number
      from episode_production_stages s
      join episodes e on e.id = s.episode_id
      join projects p on p.id = e.project_id
     where s.stage_key = 'novel'
       and s.status = 'completed'
       and e.deleted_at is null
       and not exists (
         select 1
           from scenes sc
           join documents d on d.id = sc.document_id
          where d.episode_id = e.id and d.kind = 'SCRIPT' and d.deleted_at is null
       )
     order by p.title, e.number
  `)

  const groups = new Map<string, { title: string; numbers: number[] }>()

  for (const row of rows.rows) {
    const group = groups.get(row.project_id) ?? { title: row.project_title, numbers: [] }
    group.numbers.push(row.number)
    groups.set(row.project_id, group)
  }

  return [...groups.entries()].map(([projectId, group]) => ({
    id: `no-script:${projectId}`,
    check: '寫完了沒接下去',
    severity: 'info' as const,
    title: `${group.numbers.length} 集小說已收尾，劇本還沒開始`,
    detail: `${episodeList(group.numbers)}。可以用下面的批次生成一次全部下「小說轉劇本」。`,
    projectTitle: group.title,
    episodes: group.numbers,
    href: `/projects/${projectId}/episodes`,
  }))
}

/** Jobs that failed with no retry left. Nobody is coming back for these. */
async function exhaustedJobs(): Promise<Finding[]> {
  const rows = await db.execute<{
    id: string
    project_title: string | null
    number: number | null
    error_message: string
    attempt_count: number
  }>(sql`
    select j.id::text as id,
           p.title as project_title,
           e.number,
           j.error_message,
           j.attempt_count
      from ai_jobs j
      left join projects p on p.id = j.project_id
      left join episodes e on e.id = j.episode_id
     where j.status = 'FAILED'
       and j.attempt_count >= j.max_attempts
     order by j.finished_at desc nulls last
     limit 10
  `)

  return rows.rows.map((row) => ({
    id: `exhausted:${row.id}`,
    check: '任務用盡重試',
    severity: 'warn' as const,
    title: `有任務重試 ${row.attempt_count} 次後失敗`,
    detail: row.error_message || '沒有留下錯誤訊息。',
    projectTitle: row.project_title ?? '',
    episodes: row.number === null ? [] : [row.number],
    href: '/ai',
  }))
}

/**
 * 主角建了，但一集都沒出現.
 *
 * Only meaningful now that appearances are derived from the prose (P0-1).
 * Before that every character read 「出現於 0 集」 and this would have
 * flagged the whole cast.
 */
async function castWithNoAppearance(): Promise<Finding[]> {
  const rows = await db.execute<{
    project_id: string
    project_title: string
    name: string
  }>(sql`
    select p.id::text as project_id, p.title as project_title, c.name
      from characters c
      join projects p on p.id = c.project_id
     where c.deleted_at is null
       and not exists (select 1 from episode_characters ec where ec.character_id = c.id)
       -- 主角 only. A 配角 written for a later arc not appearing yet is the
       -- plan working, and flagging them would bury the case that matters.
       and c.tier = 'LEAD'
       -- And only once there is prose for them to be absent from.
       and exists (
         select 1 from documents d
           join chapters ch on ch.document_id = d.id
           join episodes e on e.id = d.episode_id
          where d.kind = 'NOVEL' and d.deleted_at is null and ch.char_count > 0
            and e.project_id = p.id
       )
     order by p.title, c.name
     limit 10
  `)

  const groups = new Map<string, { title: string; names: string[] }>()

  for (const row of rows.rows) {
    const group = groups.get(row.project_id) ?? { title: row.project_title, names: [] }
    group.names.push(row.name)
    groups.set(row.project_id, group)
  }

  return [...groups.entries()].map(([projectId, group]) => ({
    id: `unseen:${projectId}`,
    check: '角色沒出場',
    severity: 'info' as const,
    title: `${group.names.join('、')} 在已寫好的集數裡一次都沒出現`,
    detail: '主角卻沒被點到名——可能正文用的是別的稱呼，到角色頁補一個別名就能對上。',
    projectTitle: group.title,
    episodes: [],
    href: `/projects/${projectId}/characters`,
  }))
}

/* -------------------------------------------------------------------------- */

function pad(n: number): string {
  return String(n).padStart(3, '0')
}

/**
 * 「EP001–EP009」 for a run, 「EP002、EP005、EP011」 otherwise.
 *
 * Collapsing runs matters more than it looks: the common case is every
 * episode written so far, and 「EP001、EP002、…、EP009」 makes a sentence you
 * have to parse instead of read.
 */
function episodeList(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  if (sorted.length === 1) return `EP${pad(sorted[0]!)}`

  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const isRun = last - first + 1 === sorted.length

  if (isRun) return `EP${pad(first)}–EP${pad(last)}`
  if (sorted.length <= 6) return sorted.map((n) => `EP${pad(n)}`).join('、')

  return `${sorted.slice(0, 5).map((n) => `EP${pad(n)}`).join('、')} 等 ${sorted.length} 集`
}

/** 「2 分 30 秒」 — seconds alone stop being readable past about a minute. */
function minutes(seconds: number): string {
  const total = Math.round(seconds)
  if (total < 60) return `${total} 秒`
  const m = Math.floor(total / 60)
  const s = total % 60
  return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`
}
