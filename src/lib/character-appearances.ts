import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { characters, chapters, documents, episodeCharacters, episodes, scenes } from '@/db/schema'
import { knownNames } from '@/lib/narration'
import { stripHtmlToText } from '@/lib/utils'

/**
 * 角色在哪幾集出場 (P0-1).
 *
 * `episode_characters` had three `SELECT`s against it and **no `INSERT`
 * anywhere** — no screen to tag a character into an episode, nothing deriving
 * it. So 沈知味, who is on the first page of EP001, read 「出現於 0 集」.
 *
 * Derived from the writing rather than asking anyone to maintain a list,
 * because a list that has to be kept in step with the prose is a list that
 * goes out of step with the prose. 小說 and 劇本 are counted separately:
 * a character written into an episode is not yet a character in its script,
 * and collapsing the two hides exactly the gap worth seeing.
 *
 * **What this cannot see is a character who is not named.** 許山河 is 「那名
 * 男子」 for most of EP003 and only named in its last lines; a scene where
 * somebody is present but unnamed leaves no trace to match. That is what the
 * `manual` flag is for, and why the sync never removes a row carrying it.
 */

/** Matching needs a name worth matching: one character is too many false hits. */
const MIN_NAME = 2

type Appearance = { episodeId: string; characterId: string; novel: boolean; script: boolean }

/** Recomputes every derived appearance for a project. */
export async function syncAppearances(projectId: string): Promise<number> {
  const cast = await db
    .select({ id: characters.id, name: characters.name, alias: characters.alias })
    .from(characters)
    .where(and(eq(characters.projectId, projectId), isNull(characters.deletedAt)))

  const names = knownNames(cast).filter((entry) =>
    entry.labels.some((label) => label.length >= MIN_NAME)
  )
  if (names.length === 0) return 0

  const episodeRows = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))

  if (episodeRows.length === 0) return 0
  const episodeIds = episodeRows.map((row) => row.id)

  /*
   * One query per kind rather than per episode. 120 episodes × 2 kinds would
   * otherwise be 240 round trips to decide something nobody is waiting on.
   */
  const [novelRows, scriptRows] = await Promise.all([
    db
      .select({ episodeId: documents.episodeId, content: chapters.content })
      .from(chapters)
      .innerJoin(documents, eq(documents.id, chapters.documentId))
      .where(
        and(
          inArray(documents.episodeId, episodeIds),
          eq(documents.kind, 'NOVEL'),
          isNull(documents.deletedAt)
        )
      )
      .orderBy(asc(chapters.sortOrder)),
    db
      .select({ episodeId: documents.episodeId, content: scenes.content })
      .from(scenes)
      .innerJoin(documents, eq(documents.id, scenes.documentId))
      .where(
        and(
          inArray(documents.episodeId, episodeIds),
          eq(documents.kind, 'SCRIPT'),
          isNull(documents.deletedAt)
        )
      )
      .orderBy(asc(scenes.sortOrder)),
  ])

  const textOf = (rows: { episodeId: string | null; content: string }[]) => {
    const map = new Map<string, string>()
    for (const row of rows) {
      if (!row.episodeId) continue
      map.set(row.episodeId, (map.get(row.episodeId) ?? '') + '\n' + stripHtmlToText(row.content))
    }
    return map
  }

  const novelText = textOf(novelRows)
  const scriptText = textOf(scriptRows)

  const found: Appearance[] = []

  for (const episodeId of episodeIds) {
    const novel = novelText.get(episodeId) ?? ''
    const script = scriptText.get(episodeId) ?? ''
    if (!novel && !script) continue

    for (const entry of names) {
      const labels = entry.labels.filter((label) => label.length >= MIN_NAME)
      const inNovel = labels.some((label) => novel.includes(label))
      const inScript = labels.some((label) => script.includes(label))
      if (inNovel || inScript) {
        found.push({ episodeId, characterId: entry.id, novel: inNovel, script: inScript })
      }
    }
  }

  await db.transaction(async (tx) => {
    /*
     * Clear the derived rows first, so a character written out of an episode
     * stops appearing in it. Rows a person added survive — they are an answer
     * this cannot produce, and silently discarding them would teach everyone
     * not to bother tagging.
     */
    await tx
      .delete(episodeCharacters)
      .where(
        and(inArray(episodeCharacters.episodeId, episodeIds), eq(episodeCharacters.manual, false))
      )

    if (found.length === 0) return

    await tx
      .insert(episodeCharacters)
      .values(
        found.map((row) => ({
          episodeId: row.episodeId,
          characterId: row.characterId,
          fromNovel: row.novel,
          fromScript: row.script,
          manual: false,
        }))
      )
      /*
       * A manual row for the same pair already exists: keep it, and record
       * that the text agrees. Replacing it would drop its note.
       */
      .onConflictDoUpdate({
        target: [episodeCharacters.episodeId, episodeCharacters.characterId],
        set: {
          fromNovel: sql`excluded.from_novel`,
          fromScript: sql`excluded.from_script`,
        },
      })
  })

  return found.length
}

export type AppearanceSummary = {
  characterId: string
  /** Episodes whose prose names them. */
  novel: number
  /** Episodes whose script names them. */
  script: number
  /** Episodes tagged by a person, however they appear. */
  manual: number
  /** Distinct episodes, any source — what 「出現於 N 集」 means. */
  total: number
  /** Episode numbers, ascending, for showing which. */
  episodeNumbers: number[]
}

/** Per-character appearance counts, split by where they came from. */
export async function appearanceSummary(projectId: string): Promise<AppearanceSummary[]> {
  const rows = await db
    .select({
      characterId: episodeCharacters.characterId,
      number: episodes.number,
      fromNovel: episodeCharacters.fromNovel,
      fromScript: episodeCharacters.fromScript,
      manual: episodeCharacters.manual,
    })
    .from(episodeCharacters)
    .innerJoin(episodes, eq(episodes.id, episodeCharacters.episodeId))
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
    .orderBy(asc(episodes.number))

  const byCharacter = new Map<string, AppearanceSummary>()

  for (const row of rows) {
    const summary = byCharacter.get(row.characterId) ?? {
      characterId: row.characterId,
      novel: 0,
      script: 0,
      manual: 0,
      total: 0,
      episodeNumbers: [],
    }

    if (row.fromNovel) summary.novel += 1
    if (row.fromScript) summary.script += 1
    if (row.manual) summary.manual += 1
    summary.total += 1
    summary.episodeNumbers.push(row.number)

    byCharacter.set(row.characterId, summary)
  }

  return [...byCharacter.values()]
}
