import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 即時對話的核心保證（Z99）。
 *
 * 三件事錯了會很難追：序號重複、收回變成刪列、不是成員也讀得到。
 * 前兩件會讓重連的客戶端漏訊息或以為漏了，第三件是權限洞。
 */

const ready = testDatabaseReady()

describe.skipIf(!ready)('對話與訊息', () => {
  let db: typeof import('@/db').db
  let schema: typeof import('@/db/schema')
  let chat: typeof import('@/lib/chat')
  let userA = ''
  let userB = ''
  let conversationId = ''

  beforeAll(async () => {
    db = (await import('@/db')).db
    schema = await import('@/db/schema')
    chat = await import('@/lib/chat')

    const { hashPassword } = await import('@/lib/auth/password')
    const hash = await hashPassword('chat-test-password')

    const [a] = await db
      .insert(schema.users)
      .values({ email: 'chat-a@test.local', account: 'chatA', name: '甲', passwordHash: hash })
      .returning({ id: schema.users.id })
    const [b] = await db
      .insert(schema.users)
      .values({ email: 'chat-b@test.local', account: 'chatB', name: '乙', passwordHash: hash })
      .returning({ id: schema.users.id })

    userA = a!.id
    userB = b!.id
    conversationId = await chat.openDirectConversation(userA)
  })

  afterAll(async () => {
    const { inArray } = await import('drizzle-orm')
    if (conversationId) {
      await db.delete(schema.conversations).where(inArray(schema.conversations.id, [conversationId]))
    }
    if (userA && userB) {
      await db.delete(schema.users).where(inArray(schema.users.id, [userA, userB]))
    }
  })

  it('同一個成員再次開啟拿到同一個對話，不會每次新建', async () => {
    expect(await chat.openDirectConversation(userA)).toBe(conversationId)
  })

  it('序號連續遞增，不重複', async () => {
    const first = await chat.sendMessage({ conversationId, senderId: userA, body: '一' })
    const second = await chat.sendMessage({ conversationId, senderId: userB, body: '二' })
    const third = await chat.sendMessage({ conversationId, senderId: userA, body: '三' })

    expect(second.seq).toBe(first.seq + 1)
    expect(third.seq).toBe(second.seq + 1)
  })

  it('同時送出的訊息不會搶到同一個序號', async () => {
    // 這正是為什麼序號是在 transaction 裡用 UPDATE ... RETURNING 取的，
    // 而不是先讀 max(seq) 再加一。
    const sent = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        chat.sendMessage({ conversationId, senderId: userA, body: `並行 ${i}` })
      )
    )

    const seqs = sent.map((m) => m.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it('收回是留著列清空內容，不是刪列', async () => {
    const sent = await chat.sendMessage({ conversationId, senderId: userA, body: '要收回的' })
    const recalled = await chat.recallMessage(sent.id, userA)

    expect(recalled.id).toBe(sent.id)
    expect(recalled.seq).toBe(sent.seq)
    expect(recalled.body).toBe('')
    expect(recalled.recalledAt).not.toBeNull()

    // 序號沒有空洞，重連的客戶端才不會以為自己漏了。
    const since = await chat.messagesSince(conversationId, sent.seq - 1)
    expect(since.some((m) => m.id === sent.id)).toBe(true)
  })

  it('只能收回自己送出的訊息', async () => {
    const sent = await chat.sendMessage({ conversationId, senderId: userA, body: '別人的' })

    await expect(chat.recallMessage(sent.id, userB)).rejects.toThrow()
  })

  it('已收回的訊息不能再編輯', async () => {
    const sent = await chat.sendMessage({ conversationId, senderId: userA, body: '先收回' })
    await chat.recallMessage(sent.id, userA)

    await expect(chat.editMessage(sent.id, userA, '改掉')).rejects.toThrow()
  })

  it('不是成員就讀不到', async () => {
    const { hashPassword } = await import('@/lib/auth/password')
    const [outsider] = await db
      .insert(schema.users)
      .values({
        email: 'chat-c@test.local',
        account: 'chatC',
        name: '丙',
        passwordHash: await hashPassword('chat-test-password'),
      })
      .returning({ id: schema.users.id })

    try {
      // openDirectConversation 把工作室裡的每個人都放進同一個對話，
      // 所以這裡用一個刻意不在成員表裡的對話來測。
      const [lonely] = await db
        .insert(schema.conversations)
        .values({})
        .returning({ id: schema.conversations.id })

      await expect(chat.assertMember(lonely!.id, outsider!.id)).rejects.toThrow()

      const { eq } = await import('drizzle-orm')
      await db.delete(schema.conversations).where(eq(schema.conversations.id, lonely!.id))
    } finally {
      const { eq } = await import('drizzle-orm')
      await db.delete(schema.users).where(eq(schema.users.id, outsider!.id))
    }
  })

  it('已讀標記只會往前走', async () => {
    const sent = await chat.sendMessage({ conversationId, senderId: userA, body: '已讀測試' })

    await chat.markRead(conversationId, userB, sent.seq)
    // 一個落後的分頁追上來，不應該把已讀退回去。
    await chat.markRead(conversationId, userB, sent.seq - 3)

    const state = await chat.conversationState(conversationId)
    const member = state.members.find((m) => m.userId === userB)
    expect(member?.readSeq).toBe(sent.seq)
  })

  it('空的文字訊息送不出去', async () => {
    await expect(
      chat.sendMessage({ conversationId, senderId: userA, body: '   ' })
    ).rejects.toThrow()
  })

  it('搜尋找得到歷史訊息', async () => {
    await chat.sendMessage({ conversationId, senderId: userA, body: '沈知味的廚房很香' })

    const hits = await chat.listMessages({ conversationId, search: '廚房' })
    expect(hits.some((m) => m.body.includes('廚房'))).toBe(true)
  })
})

/**
 * ICE 伺服器設定（Z99）。
 *
 * 這組值原本寫死在元件裡：要加 TURN——通話真的穿不過 NAT 時唯一的解法——
 * 就得改程式碼重新部署，而帳密會留在版本庫裡。
 */
describe('ICE 伺服器設定', () => {
  it('沒設定時給 Google 的 STUN', async () => {
    const { DEFAULT_ICE_SERVERS } = await import('@/lib/settings')

    expect(DEFAULT_ICE_SERVERS[0]?.urls.some((u) => u.startsWith('stun:'))).toBe(true)
    // 沒有 TURN 是刻意的：要錢，而且大多數通話用不到。
    expect(DEFAULT_ICE_SERVERS.some((s) => s.urls.some((u) => u.startsWith('turn:')))).toBe(false)
  })

  it.skipIf(!ready)('存得進也讀得回 TURN 的帳密', async () => {
    const { getIceServers, setIceServers, DEFAULT_ICE_SERVERS } = await import('@/lib/settings')
    const db = (await import('@/db')).db
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const [someone] = await db.select({ id: schema.users.id }).from(schema.users).limit(1)
    if (!someone) return

    try {
      await setIceServers(
        [
          { urls: ['stun:stun.example.com:3478'] },
          { urls: ['turn:turn.example.com:3478'], username: 'u', credential: 'p' },
        ],
        someone.id
      )

      const read = await getIceServers()
      expect(read).toHaveLength(2)
      expect(read[1]?.username).toBe('u')
      expect(read[1]?.credential).toBe('p')
    } finally {
      await db.delete(schema.appSettings).where(eq(schema.appSettings.key, 'call.iceServers'))
    }

    // 刪掉設定就回到預設，不是回到空陣列——空陣列會讓每一通都接不起來。
    expect(await getIceServers()).toEqual(DEFAULT_ICE_SERVERS)
  })

  it.skipIf(!ready)('沒有網址的那一列會被丟掉，不是整張表作廢', async () => {
    const { setIceServers, getIceServers } = await import('@/lib/settings')
    const db = (await import('@/db')).db
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const [someone] = await db.select({ id: schema.users.id }).from(schema.users).limit(1)
    if (!someone) return

    try {
      await setIceServers(
        [
          { urls: [] },
          { urls: ['stun:good.example.com:3478'] },
        ],
        someone.id
      )

      const read = await getIceServers()
      expect(read).toHaveLength(1)
      expect(read[0]?.urls[0]).toBe('stun:good.example.com:3478')
    } finally {
      await db.delete(schema.appSettings).where(eq(schema.appSettings.key, 'call.iceServers'))
    }
  })
})

/**
 * Cloudflare TURN 回傳的 iceServers 整理（Z99）。
 *
 * 他們自己的文件說 port 53 那個網址在瀏覽器裡常常逾時，而一個會卡住的
 * candidate 會拖慢整個收集階段——所以要濾掉。
 */
describe('TURN 回應整理', () => {
  // 與 src/lib/turn.ts 的 normalise 同一套規則。
  function normalise(value: unknown) {
    if (!Array.isArray(value)) return []
    const out: { urls: string[]; username?: string; credential?: string }[] = []

    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      const urls = (Array.isArray(row.urls) ? row.urls : [row.urls])
        .filter((u): u is string => typeof u === 'string' && u.length > 0)
        .filter((u) => !u.includes(':53?') && !u.endsWith(':53'))
      if (urls.length === 0) continue
      out.push({
        urls,
        ...(typeof row.username === 'string' ? { username: row.username } : {}),
        ...(typeof row.credential === 'string' ? { credential: row.credential } : {}),
      })
    }
    return out
  }

  it('留住 TURN 的帳密', () => {
    const parsed = normalise([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      {
        urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
        username: 'minted-user',
        credential: 'minted-secret',
      },
    ])

    expect(parsed).toHaveLength(2)
    expect(parsed[1]?.username).toBe('minted-user')
    expect(parsed[1]?.credential).toBe('minted-secret')
  })

  it('濾掉 port 53 的網址', () => {
    const parsed = normalise([
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turn:turn.cloudflare.com:53?transport=udp',
          'turn:turn.cloudflare.com:53',
        ],
        username: 'u',
        credential: 'p',
      },
    ])

    expect(parsed[0]?.urls).toEqual(['turn:turn.cloudflare.com:3478?transport=udp'])
  })

  it('整列只剩 port 53 的話整列丟掉，不留一個空的 urls', () => {
    // 空的 urls 會讓瀏覽器整份設定都拒絕。
    expect(normalise([{ urls: ['turn:turn.cloudflare.com:53'] }])).toHaveLength(0)
  })

  it('形狀不對就回空陣列，不是丟例外', () => {
    expect(normalise(null)).toEqual([])
    expect(normalise({ nope: true })).toEqual([])
    expect(normalise([{ urls: [] }, 'garbage', 42])).toEqual([])
  })
})
