import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 在**本機測試庫**建一組最小的分鏡資料 (Z184).
 *
 * `scripts/probe-vocabulary.mjs` 要有一個帶鏡頭的作品才跑得起來，而自訂下拉
 * 的那張表（`vocabulary_terms`）是這一輪才建的——正式庫還沒套 migration，而
 * 套它是上線動作。所以那支 probe 跑在本機這一座上，而這裡負責給它東西看。
 *
 * **只碰 `TEST_DATABASE_URL`**，寫死在下面兩行：這支會建作品、刪作品，而那
 * 不是可以靠「希望環境變數是對的」來保證的事。
 *
 *     npx tsx scripts/seed-local-storyboard.ts        # 建
 *     npx tsx scripts/seed-local-storyboard.ts drop   # 連自訂詞一起清掉
 */
const url = process.env.TEST_DATABASE_URL!
process.env.DATABASE_URL = url
process.env.DATABASE_URL_UNPOOLED = url

async function main() {
  const { db } = await import('../src/db')
  const schema = await import('../src/db/schema')
  const { eq } = await import('drizzle-orm')

  const SLUG = 'z184-fixture'
  const [old] = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.slug, SLUG))
  if (process.argv[2] === 'drop') {
    if (old) await db.delete(schema.projects).where(eq(schema.projects.id, old.id))
    await db.delete(schema.vocabularyTerms)
    console.log('清掉了')
    process.exit(0)
  }
  if (old) { console.log('已經有了：', old.id); process.exit(0) }

  const [project] = await db.insert(schema.projects)
    .values({ title: 'Z184 驗收用', slug: SLUG, logline: '本機測試庫專用' })
    .returning({ id: schema.projects.id })
  const [arc] = await db.insert(schema.arcs)
    .values({ projectId: project!.id, index: 1, title: '卷一' })
    .returning({ id: schema.arcs.id })
  const [ep] = await db.insert(schema.episodes)
    .values({ projectId: project!.id, arcId: arc!.id, number: 1, title: '第一集' })
    .returning({ id: schema.episodes.id })
  /*
   * 兩個角色，因為「一鏡多人說話」要**兩個**才證明得了（Z194）。
   *
   * 只有一個角色的話挑選器會長出來、點得下去、probe 全綠——而綠的理由是沒有
   * 第二個人可以點。
   */
  await db.insert(schema.characters).values([
    { projectId: project!.id, name: '沈知味', tier: 'LEAD' },
    { projectId: project!.id, name: '錢管事', tier: 'SUPPORTING' },
  ])
  await db.insert(schema.shots).values([
    { episodeId: ep!.id, order: 1, sceneCode: 'S01', action: '沈知味推開門' },
    { episodeId: ep!.id, order: 2, sceneCode: 'S01', action: '灶火燒起來' },
  ])
  console.log(JSON.stringify({ projectId: project!.id, episodeId: ep!.id }))
  process.exit(0)
}
void main()
