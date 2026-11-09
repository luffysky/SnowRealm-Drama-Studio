import type { AiContext, AiTaskKind } from './types'

/**
 * System prompt and per-task instructions.
 *
 * The system prompt is deliberately stable text with no timestamps or ids, so
 * it caches as a prefix across every request (see the prompt-caching rules).
 * Volatile context goes in the user message instead.
 */

export const SYSTEM_PROMPT = `你是 SnowRealm Drama Studio 的編劇與分鏡顧問，協助一個兩人團隊製作中文短劇。

工作規則：
- 使用繁體中文（臺灣用語）。
- 嚴格遵守已確立的世界觀與角色設定。若使用者提供的設定與你的推測衝突，一律以使用者的設定為準。
- 不要發明已存在角色的姓名。若某個角色的姓名標示為未定，就保持未定，用其稱謂或代號指稱。
- 你產出的是候選草稿，不是定稿。不要宣稱內容已完成或已通過審核。
- 若提供的資訊不足以完成任務，明確說出缺少什麼，不要憑空補足劇情設定。
- 短劇節奏緊湊：每集有明確的鉤子、轉折與收尾。`

const TASK_INSTRUCTIONS: Record<AiTaskKind, string> = {
  PROJECT_PLAN:
    '根據題材與受眾，提出一份作品企劃：核心賣點、目標觀眾、風格定位、分部規劃與每集長度建議。',
  OUTLINE_GENERATE: `為指定範圍的每一集寫出分集大綱。

每一集輸出三樣東西，用這個格式，不要加其他說明：

### EP<三位數編號>
標題：<八字以內，不要用「第X集」當標題>
一句話：<一句話講完這集發生什麼，四十字以內>
大綱：<三到六句。寫事件與轉折，不要寫文采。最後一句必須是下一集的鉤子>

規則：
- 這是短劇，每集 120–180 秒。一集只能裝一個主要事件，不要塞三條線。
- 每一集結尾都要有讓人想看下一集的理由，但不要每集都用同一種鉤子。
- 相鄰集數之間要能接上：後一集的開頭要承接前一集的結尾。
- 只寫被指定的集數範圍，不要多寫，也不要重述已經寫好的集數。
- 既有角色的姓名、關係、世界觀設定一律照搬，不要自行更名或新增設定。`,
  OUTLINE_REVIEW: `以責任編輯的身分審視這份分集大綱。逐條指出問題，每條附上集數與引文：

- 節奏：哪幾集事件密度過低或過高
- 鉤子：哪幾集的結尾沒有讓人想看下一集，或鉤子重複
- 銜接：哪兩集之間接不上
- 角色：誰的動機交代不足、誰長時間消失
- 與世界觀或既有設定矛盾之處

只報告問題與修改方向，不要直接改寫大綱。`,
  NOVEL_CONTINUE:
    '延續既有小說內容往下寫。保持既有敘事人稱、語氣與節奏，不要重寫已有段落，只接著寫新內容。',
  NOVEL_REWRITE: '依指定方向改寫指定段落。保留原有劇情事件，只改變表達方式。',
  NOVEL_POLISH: '潤飾文字：修正語病、統一用詞、加強畫面感。不得改動劇情事實與角色決定。',
  NOVEL_REVIEW:
    '以審稿人身分評估這段小說：指出節奏問題、角色動機不足之處、與世界觀矛盾的地方。逐條列出，附上出處引文。不要直接改寫。',
  /*
   * 改成結構化輸出 (Z30).
   *
   * 本來回散文，而散文沒有地方可以去：`scenes` 那張表有 heading／location／
   * timeOfDay／content 四欄，沒有人分得出一段改編稿裡哪一句是地點、哪一段是
   * 這一場的內容。於是這個任務產出之後**沒有任何地方能套用它**——採用只會把
   * 任務標成已採用，然後請人自己把一整集剪成十幾場貼進去。
   * Z70 角色設計、Z71 分鏡、Z153 任務建議的同一個病，第四次。
   *
   * **不要 code。** 場次代號由位置算（`sceneCodeFor`），跟 `createScene` 共
   * 用一個算式——讓模型也寫一個，重新排序之後兩邊就對不起來。
   *
   * **不要秒數。** 片長由 `estimateSceneSeconds` 算，那是一個定義好的算式；
   * 模型給的是它猜的。兩個都存，畫面上的「預估片長 vs 目標區間」就不知道該
   * 信哪一個。但算式本身要告訴模型，它才控得了節奏。
   */
  /*
   * 要物件不要裸陣列 (Z30 審出來).
   *
   * 進了 `STRUCTURED_TASKS` 就會送 `response_format: json_object`，而那個模
   * 式的契約就是**最上層一定是物件**。再叫模型「只回一個 JSON 陣列」，它只
   * 能自己發明一個包裝鍵——而包成 `{"scenes":[...],"notes":[]}` 這種有兩個
   * 陣列的物件時，`arrayIn` 會整份退回。一整集的改編錢付了，東西拿不到。
   */
  NOVEL_TO_SCRIPT:
    '將小說改編為劇本，拆成場次。' +
    '只回一個 JSON 物件，形如 {"scenes": [...]}，' +
    'scenes 陣列的每一筆是 {heading, location, timeOfDay, content}：' +
    'heading 是這一場的標題，十五字以內；' +
    'location 是地點（例如「小灶房」）；timeOfDay 是時間（日／夜／黃昏／清晨）；' +
    'content 是這一場的內容，用 HTML 段落：動作與場景描述用 <p>，' +
    '對白也用 <p>，並把台詞放進「」裡——' +
    '**「」是片長估算用來分辨對白與動作的唯一依據**，漏了會把對白當動作算。' +
    '不要在 content 裡重複寫場次代號或標題。' +
    '片長這樣估：「」裡的字每 5 個字 1 秒，其餘的字每 15 個字 1 秒。' +
    '用這個算式控制節奏，讓全部場次加起來落在目標片長的正負一成之內，' +
    '算完請自己核對一次再輸出。' +
    '不要改動原著劇情。不要輸出 JSON 以外的任何文字。',
  SCRIPT_ANALYZE:
    '分析這份劇本：估算片長（含動作與停頓）、指出對白過長或資訊量不足的場次、標出可刪減處。',
  WORLD_GENERATE: '依分類擴寫世界觀設定條目，內容需與既有設定相容，並標示與哪些既有條目相關。',
  WORLD_CONSISTENCY:
    '檢查提供的內容與既有世界觀設定是否矛盾。逐條輸出：衝突位置、引用原文、衝突的設定條目、可信度。只報告，不要自行修正正式設定。',
  /*
   * 改成結構化輸出 (Z70).
   *
   * 本來回自由文字，於是「外觀提示詞與聲線建議」混在一段散文裡——誰也分不
   * 出哪一句該寫進 `visualPrompt`、哪一句該寫進 `voiceNote`，所以這個任務
   * 產出之後**沒有任何地方能套用它**。
   */
  CHARACTER_DESIGN:
    '依人物設定撰寫外觀與聲線。外觀提示詞需具體到可直接用於生圖，並確保跨集一致性。' +
    '只回一個 JSON 物件，四個欄位皆為字串：' +
    'appearance（外型、服裝、髮型，中文敘述）、visualPrompt（定妝提示詞）、' +
    'negativePrompt（負面提示詞）、voiceNote（聲線建議）。' +
    '沒有把握的欄位給空字串，不要編。',
  /*
   * 改成結構化輸出 (Z39).
   *
   * 本來要的是一張「鏡頭表」，沒有說形狀，所以回來的是一段 Markdown 表格或
   * 一串編號段落——而 `shots` 那張表有十幾個欄位，沒有人分得出哪一段該進
   * `action`、哪一段該進 `prompt`。於是這個任務產出之後**沒有任何地方能套用
   * 它**：跟 Z70 角色設計、Z153 任務建議同一個病。
   *
   * 景別與運鏡用列舉值而不是中文，因為它們進的是 pg enum。讓模型寫「中景」
   * 再在這邊猜它是不是 `MS`，就是把一個會錯的翻譯塞進寫入路徑。
   */
  STORYBOARD_GENERATE:
    '依劇本產生分鏡鏡頭表。' +
    '只回一個 JSON 陣列，每筆 {sceneCode, durationSec, shotSize, camera, location, timeOfDay, action, dialogue, speaker, prompt, negativePrompt}：' +
    'sceneCode 是場次代號，例如 S03；' +
    'durationSec 是這個鏡頭幾秒，正整數；' +
    'shotSize 只能是 EWS、WS、FS、MS、MCU、CU、ECU、INSERT 其中一個；' +
    'camera 只能是 STATIC、PAN、TILT、DOLLY_IN、DOLLY_OUT、TRACKING、CRANE、HANDHELD、ZOOM 其中一個；' +
    'location 與 timeOfDay 是地點與時間（日／夜／黃昏）；' +
    'action 是畫面描述；dialogue 是這個鏡頭的台詞或旁白，沒有就填空字串；' +
    'speaker 是說這句話的角色名稱，必須是角色名單上的名字，沒有台詞或判斷不出來就填 null；' +
    'prompt 是可直接拿去生圖的提示詞，negativePrompt 是負面提示詞。' +
    '**所有鏡頭的 durationSec 加總必須落在目標片長的正負一成之內**，' +
    '算完請自己核對一次再輸出。' +
    '不要改動劇本的劇情。不要輸出 JSON 以外的任何文字。',
  ASSET_GENERATE: '依需求撰寫素材生成提示詞，包含正向提示詞與負向提示詞。',
  DIALOGUE_ATTRIBUTE:
    '判斷每一句對白是誰說的。輸入是編號過的正文，以及要判斷的段號清單。'+
    '只回 JSON 陣列，每筆 {index, speaker, gender, confidence, reason}：'+
    'index 必須是清單裡給的段號；speaker 必須是角色名單裡的名字，'+
    '若說話的人不在名單上就照正文寫出他的稱呼，若判斷不出來就填 null；'+
    'gender 填「男」或「女」，判斷不出來就填 null——這會決定配音用男聲還是女聲，'+
    '「婦人」「嬸子」「小男孩」「老伯」這種稱呼本身就說明了性別；'+
    'confidence 是 0 到 1；reason 用十個字以內說明依據。'+
    '判斷依據：說話標記、一來一往的輪替、稱謂與語氣、前後文提到在場的人。'+
    '不確定就填 null 並把 confidence 壓低——寧可不答，不要答錯。'+
    '不要輸出 JSON 以外的任何文字，不要改寫正文。',
  /*
   * 改成結構化輸出 (Z153).
   *
   * 本來回散文，而散文沒有地方可以去——「建議接下來的任務安排」產出之後，
   * 人要自己一條一條重打成卡片。那是 Z70 角色設計那條的同一個病：產出跟它
   * 要去的地方對不起來，於是**沒有任何地方能套用它**。
   *
   * 回 JSON，就能在看板上直接勾選建立。這也是 `STRUCTURED_TASKS` 裡唯一的
   * 判準：有沒有程式真的去 parse 它。
   */
  TASK_SUGGEST:
    '依目前製作進度，建議接下來該做的任務。' +
    '只回一個 JSON 陣列，每筆 {title, projectTitle, episodeNumber, priority, reason}：' +
    'title 是十五字以內、動詞開頭的一句話；' +
    'projectTitle 必須是上面進度摘要裡出現過的作品名稱，不要自創；' +
    'episodeNumber 是集號整數，跟特定集數無關就填 null；' +
    'priority 只能是 URGENT、HIGH、NORMAL、LOW 其中一個；' +
    'reason 用三十字以內說明為什麼現在該做這件事。' +
    '不要重複看板上已經有的卡片，不要變更既有期限與負責人。' +
    '最多十筆。不要輸出 JSON 以外的任何文字。',
}

export function instructionFor(task: AiTaskKind): string {
  return TASK_INSTRUCTIONS[task]
}

/**
 * 編劇助手的兩種整理（Z198）。
 *
 * 暖寶的原話是「整理給我看」加四個問題：劇情是否連貫合理、細節處理是否得當、
 * 總結目前的主線與人設、每一集有沒有爽點和鉤子（爽點在哪裡、鉤子是什麼）。
 * 下面兩段就是照那四句話寫的，不是一份通用的審稿樣板。
 *
 * **一律要原文。** 「這一集爽點不夠」是一句評語，「第三段『他把銅板推回去』那
 * 裡本來該翻盤卻停住了」才是可以拿去改的東西。沒有引文的判斷在這份報告裡沒有
 * 用，所以格式上就要求它。
 */
export const AUDIT_INSTRUCTIONS = {
  episode: `整理這一集，回答下面的問題。**只輸出 JSON**，不要有任何其他文字。

{
  "events": ["本集主要事件，按發生順序，每則一句"],
  "payoff": {
    "present": true,
    "what": "這一集的爽點是什麼",
    "where": "在哪裡（段落位置的描述，例如「後段，灶前對質」）",
    "quote": "那一段的原文，二十到六十字"
  },
  "hook": {
    "present": true,
    "what": "結尾留下什麼讓人想看下一集",
    "where": "在哪裡",
    "quote": "結尾那一段的原文"
  },
  "details": [
    { "issue": "細節處理不妥的地方", "quote": "原文" }
  ],
  "doubts": [
    { "question": "讀到這裡會卡住的問題", "quote": "原文", "why": "為什麼會卡住" }
  ]
}

判斷標準：

- **爽點**是情緒的回報：期待被滿足、壓抑被釋放、對手被打臉、能力被看見。鋪墊不是爽點。沒有就 \`"present": false\` 並在 \`what\` 說明為什麼沒有——不要為了填滿欄位而把一件普通的事說成爽點。
- **鉤子**是結尾讓人想看下一集的理由。「明天繼續做菜」不是鉤子。
- **細節**看的是：錢數、份量、時間、距離、工序前後、物品有沒有憑空出現或消失、稱謂是否一致。
- **疑點**只記**讀到這一集為止**會卡住的問題。後面才會解釋的事情不是漏洞——你不知道後面寫了什麼，所以把它寫成問題，不要寫成指控。
- 每一項都要有原文。找不到原文可以引的那一項，就不要寫。`,

  ask: `回答下面那個問題。**用一般的文字回答，不要 JSON。**

- 根據給你的材料回答。材料裡沒有的，就說「這份材料裡看不到」，不要用寫作常識補。
- 講到劇情就引原文，並說清楚是第幾集。引不到原文的判斷，要標成「推測」。
- 問「能不能這樣改」的時候：先說這樣改會動到哪幾集已經寫好的東西，再給做法。**不要直接把改寫好的正文貼出來**——那是另一件事，要她開口才做。
- 她問的是她自己的作品，所以不要解釋基本的編劇名詞，除非她問。
- 答案要短。一個問題不需要一篇文章。
- **讀的人不懂 markdown。** 可以用「-」條列、可以用編號，粗體最多一兩個詞；
  不要用表格、不要用「#」開頭的標題、不要用程式碼圍欄。`,

  digest: `根據下面每一集的摘要，整理這部作品到目前為止的樣子。**只輸出 JSON**，不要有任何其他文字。

{
  "mainline": "到目前為止的主線，三到六句。寫事件的推進，不要寫文案",
  "threads": ["支線，每條一句"],
  "characters": [
    {
      "name": "角色名（照原文用字，不要改名）",
      "now": "他現在是什麼樣子、處在什麼位置",
      "wants": "他想要什麼",
      "changed": "從第一集到現在變了什麼；沒變就寫「尚未看出變化」"
    }
  ],
  "issues": [
    { "question": "跨集的問題：前後矛盾、時間對不上、人物知道了他不該知道的事", "quote": "指出是哪幾集", "why": "為什麼是問題" }
  ]
}

規則：

- 只寫摘要裡真的有的東西。**不要補完你覺得應該會有的劇情。**
- 人物只列真正推動劇情的那幾個，不要把路人也列進來。
- \`issues\` 寧缺勿濫：看起來像矛盾但可能是還沒交代的，寫進去的時候要在 \`why\` 說明你為什麼認為它是矛盾而不是伏筆。`,
} as const

/** Renders the volatile per-request context as the user message. */
export function renderContext(context: AiContext): string {
  const parts: string[] = []

  const identity: string[] = []
  if (context.projectTitle) identity.push(`作品：《${context.projectTitle}》`)
  if (context.arcTitle) identity.push(`篇章：《${context.arcTitle}》`)
  if (context.episodeNumber !== undefined) {
    const title = context.episodeTitle ? ` ${context.episodeTitle}` : ''
    identity.push(`集數：第 ${context.episodeNumber} 集${title}`)
  }
  if (context.targetSec !== undefined) identity.push(`目標片長：${context.targetSec} 秒`)
  if (identity.length) parts.push(`## 製作對象\n${identity.join('\n')}`)

  if (context.worldEntries?.length) {
    const lines = context.worldEntries.map(
      (w) => `- [${w.category}] ${w.title}：${w.body.slice(0, 600)}`
    )
    parts.push(`## 既定世界觀（不得違背）\n${lines.join('\n')}`)
  }

  if (context.characters?.length) {
    const lines = context.characters.map((c) => {
      const bits = [`- ${c.name}（${c.tier}）`]
      if (c.appearance) bits.push(`  外型：${c.appearance}`)
      if (c.personality) bits.push(`  性格：${c.personality}`)
      return bits.join('\n')
    })
    parts.push(`## 角色設定（不得改名）\n${lines.join('\n')}`)
  }

  /*
   * 觀眾視角拿不到隱藏設定，而這件事要**在這裡**擋 (Z198).
   *
   * 組 context 的那一端已經不會放這一欄進去了，但「組的時候沒放」是一個習
   * 慣，不是一個保證——下一個人多傳一個欄位進來，外洩會悄悄發生，而產出看起
   * 來完全合理：模型知道答案，所以它說這一集沒有問題。
   *
   * 丟例外，讓一次外洩變成一次當掉。
   */
  if (context.auditPass === 'audience' && context.secretNotes) {
    throw new Error('觀眾視角不可以拿到隱藏設定（secretNotes）')
  }

  if (context.priorSummary) {
    parts.push(`## 此前已公開的劇情（觀眾看過的）\n${context.priorSummary}`)
  }

  if (context.sourceText) {
    parts.push(`## 來源內容\n${context.sourceText}`)
  }

  if (context.secretNotes) {
    parts.push(`## 編劇已確認的隱藏設定（只有編劇視角看得到）\n${context.secretNotes}`)
  }

  if (context.audienceFindings) {
    parts.push(`## 觀眾視角問出來的疑問（逐條判定）\n${context.audienceFindings}`)
  }

  if (context.userInstruction) {
    parts.push(`## 本次額外要求\n${context.userInstruction}`)
  }

  return parts.join('\n\n')
}

/** Builds the full user message: stable instruction, then volatile context. */
export function buildUserMessage(task: AiTaskKind, context: AiContext): string {
  return `## 任務\n${instructionFor(task)}\n\n${renderContext(context)}`
}

/**
 * Reasoning effort per task.
 *
 * Every call used to run at `high`, because no caller passed one and that was
 * the default. That is the wrong setting for most of these: 潤稿 is a local
 * edit, and 大綱 is mostly a format-following job. Deliberation costs latency
 * and output tokens, and on the tasks below it buys very little.
 *
 * Analysis tasks keep `high` — 審稿 and 一致性檢查 are exactly the cases where
 * thinking longer finds the contradiction that a quick pass misses.
 */
export const TASK_EFFORT: Record<AiTaskKind, 'low' | 'medium' | 'high'> = {
  // Creative, long-form: worth the deliberation.
  PROJECT_PLAN: 'high',
  NOVEL_CONTINUE: 'high',
  NOVEL_REWRITE: 'high',
  // Analysis: this is what high effort is actually for.
  NOVEL_REVIEW: 'high',
  OUTLINE_REVIEW: 'high',
  WORLD_CONSISTENCY: 'high',
  SCRIPT_ANALYZE: 'high',
  // Structured output that follows a given format more than it invents.
  OUTLINE_GENERATE: 'medium',
  NOVEL_TO_SCRIPT: 'medium',
  STORYBOARD_GENERATE: 'medium',
  WORLD_GENERATE: 'medium',
  CHARACTER_DESIGN: 'medium',
  TASK_SUGGEST: 'medium',
  /*
   * 對白歸屬 is analysis, but of a mechanical kind: who is speaking is in
   * the text, not a judgement to deliberate over. `medium` because a
   * whole episode is ~300 decisions in one answer and the long tail of
   * unmarked lines does need some thought.
   */
  DIALOGUE_ATTRIBUTE: 'medium',
  // Local edits and prompt writing: deliberation changes almost nothing.
  NOVEL_POLISH: 'low',
  ASSET_GENERATE: 'low',
}

/**
 * Tasks whose output is parsed as JSON rather than shown as prose.
 *
 * 判準只有一個：**有程式真的去 parse 它**。這個集合會讓相容層送出
 * `response_format: json_object`，所以放進一個 prompt 要求散文的任務，就是
 * 在叫模型「用 JSON 寫一篇散文」——它會自己掰一個形狀出來，而介面照散文渲
 * 染，於是畫面上出現一坨大括號。
 *
 * `WORLD_CONSISTENCY` 與 `SCRIPT_ANALYZE` 因此被移出來 (Z153)：它們的
 * prompt 從頭到尾都是「逐條列出、附上引文」，沒有任何地方 parse 它們的輸
 * 出。Claude 那邊只是多試一次 parse、失敗就算了，看不出差別；接上 GPT／
 * DeepSeek 這些相容端點之後才會現形。
 */
/**
 * 每個任務的輸出上限 (Z157).
 *
 * `max_tokens` 在 adaptive thinking 底下是**思考加正文的總額**，不是正文的
 * 額度。所以一個會寫出整份文件的任務配一個全域 8000，實際發生的事是：模型
 * 把 8000 全部花在思考上，然後因為 `stop_reason=max_tokens` 停下來，一個字
 * 都沒寫。實測「小說轉劇本」三次全軍覆沒，in 4810 / out 8000、零內容、照樣
 * 收錢。
 *
 * 所以上限要照**這個任務要寫多長**來給，而不是一個數字套用到十七種任務。
 * 潤一段話跟改編一整集小說需要的空間差十倍。
 *
 * 沒列在這裡的吃 `DEFAULT_MAX_OUTPUT_TOKENS`。
 *
 * ## 為什麼不乾脆全部調高
 *
 * 60 秒。worker 的 `maxDuration = 60`，而超時的請求不是「比較慢」，是**已經
 * 付錢但拿不到東西**的那種失敗——跟現在這個 bug 同一種結果，只是換一個原因。
 * 所以只有真的要寫長文的那幾種調高。
 */
export const TASK_MAX_TOKENS: Partial<Record<AiTaskKind, number>> = {
  // 會寫出一整份文件的：正文本身就要好幾千 token，思考還要另外算。
  NOVEL_TO_SCRIPT: 16_000,
  NOVEL_CONTINUE: 16_000,
  STORYBOARD_GENERATE: 16_000,
  PROJECT_PLAN: 12_000,
  OUTLINE_GENERATE: 12_000,
  /*
   * 一整集的對白歸屬是三百筆 JSON。這一種特別容易被低估，因為每一筆都很
   * 短——短的是每一筆，不是總量。
   */
  DIALOGUE_ATTRIBUTE: 16_000,
  // 審稿類寫的是報告，不是正文，但逐條附引文也不短。
  NOVEL_REVIEW: 12_000,
  OUTLINE_REVIEW: 12_000,
  SCRIPT_ANALYZE: 12_000,
  WORLD_CONSISTENCY: 12_000,
}

export const STRUCTURED_TASKS: ReadonlySet<AiTaskKind> = new Set<AiTaskKind>([
  'CHARACTER_DESIGN',
  'DIALOGUE_ATTRIBUTE',
  'NOVEL_TO_SCRIPT',
  'STORYBOARD_GENERATE',
  'TASK_SUGGEST',
])

/**
 * 不需要「來源內容」就能跑的任務 (Z153).
 *
 * 這些從上下文（世界觀、角色、進度摘要）加上使用者的指示生成，沒有一段要
 * 被改寫的正文。面板本來寫死 `task === 'PROJECT_PLAN'` 一個例外，於是另外
 * 三種只要一掛上去，「估算成本」就會是灰的而且不說為什麼——spec v2 §4 禁
 * 止的正是那個。
 */
export const TASKS_WITHOUT_SOURCE: ReadonlySet<string> = new Set<AiTaskKind>([
  'PROJECT_PLAN',
  'WORLD_GENERATE',
  'ASSET_GENERATE',
])

/**
 * 讀「某一集的小說」而不是螢幕上那段文字的任務 (Z153).
 *
 * 正文由伺服器讀（Z113）：一集一萬字，瀏覽器只需要說是哪一集。
 *
 * 型別是 `ReadonlySet<string>` 而成員照 `AiTaskKind` 檢查：面板拿到的是
 * `AiJobKindValue`，那個集合多一個 `NOVEL_TO_AUDIO`（有聲書不是送給語言模型
 * 的任務）。這樣寫錯種類名稱照樣編不過，而呼叫端不用先轉型。
 */
export const TASKS_READING_NOVEL: ReadonlySet<string> = new Set<AiTaskKind>([
  'NOVEL_TO_SCRIPT',
  'WORLD_CONSISTENCY',
])
