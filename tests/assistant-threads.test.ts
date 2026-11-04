import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 助理搬出共用對話之後，該成立的事（Z100）。
 *
 * 最重要的一條是分隔本身：助理的執行路徑必須擋下兩個人的那條對話。
 * 如果擋不下來，那整個搬出來的動作等於沒做——客戶端只要把 DIRECT 的 id
 * 傳進去，兩個人的私下對話就會被送給模型。
 *
 * 第二條是 openDirectConversation 不會誤抓到助理的對話串。它原本的查法是
 * 「我所屬的第一個對話」，而助理的對話串我也是成員，所以沒有加 kind 條件
 * 的話，「訊息」那一頁會打開一條裡面有模型的對話。
 */

const ready = testDatabaseReady()

describe.skipIf(!ready)('助理對話串', () => {
  let db: typeof import('@/db').db
  let schema: typeof import('@/db/schema')
  let chat: typeof import('@/lib/chat')
  let threads: typeof import('@/lib/assistant/threads')
  let mine = ''
  let theirs = ''
  let directId = ''

  beforeAll(async () => {
    db = (await import('@/db')).db
    schema = await import('@/db/schema')
    chat = await import('@/lib/chat')
    threads = await import('@/lib/assistant/threads')

    const { hashPassword } = await import('@/lib/auth/password')
    const hash = await hashPassword('thread-test-password')

    const [a] = await db
      .insert(schema.users)
      .values({ email: 'thr-a@test.local', account: 'thrA', name: '甲', passwordHash: hash })
      .returning({ id: schema.users.id })
    const [b] = await db
      .insert(schema.users)
      .values({ email: 'thr-b@test.local', account: 'thrB', name: '乙', passwordHash: hash })
      .returning({ id: schema.users.id })

    mine = a!.id
    theirs = b!.id
    directId = await chat.openDirectConversation(mine)
  })

  afterAll(async () => {
    const { inArray } = await import('drizzle-orm')
    if (mine && theirs) {
      // Conversations cascade from their owner, and the direct one is deleted
      // explicitly because it has no owner.
      await db.delete(schema.conversations).where(inArray(schema.conversations.id, [directId]))
      await db.delete(schema.users).where(inArray(schema.users.id, [mine, theirs]))
    }
  })

  it('第一次開啟會建一條，之後再開拿到同一條', async () => {
    const first = await threads.openThread(mine)
    expect(await threads.openThread(mine)).toBe(first)
  })

  it('兩個人的對話不會被當成助理的對話串', async () => {
    // 這是 assertOwnThread 比 assertMember 嚴格的理由：我是 DIRECT 的成員，
    // 所以單看成員資格擋不住它。
    await expect(threads.assertOwnThread(directId, mine)).rejects.toThrow()
  })

  it('別人的助理對話串我打不開', async () => {
    const hers = await threads.createThread(theirs, '她的')
    await expect(threads.assertOwnThread(hers.id, mine)).rejects.toThrow()
    await threads.deleteThread(hers.id, theirs)
  })

  it('openDirectConversation 不會誤抓到助理的對話串', async () => {
    await threads.createThread(mine, '一')
    await threads.createThread(mine, '二')
    expect(await chat.openDirectConversation(mine)).toBe(directId)
  })

  it('列表只有自己的，最近用到的在前面', async () => {
    const older = await threads.createThread(mine, '比較舊')
    const newer = await threads.createThread(mine, '比較新')

    const rows = await threads.listThreads(mine)
    const ids = rows.map((row) => row.id)

    expect(ids).toContain(older.id)
    expect(ids).toContain(newer.id)
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id))

    const hers = await threads.createThread(theirs, '她的')
    expect((await threads.listThreads(mine)).map((row) => row.id)).not.toContain(hers.id)
    await threads.deleteThread(hers.id, theirs)
  })

  it('列表帶出最後一句話當預覽', async () => {
    const thread = await threads.createThread(mine, '有話的')
    await chat.sendMessage({ conversationId: thread.id, senderId: mine, body: '第三集在講什麼' })
    await chat.sendMessage({
      conversationId: thread.id,
      senderId: null,
      body: '第三集叫〈一枚銅牌，半碗人間〉。',
      fromAssistant: true,
    })

    const row = (await threads.listThreads(mine)).find((item) => item.id === thread.id)
    expect(row?.preview).toContain('一枚銅牌')
    expect(row?.messageCount).toBe(2)
  })

  it('沒命名的對話串會用第一句話命名，命過名的不會被蓋掉', async () => {
    const auto = await threads.createThread(mine)
    await threads.titleFromFirstMessage(auto.id, '/outline 幫第四集寫大綱')
    let row = (await threads.listThreads(mine)).find((item) => item.id === auto.id)
    // 指令本身不是標題的一部分。
    expect(row?.title).toBe('幫第四集寫大綱')

    await threads.titleFromFirstMessage(auto.id, '後來又說了別的')
    row = (await threads.listThreads(mine)).find((item) => item.id === auto.id)
    expect(row?.title).toBe('幫第四集寫大綱')
  })

  it('改名只有自己改得動', async () => {
    const thread = await threads.createThread(mine, '原本')
    await expect(threads.renameThread(thread.id, theirs, '偷改')).rejects.toThrow()

    const renamed = await threads.renameThread(thread.id, mine, '改好了')
    expect(renamed.title).toBe('改好了')
  })

  it('刪除會把裡面的訊息一起帶走', async () => {
    const { eq } = await import('drizzle-orm')
    const thread = await threads.createThread(mine, '要刪的')
    await chat.sendMessage({ conversationId: thread.id, senderId: mine, body: '這則會不見' })

    await expect(threads.deleteThread(thread.id, theirs)).rejects.toThrow()
    await threads.deleteThread(thread.id, mine)

    const left = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, thread.id))
    expect(left).toHaveLength(0)
  })
})
