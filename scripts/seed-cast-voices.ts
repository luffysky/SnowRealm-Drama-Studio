import { loadEnv } from '../src/lib/load-env'
// 型別匯入在編譯時就消失了，所以不會在 loadEnv() 之前把模組拉進來。
import type { SessionUser } from '../src/lib/auth/session'
loadEnv()

/**
 * 把說過話的人建進角色表，然後釘住他們的音色 (Z140).
 *
 * 兩件事，兩個理由。
 *
 * ## 為什麼要建
 *
 * 角色表裡只有沈知味一個人，而正文裡有九個人說過話。不在表裡的人配得到
 * 聲音（對白歸屬給的），但**那個聲音每次都可能不一樣**：`assignVoices` 照
 * 角色 id 排序發下去，表一變、順序就變、後面所有人的聲音就換人。
 *
 * ## 分級不是裝飾
 *
 * 「周圍的百姓」「看熱鬧的攤販」「路人」**不是角色**，是群眾。建成配角會讓
 * 體檢去抱怨他們沒有成長弧線、沒有定妝照——那是噪音，而噪音會讓人不再看
 * 體檢。所以群眾建成 EXTRA，單獨出場的無名氏建成 MINOR，有名有姓的才是
 * SUPPORTING。
 *
 * ## 釘音色的規則是機械的，不是審美的
 *
 * 「誰聽起來像沈知味」我判斷不了，那要耳朵。所以這支只做兩件說得清楚的事：
 *
 *  1. **把現在這一輪的分配凍結下來。** 不是換成別的，就是讓它停止漂移。
 *  2. **換掉改不動破音字的那幾個。** 那是純粹的損失，沒有任何補償——使用者
 *     已經聽到「還錢」唸成 ㄏㄞˊ 錢了。
 *
 * 剩下的用角色頁的音色選擇器按耳朵改。這支只負責讓起點是穩的。
 */

/** 誰是群眾，誰是單獨出場的無名氏。按正文判斷，不是按句數。 */
const TIERS: Record<string, 'SUPPORTING' | 'MINOR' | 'EXTRA'> = {
  錢管事: 'SUPPORTING',
  陸承安: 'SUPPORTING',
  婦人: 'MINOR',
  老伯: 'MINOR',
  小男孩: 'MINOR',
  賣包子的嬸子: 'MINOR',
  路人: 'EXTRA',
  看熱鬧的攤販: 'EXTRA',
  周圍的百姓: 'EXTRA',
}

async function main() {
  const { db } = await import('../src/db')
  const { characters, projects, users } = await import('../src/db/schema')
  const { and, eq, isNull } = await import('drizzle-orm')
  const { promoteSpeakers, unlistedSpeakers } = await import('../src/lib/attribution-job')
  const { voicePool } = await import('../src/lib/azure/speech')
  const { assignVoices } = await import('../src/lib/narration')
  const { canCorrect } = await import('../src/lib/tts/pronounce')

  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .orderBy(projects.createdAt)
    .limit(1)
  if (!project) throw new Error('沒有作品')

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      title: users.title,
      role: users.role,
      color: users.color,
      displayCurrency: users.displayCurrency,
    })
    .from(users)
    .where(eq(users.email, 'luffysky00@gmail.com'))
    .limit(1)
  if (!row) throw new Error('找不到使用者')
  // `display_currency` 在資料庫裡是純文字欄位，型別上比 SessionUser 寬。
  const user: SessionUser = { ...row, displayCurrency: 'TWD' }

  /* ------------------------------------------------------------ 建角色 */

  const unlisted = await unlistedSpeakers(project.id)
  console.log(`  正文裡說過話卻不在表裡：${unlisted.length} 個\n`)

  // 分級分批送。`promoteSpeakers` 一次只接一個分級，而那是對的——分級是
  // 人的判斷，不該讓一個函式去猜。
  for (const tier of ['SUPPORTING', 'MINOR', 'EXTRA'] as const) {
    const names = unlisted.map((r) => r.name).filter((name) => TIERS[name] === tier)
    if (names.length === 0) continue

    const result = await promoteSpeakers({
      projectId: project.id,
      names,
      tier,
      user,
    })

    console.log(`  ${tier.padEnd(11)} 建了 ${result.created.length} 個：${result.created.join('、') || '（無）'}`)
    if (result.linked > 0) console.log(`              回頭接上 ${result.linked} 句已歸屬的對白`)
    if (result.skipped.length > 0) console.log(`              已經有了：${result.skipped.join('、')}`)
  }

  const unknown = unlisted.map((r) => r.name).filter((name) => !TIERS[name])
  if (unknown.length > 0) {
    console.log(`\n  這幾個沒分級，所以沒建（要自己到介面上挑）：${unknown.join('、')}`)
  }

  /* ------------------------------------------------------------ 釘音色 */

  const pool = await voicePool()
  const narrator = pool.find((voice) => voice.speaksChinese)?.id ?? ''

  const cast = await db
    .select({
      id: characters.id,
      name: characters.name,
      gender: characters.gender,
      tier: characters.tier,
      voiceId: characters.voiceId,
    })
    .from(characters)
    .where(and(eq(characters.projectId, project.id), isNull(characters.deletedAt)))

  const slots = assignVoices(
    cast.map((c) => ({
      id: c.id,
      name: c.name,
      gender: c.gender ?? '',
      tier: c.tier,
      ...(c.voiceId ? { voiceId: c.voiceId } : {}),
    })),
    pool.map((voice) => ({
      id: voice.id,
      lang: voice.locale,
      gender: voice.gender,
      speaksChinese: voice.speaksChinese,
    })),
    [narrator]
  )

  /** 已經用掉的音色，包括旁白。重複等於兩個角色同一把嗓子。 */
  const taken = new Set<string>([narrator])

  console.log(`\n  旁白：${narrator}\n`)

  for (const member of cast) {
    if (member.voiceId) {
      taken.add(member.voiceId)
      console.log(`  ${member.name.padEnd(10)} 已經釘過了，不動：${member.voiceId}`)
      continue
    }

    const assigned = slots[member.id]?.voiceId ?? null
    let pick = assigned

    /*
     * 兩個換掉的理由，要分清楚是哪一個。
     *
     *  - **改不動破音字** —— `IGNORES_PHONEME` 裡那四個收下 `<phoneme>`
     *    然後忽略，於是「還錢」就是會唸成 ㄏㄞˊ 錢。純粹的損失。
     *  - **撞到別人** —— `slots` 是照還沒釘的狀態算一次的，而這個迴圈邊走
     *    邊釘。前面有人因為第一個理由被換到某個音色，後面原本分到那個音色
     *    的人就撞上了。這是這支腳本自己造成的，不是分配壞了。
     *
     * 第一版的訊息把兩個都寫成「改不動破音字」，於是記錄裡有兩行是假的。
     */
    const cannotCorrect = Boolean(pick) && !canCorrect(pick!)
    const collides = Boolean(pick) && taken.has(pick!)

    if (!pick || cannotCorrect || collides) {
      const wantFemale = /女/.test(member.gender ?? '')
      const wantMale = /男/.test(member.gender ?? '')

      const better = pool.find((voice) => {
        if (!voice.speaksChinese) return false
        if (taken.has(voice.id)) return false
        if (!canCorrect(voice.id)) return false
        if (wantFemale && voice.gender !== 'Female') return false
        if (wantMale && voice.gender !== 'Male') return false
        return true
      })

      if (better) pick = better.id
    }

    if (!pick) {
      console.log(`  ${member.name.padEnd(10)} 沒有可用的音色，留空`)
      continue
    }

    taken.add(pick)
    await db
      .update(characters)
      .set({ voiceId: pick, updatedAt: new Date() })
      .where(eq(characters.id, member.id))

    const voice = pool.find((v) => v.id === pick)
    const why = cannotCorrect
      ? `改不動破音字`
      : collides
        ? `被前面的人用掉了`
        : ''
    console.log(
      `  ${member.name.padEnd(10)} 釘住 ${pick.padEnd(32)} ` +
        `${voice?.gender === 'Female' ? '女' : voice?.gender === 'Male' ? '男' : '  '} ` +
        `${(voice?.styles.length ?? 0).toString().padStart(2)} 種情緒` +
        `${why ? `   （換掉 ${assigned ?? '無'}：${why}）` : ''}`
    )
  }

  process.exit(0)
}

void main()
