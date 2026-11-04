import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { assets, audioMetadata } from '@/db/schema'

/**
 * 這個作品已經用過的風格與情緒標籤 (Z119).
 *
 * Offered on the form beside the preset list, so the studio's own vocabulary
 * ends up on the buttons without anyone maintaining a list — and so the second
 * upload can click the word the first one invented instead of retyping it
 * slightly differently.
 */
export async function usedMusicTags(
  projectId: string
): Promise<{ genre: string[]; mood: string[] }> {
  const [row] = await db
    .select({
      genre: sql<string[]>`coalesce(array_agg(distinct g) filter (where g is not null and g <> ''), '{}')`,
      mood: sql<string[]>`coalesce(array_agg(distinct m) filter (where m is not null and m <> ''), '{}')`,
    })
    .from(audioMetadata)
    .innerJoin(assets, eq(assets.id, audioMetadata.assetId))
    .leftJoin(sql`lateral unnest(${audioMetadata.genreTags}) as g`, sql`true`)
    .leftJoin(sql`lateral unnest(${audioMetadata.moodTags}) as m`, sql`true`)
    .where(and(eq(assets.projectId, projectId), isNull(assets.deletedAt)))

  return { genre: row?.genre ?? [], mood: row?.mood ?? [] }
}
