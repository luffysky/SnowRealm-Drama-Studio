import { loadEnv } from '../src/lib/load-env'
import type { SessionUser } from '../src/lib/auth/session'
loadEnv()

/**
 * 建立 → 交換順序 → 刪除遞補 (Z39).
 *
 * 中間那一步才是重點。`unique(episode_id, order)` **不是 deferrable**，所以
 * 「A 設成 2、B 設成 1」會在第一句 UPDATE 就撞上去，而撞的方式是整個交易回
 * 滾——從介面上看就是「按了上移沒反應」。`moveShot` 用三步繞過它，而這支
 * probe 就是在問那三步到底成不成立。
 *
 * 最後一步問的是刪除之後序號有沒有往前遞補：留著 1、2、4 這種洞，之後每一
 * 次 move 都會挪不動（找不到相鄰的那一格）。
 */
async function main() {
  const { db } = await import('../src/db')
  const { users, shots } = await import('../src/db/schema')
  const { and, asc, eq } = await import('drizzle-orm')
  const { mainProject } = await import('./helpers/main-project')
  const { storyboardIndex, storyboardFor, createShot, moveShot, deleteShot } = await import(
    '../src/lib/storyboard'
  )

  const project = await mainProject()
  const [row] = await db.select().from(users).limit(1)
  if (!row) throw new Error('沒有使用者')
  const user: SessionUser = { ...row, displayCurrency: 'TWD' } as SessionUser

  const index = await storyboardIndex(project.id)
  const episode = index[0]
  if (!episode) throw new Error('這部作品沒有集數')
  console.log(`  作品《${project.title}》第 ${episode.number} 集，目前 ${episode.shotCount} 個鏡頭`)

  const before = await db
    .select({ id: shots.id, order: shots.order })
    .from(shots)
    .where(eq(shots.episodeId, episode.id))
    .orderBy(asc(shots.order))

  // 三個鏡頭，秒數刻意不同，這樣交換之後看得出來誰是誰。
  const made: string[] = []
  for (const [i, seconds] of [3, 7, 11].entries()) {
    const shot = await createShot({
      projectId: project.id,
      episodeId: episode.id,
      patch: { durationSec: seconds, action: `【驗證用】第 ${i + 1} 個`, sceneCode: 'SZZ' },
      user,
    })
    made.push(shot.id)
    console.log(`  建立：序號 ${shot.order}，${seconds} 秒`)
  }

  const view = await storyboardFor(project.id, episode.id)
  if (!view) throw new Error('讀不到這一集的分鏡')
  const mine = view.shots.filter((shot) => made.includes(shot.id))
  console.log(
    `  讀得到：${mine.length === 3 ? '✓' : '✗'}  ` +
      `秒數 ${mine.map((shot) => shot.durationSec).join('、')}`
  )
  console.log(
    `  總長校驗：${view.duration.totalSec} 秒 / 目標 ${view.duration.targetSec} 秒 ` +
      `→ ${view.duration.verdict}`
  )

  // --- 交換順序：這一步是 unique 約束會不會炸的關鍵 --------------------
  const middle = mine[1]!
  const movedTo = await moveShot({
    projectId: project.id,
    shotId: middle.id,
    direction: 'up',
    user,
  })
  const afterMove = await db
    .select({ id: shots.id, order: shots.order, durationSec: shots.durationSec })
    .from(shots)
    .where(eq(shots.episodeId, episode.id))
    .orderBy(asc(shots.order))

  const movedRow = afterMove.find((shot) => shot.id === middle.id)
  console.log(
    `  上移 7 秒那一格：${movedRow?.order === movedTo.order ? '✓' : '✗'} ` +
      `序號 ${middle.order} → ${movedRow?.order}`
  )
  console.log(
    `  現在的秒數順序：${afterMove
      .filter((shot) => made.includes(shot.id))
      .map((shot) => shot.durationSec)
      .join('、')}（應該是 7、3、11）`
  )

  // 序號有沒有重複或留洞——unique 約束本來就擋重複，這裡看的是有沒有洞。
  const orders = afterMove.map((shot) => shot.order)
  const gapless = orders.every((value, i) => value === i + 1)
  console.log(`  序號連續不留洞：${gapless ? '✓' : `✗（${orders.join('、')}）`}`)

  // --- 刪除：後面的要往前遞補 -------------------------------------------
  const first = afterMove.find((shot) => made.includes(shot.id))!
  await deleteShot({ projectId: project.id, shotId: first.id, user })

  const afterDelete = await db
    .select({ order: shots.order })
    .from(shots)
    .where(eq(shots.episodeId, episode.id))
    .orderBy(asc(shots.order))
  const stillGapless = afterDelete.every((shot, i) => shot.order === i + 1)
  console.log(
    `  刪掉一個之後序號仍連續：${stillGapless ? '✓' : `✗（${afterDelete.map((s) => s.order).join('、')}）`}`
  )

  // --- 收尾：把驗證用的鏡頭清乾淨 ---------------------------------------
  for (const id of made) {
    await db.delete(shots).where(eq(shots.id, id))
  }
  // 序號補回原本的樣子，不要把驗證留下的洞丟給下一個人。
  const left = await db
    .select({ id: shots.id })
    .from(shots)
    .where(eq(shots.episodeId, episode.id))
    .orderBy(asc(shots.order))
  for (const [i, shot] of left.entries()) {
    await db
      .update(shots)
      .set({ order: i + 1 })
      .where(and(eq(shots.id, shot.id), eq(shots.episodeId, episode.id)))
  }
  console.log(
    `  驗證用的鏡頭已清除（原本 ${before.length} 個，現在 ${left.length} 個）`
  )
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
