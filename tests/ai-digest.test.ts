import { describe, expect, it } from 'vitest'
import { outlineDigest, progressDigest, projectBriefDigest } from '@/lib/ai/digest'
import { parseTaskSuggestions } from '@/lib/ai/task-suggestions'

/**
 * 六種「發動不了」的 AI 任務，其中三種真正缺的是餵給它的東西 (Z153).
 *
 * 這裡釘的都是**錯了也不會報錯**的事：摘要組錯了，模型還是會回東西，只是回
 * 的是對著一份空白或一份錯資料寫出來的建議。而那種錯誤看起來跟正常輸出一
 * 模一樣。
 */

describe('大綱摘要', () => {
  const rows = [
    { number: 1, title: '灶前', logline: '她在灶前醒來', synopsis: '一句、兩句、三句。' },
    { number: 2, title: '', logline: '', synopsis: '' },
  ]

  it('一集都沒寫大綱就回空字串，不回骨架', () => {
    /*
     * 這一條是錢。回一份只有集號的骨架，送出去會換來一段「你還沒有大綱，我
     * 沒辦法審」——花錢買一句我們本來就知道的話。空字串讓按鈕在按下去之前就
     * 是灰的。
     */
    const empty = [
      { number: 1, title: '', logline: '', synopsis: '' },
      { number: 2, title: '', logline: '   ', synopsis: '\n' },
    ]
    expect(outlineDigest('一灶見山河', empty)).toBe('')
  })

  it('寫了的列出來，沒寫的標明沒寫', () => {
    const text = outlineDigest('一灶見山河', rows)
    expect(text).toContain('共 2 集，其中 1 集寫了大綱')
    expect(text).toContain('### EP001　灶前')
    expect(text).toContain('一句話：她在灶前醒來')
    expect(text).toContain('### EP002（還沒有大綱）')
  })

  it('集號補成三位數，跟畫面上一致', () => {
    const text = outlineDigest('x', [
      { number: 7, title: '', logline: 'a', synopsis: '' },
      { number: 113, title: '', logline: 'b', synopsis: '' },
    ])
    expect(text).toContain('### EP007')
    expect(text).toContain('### EP113')
  })
})

describe('進度摘要', () => {
  const today = new Date(2026, 10, 5) // 2026-11-05，本地時間

  it('日期用本地日，不會因為傍晚就跳成明天', () => {
    /*
     * 台北是 UTC+8，所以 `toISOString()` 在晚上八點之後會回明天。期限整批差
     * 一天、而且只在傍晚之後差，是那種上線三個月才有人發現的錯。
     */
    const evening = new Date(2026, 10, 5, 23, 30)
    const text = progressDigest({ projects: [], tasks: [], overdue: 0, today: evening })
    expect(text).toContain('今天是 2026-11-05')
  })

  it('沒有卡片就明說一張都沒有', () => {
    const text = progressDigest({ projects: [], tasks: [], overdue: 0, today })
    expect(text).toContain('看板上一張卡片都沒有')
    expect(text).toContain('沒有任何作品')
  })

  it('每部作品的集數與整體進度都在', () => {
    const text = progressDigest({
      projects: [
        {
          title: '一灶見山河',
          total: 120,
          done: 2,
          inProgress: 1,
          pending: 117,
          overallProgress: 0.0231,
        },
      ],
      tasks: [],
      overdue: 0,
      today,
    })
    expect(text).toContain('《一灶見山河》共 120 集：已完成 2、進行中 1、未開始 117')
    expect(text).toContain('整體 2%')
  })

  it('卡片帶著作品、集號、負責人與期限', () => {
    const text = progressDigest({
      projects: [],
      overdue: 1,
      today,
      tasks: [
        {
          title: '配 EP002 的旁白',
          status: 'DOING',
          priority: 'HIGH',
          projectTitle: '一灶見山河',
          assigneeName: 'Luffy',
          episodeNumber: 2,
          dueDate: new Date(2026, 10, 1),
        },
      ],
    })
    expect(text).toContain('《一灶見山河》')
    expect(text).toContain('EP002')
    expect(text).toContain('Luffy')
    expect(text).toContain('期限 2026-11-01')
    expect(text).toContain('1 件過期未完成')
  })
})

describe('作品摘要', () => {
  it('沒寫的欄位要寫出「還沒有寫」，不是整行省略', () => {
    /*
     * 系統提示要求模型資訊不足時說缺什麼、不要自己補。但「這一行不存在」跟
     * 「這一行是空的」在模型眼裡是兩件事——前者它會當成沒有這個欄位。
     */
    const text = projectBriefDigest({
      title: '一灶見山河',
      logline: '',
      synopsis: '',
      tags: [],
      episodeCount: 120,
      plannedEpisodes: 120,
      episodesWithOutline: 0,
    })
    expect(text).toContain('一句話：還沒有寫')
    expect(text).toContain('作品大綱：還沒有寫')
    expect(text).toContain('已建立 120 集，規劃 120 集，其中 0 集有大綱')
  })
})

describe('任務建議的輸出', () => {
  const projects = [
    { id: 'p1', title: '一灶見山河' },
    { id: 'p2', title: '另一部' },
  ]

  const one = {
    title: '配 EP003 的旁白',
    projectTitle: '一灶見山河',
    episodeNumber: 3,
    priority: 'HIGH',
    reason: 'EP002 已完成，接著就是 EP003',
  }

  it('讀得出乾淨的陣列', () => {
    const parsed = parseTaskSuggestions(JSON.stringify([one]), projects)
    expect(parsed.rejected).toEqual([])
    expect(parsed.suggestions).toEqual([
      {
        title: '配 EP003 的旁白',
        projectId: 'p1',
        projectTitle: '一灶見山河',
        episodeNumber: 3,
        priority: 'HIGH',
        reason: 'EP002 已完成，接著就是 EP003',
      },
    ])
  })

  it('包在物件裡也讀得出來', () => {
    /*
     * OpenAI 相容端點的 `response_format: json_object` 要求頂層是物件，所以
     * 有幾家會把陣列包成 `{"suggestions": [...]}`。只收裸陣列的話，換一家廠
     * 商就整批讀不出來，而錯誤訊息會是「AI 沒有照格式回覆」——看起來像模型的
     * 錯。
     */
    const parsed = parseTaskSuggestions(JSON.stringify({ suggestions: [one] }), projects)
    expect(parsed.suggestions).toHaveLength(1)
  })

  it('包在程式碼圍籬裡也讀得出來', () => {
    const fenced = '```json\n' + JSON.stringify([one]) + '\n```'
    expect(parseTaskSuggestions(fenced, projects).suggestions).toHaveLength(1)
  })

  it('作品名稱對不上就退回，而且說出它寫了什麼', () => {
    /*
     * 猜最接近的那一部等於把卡片建到別部作品去。退回並照實說，不要安靜地丟
     * 掉——「少了一條建議」沒有人看得出來。
     */
    const parsed = parseTaskSuggestions(
      JSON.stringify([{ ...one, projectTitle: '不存在的作品' }]),
      projects
    )
    expect(parsed.suggestions).toHaveLength(0)
    expect(parsed.rejected[0]).toContain('不存在的作品')
  })

  it('只有一部作品時，沒寫作品名稱也算在那一部', () => {
    const parsed = parseTaskSuggestions(
      JSON.stringify([{ ...one, projectTitle: '' }]),
      [{ id: 'p1', title: '一灶見山河' }]
    )
    expect(parsed.suggestions[0]?.projectId).toBe('p1')
  })

  it('優先度亂寫就退回預設，不是整筆丟掉', () => {
    const parsed = parseTaskSuggestions(
      JSON.stringify([{ ...one, priority: '很急' }]),
      projects
    )
    expect(parsed.suggestions[0]?.priority).toBe('NORMAL')
  })

  it('集號不是正整數就當成沒有', () => {
    for (const bad of [0, -3, 2.5, '3', null]) {
      const parsed = parseTaskSuggestions(
        JSON.stringify([{ ...one, episodeNumber: bad }]),
        projects
      )
      expect(parsed.suggestions[0]?.episodeNumber).toBeNull()
    }
  })

  it('讀不出 JSON 的時候回空清單加上原因，不是丟例外', () => {
    const parsed = parseTaskSuggestions('這週建議先把有聲書做完。', projects)
    expect(parsed.suggestions).toEqual([])
    expect(parsed.rejected).toEqual(['整段讀不出 JSON'])
  })

  it('兩個陣列屬性的時候不猜', () => {
    const parsed = parseTaskSuggestions(
      JSON.stringify({ suggestions: [one], notes: ['別的東西'] }),
      projects
    )
    expect(parsed.suggestions).toEqual([])
    expect(parsed.rejected).toEqual(['JSON 裡找不到建議清單'])
  })
})
