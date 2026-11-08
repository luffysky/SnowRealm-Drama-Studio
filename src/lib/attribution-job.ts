import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import crypto from 'node:crypto'
import { db } from '@/db'
import { aiJobs, characters, episodeLineSpeakers, episodes } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import { buildContext, estimateJob } from '@/lib/ai/jobs'
import { enqueueJob } from '@/lib/ai/queue'
import type { SessionUser } from '@/lib/auth/session'
import type { CharacterTierValue } from '@/lib/constants'
import {
  attributionCoverage,
  gendersFrom,
  mergeAttribution,
  parseAttribution,
  planAttribution,
  type AttributionPlan,
} from '@/lib/attribution'
import type { CastMember } from '@/lib/narration'
import { novelForReading } from '@/lib/novel-export'

/**
 * 問模型「這句話是誰說的」，然後把答案存下來 (Z132).
 *
 * 走一般的任務佇列，所以花費、重試、待確認全部是既有的那一套——它跟其他
 * 文字任務的差別只在輸出是結構化的，而且**套用的對象不是正文**。
 *
 * 那一點很要緊：其他 AI 產出套用時會覆蓋稿子，所以必須人看過。這個不會動到
 * 任何一個字——它寫的是「第 37 段是許山河說的」，而正文一個字都沒變。所以
 * 它的風險低得多，但仍然停在待確認：配錯聲音也是錯，只是改回來便宜。
 */

/** Per request. An episode of this novel is ~300 lines, which fits. */
const MAX_LINES = 400

async function loadEpisode(projectId: string, episodeId: string) {
  const [episode] = await db
    .select({ id: episodes.id, number: episodes.number })
    .from(episodes)
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.projectId, projectId),
        isNull(episodes.deletedAt)
      )
    )
    .limit(1)

  if (!episode) throw ApiError.notFound('找不到這一集')

  const chapters = (await novelForReading(projectId)).filter(
    (chapter) => chapter.episodeId === episodeId
  )
  if (chapters.length === 0) throw ApiError.badRequest('這一集還沒有小說內容')

  const cast = await db
    .select({
      id: characters.id,
      name: characters.name,
      alias: characters.alias,
      gender: characters.gender,
      tier: characters.tier,
    })
    .from(characters)
    .where(and(eq(characters.projectId, projectId), isNull(characters.deletedAt)))

  return {
    episode,
    /*
     * The whole episode flattened, in the same order `novelForReading` gives
     * the reader and the audiobook. The paragraph index is the key everything
     * downstream uses, so it has to be the same flattening in all three.
     */
    paragraphs: chapters.flatMap((chapter) => chapter.paragraphs),
    cast: cast.map(
      (row): CastMember => ({
        id: row.id,
        name: row.name,
        gender: row.gender ?? '',
        tier: row.tier,
        ...(row.alias ? { alias: row.alias } : {}),
      })
    ),
  }
}

export async function enqueueAttribution(input: {
  projectId: string
  episodeId: string
  user: SessionUser
}): Promise<{ jobId: string; asked: number; settled: number; deduplicated: boolean }> {
  const { episode, paragraphs, cast } = await loadEpisode(input.projectId, input.episodeId)
  const plan = planAttribution(paragraphs, cast, { maxLines: MAX_LINES })

  if (plan.ask.length === 0) {
    throw ApiError.badRequest(
      plan.settled.length > 0
        ? '這一集的對白規則就判得出來，不需要問模型。'
        : '這一集沒有對白。'
    )
  }

  const context = await buildContext({
    projectId: input.projectId,
    episodeId: input.episodeId,
    novelEpisodeId: null,
    // The numbered prose is the material; everything is keyed on these indices.
    sourceText: plan.excerpt,
    userInstruction:
      `要判斷的段號：${plan.ask.map((line) => line.index).join('、')}。\n` +
      `角色名單：${plan.cast.length > 0 ? plan.cast.join('、') : '（這部作品還沒有建角色）'}。\n` +
      `只回這些段號的結果，不要回其他段。`,
    includeWorld: false,
    includeCharacters: true,
  })

  let estimatedCostUsd: number | null = null
  try {
    const estimate = await estimateJob({
      task: 'DIALOGUE_ATTRIBUTE',
      providerId: null,
      candidates: 1,
      context,
    })
    estimatedCostUsd = estimate.estimatedCostUsd
  } catch {
    // Informational; a provider that cannot count tokens must not block it.
  }

  const { job, deduplicated } = await enqueueJob({
    user: input.user,
    task: 'DIALOGUE_ATTRIBUTE',
    context,
    projectId: input.projectId,
    episodeId: input.episodeId,
    providerId: null,
    candidates: 1,
    /*
     * No document target. Applying this writes speaker rows, never prose —
     * `applyAttribution` below is the only path, and the generic document
     * apply must never pick it up.
     */
    targetType: 'episode_speakers',
    targetId: input.episodeId,
    idempotencyKey: crypto.randomUUID(),
    estimatedCostUsd,
  })

  await logActivity({
    user: input.user,
    action: 'ai.enqueue',
    entityType: 'episode',
    entityId: input.episodeId,
    projectId: input.projectId,
    summary:
      `${input.user.name} 替 EP${String(episode.number).padStart(3, '0')} 排入對白歸屬` +
      `（${plan.ask.length} 句要判斷，${plan.settled.length} 句規則已判出）`,
  })

  return {
    jobId: job.id,
    asked: plan.ask.length,
    settled: plan.settled.length,
    deduplicated,
  }
}

/* -------------------------------------------------------------------------- */

export type AppliedAttribution = {
  written: number
  /** Names the prose used that the cast table does not have. */
  newNames: string[]
  /** Entries the parser refused, so a bad run is visible rather than silent. */
  rejected: number
  coverage: { dialogue: number; attributed: number; fromRules: number; fromModel: number }
}

/**
 * 把模型的答案寫進 `episode_line_speakers`.
 *
 * 重新規劃一次而不是信任任務裡存的計畫：正文可能在排隊期間被改過，而段號是
 * 展平之後的索引——改了一段，後面全部位移。重算一次，對不上的段號就會在
 * `parseAttribution` 那一關被擋掉，而不是安靜地把聲音配到錯的句子上。
 *
 * **人手動改過的列不碰。** 跟 `episode_characters` 同一條規矩：推導出來的
 * 可以重算覆蓋，人下的判斷不行。
 */
export async function applyAttribution(input: {
  jobId: string
  user: SessionUser
  /** Include speakers that are not in the cast table yet. */
  includeNew?: boolean
}): Promise<AppliedAttribution> {
  const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, input.jobId)).limit(1)
  if (!job) throw ApiError.notFound('找不到該 AI 任務')
  if (job.status !== 'AWAITING_REVIEW') {
    throw ApiError.badRequest('只有「待人工確認」的任務可以套用')
  }
  if (!job.projectId || !job.episodeId) {
    throw ApiError.badRequest('這筆任務沒有綁定集數')
  }

  const result = job.result as { candidates?: { content: string }[] } | null
  const raw = result?.candidates?.[0]?.content
  if (!raw) throw ApiError.badRequest('這筆任務沒有產出內容')

  const { paragraphs, cast } = await loadEpisode(job.projectId, job.episodeId)
  const plan: AttributionPlan = planAttribution(paragraphs, cast, { maxLines: MAX_LINES })

  const parsed = parseAttribution(raw, plan)
  const merged = mergeAttribution(plan, parsed, { includeNew: input.includeNew ?? true })

  const byName = new Map(cast.map((member) => [member.name, member.id]))
  /*
   * 誰是男是女，由他講過的句子投票決定——模型在長篇裡可能前後不一致，而平手
   * 就留空白，不擲銅板。沒有這一步，角色表裡沒有的人會全部落進中性池按順序
   * 拿音色：第一次跑完「婦人」配到男聲、「陸承安」配到女聲。
   */
  const genders = gendersFrom(parsed.lines)
  const now = new Date()

  const rows = [...merged.entries()].map(([paragraphIndex, speaker]) => ({
    episodeId: job.episodeId!,
    paragraphIndex,
    characterId: byName.get(speaker) ?? null,
    // Kept whatever the table knows: it is how an unlisted speaker still gets
    // a voice, and how they are found later to be added properly.
    spokenAs: speaker,
    gender: genders.get(speaker) ?? '',
    source: plan.settled.some((line) => line.index === paragraphIndex) ? 'rule' : 'model',
    confidence: String(
      parsed.lines.find((line) => line.index === paragraphIndex)?.confidence ?? 1
    ),
    aiJobId: job.id,
    updatedAt: now,
  }))

  if (rows.length > 0) {
    await db
      .insert(episodeLineSpeakers)
      .values(rows)
      .onConflictDoUpdate({
        target: [episodeLineSpeakers.episodeId, episodeLineSpeakers.paragraphIndex],
        set: {
          characterId: sql`excluded.character_id`,
          spokenAs: sql`excluded.spoken_as`,
          gender: sql`excluded.gender`,
          source: sql`excluded.source`,
          confidence: sql`excluded.confidence`,
          aiJobId: sql`excluded.ai_job_id`,
          updatedAt: now,
        },
        // 人改過的不碰。
        setWhere: sql`${episodeLineSpeakers.source} <> 'manual'`,
      })
  }

  await db
    .update(aiJobs)
    .set({
      status: 'SUCCEEDED',
      appliedById: input.user.id,
      appliedAt: now,
      progressNote: `已套用，${rows.length} 句有了說話的人`,
      updatedAt: now,
    })
    .where(eq(aiJobs.id, job.id))

  await logActivity({
    user: input.user,
    action: 'ai.apply',
    entityType: 'episode',
    entityId: job.episodeId,
    projectId: job.projectId,
    summary: `套用對白歸屬：${rows.length} 句`,
  })

  return {
    written: rows.length,
    newNames: parsed.newNames,
    rejected: parsed.rejected.length,
    coverage: attributionCoverage(plan, merged),
  }
}

/* -------------------------------------------------------------------------- */

/**
 * 這一集每一段是誰說的，給配音用.
 *
 * Returns an empty map when nothing has been attributed — the audiobook then
 * falls back to the rules, which is the behaviour it had before.
 */
export async function speakersFor(episodeId: string): Promise<Map<number, string>> {
  return (await attributionFor(episodeId)).speakers
}

/**
 * 段號 → 誰說的，以及每個人是男是女.
 *
 * The genders travel with it because voice assignment needs them and they
 * belong to the speaker, not the line — a name the cast table has never heard
 * of has no gender of its own, and without one it draws from the neutral pool
 * and gets whatever comes next.
 */
export async function attributionFor(episodeId: string): Promise<{
  speakers: Map<number, string>
  genders: Map<string, string>
}> {
  const rows = await db
    .select({
      paragraphIndex: episodeLineSpeakers.paragraphIndex,
      spokenAs: episodeLineSpeakers.spokenAs,
      gender: episodeLineSpeakers.gender,
    })
    .from(episodeLineSpeakers)
    .where(eq(episodeLineSpeakers.episodeId, episodeId))

  const speakers = new Map<number, string>()
  const genders = new Map<string, string>()

  for (const row of rows) {
    if (!row.spokenAs) continue
    speakers.set(row.paragraphIndex, row.spokenAs)
    if (row.gender) genders.set(row.spokenAs, row.gender)
  }

  return { speakers, genders }
}

/** 一集的歸屬狀態，給跨集總覽用 (Z147)。 */
export type AttributionStatus = {
  /** 存了幾列。一列是一個段落的判斷結果。 */
  judged: number
  /** 其中真的有人在說話的幾句（其餘是旁白）。 */
  spoken: number
  /** 認出幾個不同的說話人。 */
  speakers: number
  /** 其中幾句是人工改的。人工改過的不會被重跑蓋掉。 */
  manual: number
  lastAt: Date | null
}

/**
 * 每一集判到哪裡了 (Z147，函式本身是 Z146 砍掉的那一支改寫).
 *
 * ## 為什麼它回來了，而且不一樣
 *
 * 原本那一支回 `{ lines, characters }`，`lines` 是**列數**。而一列不等於一句
 * 對白：`character_id` 是 null 且 `spoken_as` 是空字串的那一列，意思是「這一
 * 段確定沒有人在說話」——旁白。把它算進「判了幾句」會讓一集看起來比實際熱
 * 鬧。所以這裡 `judged`（判過幾段）與 `spoken`（真的有人說話幾句）分開。
 *
 * 今天這部作品兩個數字剛好一樣（73／73），因為套用時只寫有說話人的那些段
 * 落、不寫旁白列。**兩個數字一樣不是它們是同一件事的證據**，而等到哪天真的
 * 開始寫旁白列，一個混在一起的數字不會有人發現它變了意思。
 *
 * `speakers` 用 `coalesce(character_id, spoken_as)` 去重：同一個人可能有些段
 * 落連到角色表、有些只有名字（角色表還沒收的說話人，Z137）。而旁白那一種要排
 * 除掉，否則 `coalesce` 會把它們全折成空字串、算成「一位說話人」。
 *
 * 不回「總共幾句對白」當分母。那要把 120 集的正文全部讀出來、逐段跑一次對白
 * 偵測，而一個要讀整本書才畫得出來的數字，會讓這個總覽貴到沒有人想打開。沒有
 * 分母的「判過 73 段」仍然答得出這個總覽要答的問題：**哪幾集判過、哪幾集沒
 * 有。**
 */
export async function attributionStatus(
  episodeIds: readonly string[]
): Promise<Map<string, AttributionStatus>> {
  if (episodeIds.length === 0) return new Map()

  const named = sql`(${episodeLineSpeakers.characterId} is not null or ${episodeLineSpeakers.spokenAs} <> '')`

  const rows = await db
    .select({
      episodeId: episodeLineSpeakers.episodeId,
      judged: sql<number>`count(*)::int`,
      spoken: sql<number>`count(*) filter (where ${named})::int`,
      speakers: sql<number>`count(distinct case when ${named} then coalesce(${episodeLineSpeakers.characterId}::text, ${episodeLineSpeakers.spokenAs}) end)::int`,
      manual: sql<number>`count(*) filter (where ${episodeLineSpeakers.source} = 'manual')::int`,
      lastAt: sql<Date | null>`max(${episodeLineSpeakers.updatedAt})`,
    })
    .from(episodeLineSpeakers)
    .where(inArray(episodeLineSpeakers.episodeId, [...episodeIds]))
    .groupBy(episodeLineSpeakers.episodeId)

  return new Map(
    rows.map((row) => [
      row.episodeId,
      {
        judged: row.judged,
        spoken: row.spoken,
        speakers: row.speakers,
        manual: row.manual,
        lastAt: row.lastAt ? new Date(row.lastAt) : null,
      },
    ])
  )
}

/*
 * 這裡本來有一支 `attributionStatus(episodeIds[])` (Z146).
 *
 * 它吃一串集數、回報每一集判了幾句、認出幾個角色——也就是為了一個**跨集
 * 總覽**設計的，而那個總覽從來沒有做出來。唯一呼叫它的是一支同樣沒人呼叫
 * 的 GET 端點，所以整條線從頭到尾沒有任何人用過。
 *
 * 那個總覽是真的有用的（「現在只有一集有聲音？」問的就是這個），但它需要
 * 一支吃一串集數的端點加上介面，不是把這個函式留在這裡等。排進待辦
 * （Z147），要做的時候 git 裡有。
 *
 * **Z147 做了，所以它就在上面。** 從 git 撿回來的時候改了形狀（見那支的說
 * 明）。這段留著是因為它記的是「為什麼它曾經被刪掉」——一支沒有呼叫端的函式
 * 該刪，而刪掉之後要做總覽時要記得去 git 裡撿，兩件事都成立。
 */

/* -------------------------------------------------------------------------- */

export type UnlistedSpeaker = {
  name: string
  /** 男 / 女 / 空白，從正文判斷出來的。 */
  gender: string
  /** How many lines they speak across the whole work. */
  lines: number
  /** Which episodes they turn up in. */
  episodes: number[]
}

/**
 * 在正文裡說過話、但角色表沒有的人 (Z137).
 *
 * 歸屬那一趟會認出這些人——錢管事、陸承安、賣雞的老伯——而他們現在處在一個
 * 半吊子的狀態：**配得到聲音，但不在角色頁、沒有定妝照、不算進出場統計。**
 *
 * 之所以不自動建進角色表，是因為那是作者的資料。「周圍的百姓」不是角色，
 * 「路人」也不是；而「陸承安」顯然是。只有人分得出來，所以這裡只負責把名單
 * 端出來。
 */
export async function unlistedSpeakers(projectId: string): Promise<UnlistedSpeaker[]> {
  const rows = await db
    .select({
      spokenAs: episodeLineSpeakers.spokenAs,
      gender: episodeLineSpeakers.gender,
      number: episodes.number,
    })
    .from(episodeLineSpeakers)
    .innerJoin(episodes, eq(episodes.id, episodeLineSpeakers.episodeId))
    .where(
      and(
        eq(episodes.projectId, projectId),
        isNull(episodes.deletedAt),
        // Null means the cast table has no row for them — the whole point.
        isNull(episodeLineSpeakers.characterId)
      )
    )

  const byName = new Map<string, { gender: Map<string, number>; lines: number; episodes: Set<number> }>()

  for (const row of rows) {
    if (!row.spokenAs) continue
    const entry = byName.get(row.spokenAs) ?? {
      gender: new Map<string, number>(),
      lines: 0,
      episodes: new Set<number>(),
    }
    entry.lines += 1
    entry.episodes.add(row.number)
    if (row.gender) entry.gender.set(row.gender, (entry.gender.get(row.gender) ?? 0) + 1)
    byName.set(row.spokenAs, entry)
  }

  return [...byName.entries()]
    .map(([name, entry]) => {
      const ranked = [...entry.gender.entries()].sort((a, b) => b[1] - a[1])
      return {
        name,
        gender: ranked[0]?.[0] ?? '',
        lines: entry.lines,
        episodes: [...entry.episodes].sort((a, b) => a - b),
      }
    })
    // Most spoken first: the people worth adding are the ones who talk.
    .sort((a, b) => b.lines - a.lines)
}

/**
 * 把這些名字建成角色，並把已經歸屬的句子接上去.
 *
 * 建完要**回頭接線**：那些句子現在的 `character_id` 是 null，不接上去的話
 * 角色頁還是會說他出現於 0 集——正是 P0-1 修過的那個毛病，只是從另一個方向
 * 走回來。
 */
export async function promoteSpeakers(input: {
  projectId: string
  names: string[]
  /**
   * 建成哪一級 (Z140). 預設配角，就是本來寫死的那一級。
   *
   * 分級決定體檢會不會抱怨這個角色沒有成長弧線、沒有定妝照。抱怨「路人」
   * 沒有成長弧線是噪音，抱怨主角沒有才是提醒——所以「周圍的百姓」跟
   * 「陸承安」不該建成同一級。
   */
  tier?: CharacterTierValue
  user: SessionUser
}): Promise<{ created: string[]; linked: number; skipped: string[] }> {
  if (input.names.length === 0) return { created: [], linked: 0, skipped: [] }

  const existing = await db
    .select({ name: characters.name })
    .from(characters)
    .where(and(eq(characters.projectId, input.projectId), isNull(characters.deletedAt)))

  const known = new Set(existing.map((row) => row.name))
  const unlisted = await unlistedSpeakers(input.projectId)
  const byName = new Map(unlisted.map((row) => [row.name, row]))

  const created: string[] = []
  const skipped: string[] = []
  let linked = 0

  for (const raw of input.names) {
    const name = raw.trim()
    if (!name) continue
    if (known.has(name)) {
      skipped.push(name)
      continue
    }

    const found = byName.get(name)

    const [row] = await db
      .insert(characters)
      .values({
        projectId: input.projectId,
        name,
        gender: found?.gender ?? '',
        /*
         * 預設配角, never 主角. Somebody promoted from a line of dialogue is
         * a supporting character until a person says otherwise — and the tier
         * decides whether 體檢 complains about them never appearing.
         *
         * 可以指定，因為「周圍的百姓」跟「陸承安」不是同一種東西 (Z140)。
         */
        tier: input.tier ?? 'SUPPORTING',
        personality: found
          ? `從正文的對白認出來的：在 ${found.episodes.length} 集裡說了 ${found.lines} 句。`
          : '',
      })
      .returning({ id: characters.id })

    if (!row) continue
    created.push(name)
    known.add(name)

    /*
     * 回頭接線。沒有這一步，角色頁會說他出現於 0 集——P0-1 修過的毛病從另一
     * 個方向走回來。
     */
    const relinked = await db
      .update(episodeLineSpeakers)
      .set({ characterId: row.id, updatedAt: new Date() })
      .where(
        and(
          eq(episodeLineSpeakers.spokenAs, name),
          isNull(episodeLineSpeakers.characterId),
          inArray(
            episodeLineSpeakers.episodeId,
            db
              .select({ id: episodes.id })
              .from(episodes)
              .where(and(eq(episodes.projectId, input.projectId), isNull(episodes.deletedAt)))
          )
        )
      )
      .returning({ episodeId: episodeLineSpeakers.episodeId })

    linked += relinked.length
  }

  if (created.length > 0) {
    await logActivity({
      user: input.user,
      action: 'create',
      entityType: 'character',
      entityId: null,
      projectId: input.projectId,
      summary: `${input.user.name} 從正文把 ${created.length} 個人加進角色表：${created.join('、')}`,
    })
  }

  return { created, linked, skipped }
}
