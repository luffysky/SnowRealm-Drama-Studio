import { loadEnv } from '../src/lib/load-env'
import type { SessionUser } from '../src/lib/auth/session'
loadEnv()

/**
 * 建立 → 移動 → 樂觀鎖擋得住嗎 (Z89).
 *
 * 最後一步才是重點：帶一個過期的 lockRevision 必須被拒絕。擋不住的話，
 * 兩個人同時改同一張卡，後寫的會安靜地蓋掉先寫的。
 */
async function main() {
  const { db } = await import('../src/db')
  const { users, tasks } = await import('../src/db/schema')
  const { eq } = await import('drizzle-orm')
  const { mainProject } = await import('./helpers/main-project')
  const { taskBoard, createTask, updateTask } = await import('../src/lib/tasks')

  const project = await mainProject()
  const [row] = await db.select().from(users).limit(1)
  if (!row) throw new Error('沒有使用者')
  const user: SessionUser = { ...row, displayCurrency: 'TWD' } as SessionUser

  const created = await createTask({
    projectId: project.id,
    title: '【驗證用】樂觀鎖測試',
    priority: 'HIGH',
    user,
  })
  console.log(`  建立：${created.id}`)

  let board = await taskBoard(user.id)
  const card = board.columns.flatMap((c) => c.tasks).find((t) => t.id === created.id)
  console.log(`  列表讀得到：${card ? '✓' : '✗'}  狀態 ${card?.status}  版本 ${card?.lockRevision}`)
  if (!card) throw new Error('建立後列表讀不到')

  const moved = await updateTask({
    taskId: card.id,
    lockRevision: card.lockRevision,
    patch: { status: 'DOING' },
    user,
  })
  console.log(`  移到 DOING：✓  版本變成 ${moved.lockRevision}`)

  // 用剛才那個（已經過期的）版本再改一次——必須被擋。
  try {
    await updateTask({
      taskId: card.id,
      lockRevision: card.lockRevision,
      patch: { status: 'DONE' },
      user,
    })
    console.log('  用過期版本再改：✗ 居然成功了——樂觀鎖沒有在擋')
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.log(`  用過期版本再改：✓ 被擋下來`)
    console.log(`    「${message}」`)
  }

  board = await taskBoard(user.id)
  const after = board.columns.flatMap((c) => c.tasks).find((t) => t.id === created.id)
  console.log(`  現在狀態：${after?.status}（應該還是 DOING，不是 DONE）`)

  await db.delete(tasks).where(eq(tasks.id, created.id))
  console.log('  驗證用的卡片已刪除')

  process.exit(0)
}

void main()
