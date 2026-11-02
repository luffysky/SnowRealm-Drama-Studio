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
  NOVEL_CONTINUE:
    '延續既有小說內容往下寫。保持既有敘事人稱、語氣與節奏，不要重寫已有段落，只接著寫新內容。',
  NOVEL_REWRITE: '依指定方向改寫指定段落。保留原有劇情事件，只改變表達方式。',
  NOVEL_POLISH: '潤飾文字：修正語病、統一用詞、加強畫面感。不得改動劇情事實與角色決定。',
  NOVEL_REVIEW:
    '以審稿人身分評估這段小說：指出節奏問題、角色動機不足之處、與世界觀矛盾的地方。逐條列出，附上出處引文。不要直接改寫。',
  NOVEL_TO_SCRIPT:
    '將小說改編為劇本。輸出場次（場景標題、地點、時間）、動作描述與對白。計算片長時必須把動作與停頓算進去，不只算台詞字數。不要改動原著劇情。',
  SCRIPT_ANALYZE:
    '分析這份劇本：估算片長（含動作與停頓）、指出對白過長或資訊量不足的場次、標出可刪減處。',
  WORLD_GENERATE: '依分類擴寫世界觀設定條目，內容需與既有設定相容，並標示與哪些既有條目相關。',
  WORLD_CONSISTENCY:
    '檢查提供的內容與既有世界觀設定是否矛盾。逐條輸出：衝突位置、引用原文、衝突的設定條目、可信度。只報告，不要自行修正正式設定。',
  CHARACTER_DESIGN:
    '依人物設定撰寫外觀提示詞與聲線建議。外觀提示詞需具體到可直接用於生圖，並確保跨集一致性。',
  STORYBOARD_GENERATE:
    '依劇本產生分鏡鏡頭表。每個鏡頭需包含：場次、秒數、景別、運鏡、畫面描述、台詞、生圖提示詞。所有鏡頭秒數加總必須落在目標片長範圍內。',
  ASSET_GENERATE: '依需求撰寫素材生成提示詞，包含正向提示詞與負向提示詞。',
  TASK_SUGGEST:
    '依目前製作進度，建議接下來的任務安排。逐條輸出建議，每條標明理由與影響的集數。不要擅自變更既有期限與負責人。',
}

export function instructionFor(task: AiTaskKind): string {
  return TASK_INSTRUCTIONS[task]
}

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

  if (context.sourceText) {
    parts.push(`## 來源內容\n${context.sourceText}`)
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

/** Tasks whose output is parsed as JSON rather than shown as prose. */
export const STRUCTURED_TASKS: ReadonlySet<AiTaskKind> = new Set<AiTaskKind>([
  'STORYBOARD_GENERATE',
  'WORLD_CONSISTENCY',
  'TASK_SUGGEST',
  'SCRIPT_ANALYZE',
])
