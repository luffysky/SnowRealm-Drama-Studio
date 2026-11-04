import Anthropic from '@anthropic-ai/sdk'
import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  assistantProposals,
  characters,
  chapters,
  documents,
  episodes,
  messages,
  projects,
  usageLedger,
  worldEntries,
} from '@/db/schema'
import { ApiError } from '@/lib/api'
import { BUILT_IN_PRICING, DEFAULT_MODEL } from '@/lib/ai/anthropic'
import { sendMessage } from '@/lib/chat'
import { getModelPricing } from '@/lib/settings'
import type { Trigger } from '@/lib/assistant/triggers'

/**
 * AI 助理 (Z100).
 *
 * A conversation, not a task. The existing `AiAdapter` takes one task and one
 * context and returns candidates — the right shape for 「續寫這一章」 and the
 * wrong one for a back-and-forth, so this talks to the SDK directly and
 * records its own usage.
 *
 * Two rules shape everything here:
 *
 *  1. **It is only ever awake when addressed.** `detectTrigger` decides that,
 *     and nothing in this file runs otherwise. The conversation between two
 *     people is not sent to a model.
 *  2. **It never writes to the work.** Tools that change something record a
 *     proposal against a snapshot of what the assistant was shown; a person
 *     applies it, and applying takes a backup first.
 */

const MAX_TURNS = 8
const MAX_TOOL_ROUNDS = 6
/** Per reply. A runaway loop costs money; this is where it stops. */
const MAX_OUTPUT_TOKENS = 4096

const SYSTEM = `你是 SnowRealm Drama Studio 的製作助理，服務一個兩人工作室：
他們在寫一部 120 集的中文短劇《一灶見山河》，流程是小說 → 劇本 → 分鏡 → 影像。

你的行為準則：

1. **用繁體中文回答**，語氣像一個熟悉這部戲的同事，不是客服。
2. **不要編造作品內容。** 角色名字、情節、設定，只用工具查到的。
   查不到就說查不到——這個工作室的規則是「寧可空著也不要假資料」。
3. **你不能直接改任何東西。** 要改就用 propose_edit 提案，由人決定。
   提案要附上你為什麼這樣改。
4. 回答精簡。他們在工作，不是在讀文件。
5. 不確定使用者指的是哪一集、哪個角色就直接問，不要猜。`

type ToolResult = { text: string; proposal?: typeof assistantProposals.$inferInsert }

/* -------------------------------------------------------------------------- */
/* Tools                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What the assistant can see and ask for.
 *
 * Read tools return what is in the database and nothing else. The write tool
 * does not write: it records a proposal. That asymmetry is the whole design —
 * the model's reach into the work is exactly one table that no screen reads
 * as content.
 */
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_projects',
    description: '列出這個工作室的所有作品，含集數與字數。不知道使用者指哪一部時先用這個。',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_episodes',
    description: '列出一部作品的集數，含集名、大綱、字數。',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '作品 id' },
        from: { type: 'number', description: '起始集數，預設 1' },
        limit: { type: 'number', description: '最多幾集，預設 30，上限 60' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'read_chapter',
    description: '讀一集的小說正文。要先用 list_episodes 拿到 episodeId。',
    input_schema: {
      type: 'object',
      properties: { episodeId: { type: 'string' } },
      required: ['episodeId'],
    },
  },
  {
    name: 'list_characters',
    description: '列出一部作品的角色設定。',
    input_schema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'list_world',
    description: '列出一部作品的世界觀條目。',
    input_schema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'search',
    description: '在一部作品的小說正文、角色與世界觀裡搜尋關鍵字。',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        query: { type: 'string', description: '關鍵字' },
      },
      required: ['projectId', 'query'],
    },
  },
  {
    name: 'propose_edit',
    description: `提出一個修改提案。**這不會直接改到作品**——人看過 diff 之後才決定要不要套用。
改寫正文、補大綱、補角色設定都用這個。一次只提一個欄位。`,
    input_schema: {
      type: 'object',
      properties: {
        targetType: {
          type: 'string',
          enum: ['chapter', 'episode_outline', 'character', 'world_entry'],
        },
        targetId: {
          type: 'string',
          description: 'chapter 用 chapterId、episode_outline 用 episodeId、其餘用該筆的 id',
        },
        field: {
          type: 'string',
          description:
            'chapter: content | title。episode_outline: title | logline | synopsis。character: personality | background | appearance | growth | visualPrompt。world_entry: summary | body',
        },
        afterValue: { type: 'string', description: '改完的完整內容，不是 diff' },
        rationale: { type: 'string', description: '為什麼這樣改，一兩句' },
      },
      required: ['targetType', 'targetId', 'field', 'afterValue', 'rationale'],
    },
  },
]

/* -------------------------------------------------------------------------- */

async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { conversationId: string }
): Promise<ToolResult> {
  switch (name) {
    case 'list_projects': {
      const rows = await db
        .select({
          id: projects.id,
          title: projects.title,
          status: projects.status,
          synopsis: projects.synopsis,
        })
        .from(projects)
        .where(isNull(projects.deletedAt))

      if (rows.length === 0) return { text: '目前沒有任何作品。' }

      return {
        text: rows
          .map((r) => `- ${r.title}（id=${r.id}，${r.status}）${r.synopsis ? `：${r.synopsis.slice(0, 80)}` : ''}`)
          .join('\n'),
      }
    }

    case 'list_episodes': {
      const projectId = String(input.projectId ?? '')
      const from = Number(input.from ?? 1)
      const limit = Math.min(Number(input.limit ?? 30) || 30, 60)

      const rows = await db
        .select({
          id: episodes.id,
          number: episodes.number,
          title: episodes.title,
          logline: episodes.logline,
          synopsis: episodes.synopsis,
          charCount: documents.charCount,
        })
        .from(episodes)
        .leftJoin(
          documents,
          and(
            eq(documents.episodeId, episodes.id),
            eq(documents.kind, 'NOVEL'),
            isNull(documents.deletedAt)
          )
        )
        .where(
          and(
            eq(episodes.projectId, projectId),
            isNull(episodes.deletedAt),
            sql`${episodes.number} >= ${from}`
          )
        )
        .orderBy(asc(episodes.number))
        .limit(limit)

      if (rows.length === 0) return { text: '這部作品還沒有集數。' }

      return {
        text: rows
          .map(
            (r) =>
              `EP${String(r.number).padStart(3, '0')}（id=${r.id}）` +
              `${r.title ? ` ${r.title}` : ' （未命名）'}` +
              `${r.charCount ? ` ${r.charCount}字` : ' 未動筆'}` +
              `${r.logline ? `\n  一句話：${r.logline}` : ''}` +
              `${r.synopsis ? `\n  大綱：${r.synopsis.slice(0, 200)}` : ''}`
          )
          .join('\n'),
      }
    }

    case 'read_chapter': {
      const episodeId = String(input.episodeId ?? '')

      const rows = await db
        .select({
          chapterId: chapters.id,
          title: chapters.title,
          content: chapters.content,
          number: episodes.number,
          episodeTitle: episodes.title,
        })
        .from(episodes)
        .innerJoin(
          documents,
          and(
            eq(documents.episodeId, episodes.id),
            eq(documents.kind, 'NOVEL'),
            isNull(documents.deletedAt)
          )
        )
        .innerJoin(chapters, eq(chapters.documentId, documents.id))
        .where(eq(episodes.id, episodeId))
        .orderBy(asc(chapters.sortOrder))

      if (rows.length === 0) return { text: '這一集還沒有正文。' }

      return {
        text: rows
          .map(
            (r) =>
              `【章節 id=${r.chapterId}】${r.title || '未命名'}\n${stripHtml(r.content)}`
          )
          .join('\n\n'),
      }
    }

    case 'list_characters': {
      const rows = await db
        .select({
          id: characters.id,
          name: characters.name,
          tier: characters.tier,
          personality: characters.personality,
          background: characters.background,
          appearance: characters.appearance,
        })
        .from(characters)
        .where(
          and(eq(characters.projectId, String(input.projectId ?? '')), isNull(characters.deletedAt))
        )

      if (rows.length === 0) return { text: '這部作品還沒有角色設定。' }

      return {
        text: rows
          .map(
            (r) =>
              `【${r.name}】(id=${r.id}, ${r.tier})` +
              `${r.appearance ? `\n  外觀：${r.appearance.slice(0, 150)}` : ''}` +
              `${r.personality ? `\n  性格：${r.personality.slice(0, 150)}` : ''}` +
              `${r.background ? `\n  背景：${r.background.slice(0, 200)}` : ''}`
          )
          .join('\n'),
      }
    }

    case 'list_world': {
      const rows = await db
        .select({
          id: worldEntries.id,
          title: worldEntries.title,
          category: worldEntries.category,
          summary: worldEntries.summary,
        })
        .from(worldEntries)
        .where(
          and(
            eq(worldEntries.projectId, String(input.projectId ?? '')),
            isNull(worldEntries.deletedAt)
          )
        )

      if (rows.length === 0) return { text: '這部作品還沒有世界觀條目。' }

      return {
        text: rows
          .map((r) => `【${r.title}】(id=${r.id}, ${r.category})${r.summary ? ` ${r.summary.slice(0, 150)}` : ''}`)
          .join('\n'),
      }
    }

    case 'search': {
      const projectId = String(input.projectId ?? '')
      const like = `%${String(input.query ?? '')}%`

      const [prose, people, world] = await Promise.all([
        db
          .select({ number: episodes.number, title: chapters.title, content: chapters.content })
          .from(chapters)
          .innerJoin(documents, eq(documents.id, chapters.documentId))
          .innerJoin(episodes, eq(episodes.id, documents.episodeId))
          .where(and(eq(episodes.projectId, projectId), ilike(chapters.content, like)))
          .limit(8),
        db
          .select({ name: characters.name, personality: characters.personality })
          .from(characters)
          .where(
            and(
              eq(characters.projectId, projectId),
              isNull(characters.deletedAt),
              or(ilike(characters.name, like), ilike(characters.background, like))
            )
          )
          .limit(8),
        db
          .select({ title: worldEntries.title, summary: worldEntries.summary })
          .from(worldEntries)
          .where(
            and(
              eq(worldEntries.projectId, projectId),
              isNull(worldEntries.deletedAt),
              or(ilike(worldEntries.title, like), ilike(worldEntries.body, like))
            )
          )
          .limit(8),
      ])

      const parts: string[] = []
      if (prose.length > 0) {
        parts.push(
          '正文：\n' +
            prose
              .map((r) => {
                const text = stripHtml(r.content)
                const at = text.indexOf(String(input.query ?? ''))
                const around = at >= 0 ? text.slice(Math.max(0, at - 60), at + 120) : text.slice(0, 120)
                return `  EP${String(r.number).padStart(3, '0')}：⋯${around}⋯`
              })
              .join('\n')
        )
      }
      if (people.length > 0) parts.push('角色：' + people.map((r) => r.name).join('、'))
      if (world.length > 0) parts.push('世界觀：' + world.map((r) => r.title).join('、'))

      return { text: parts.length > 0 ? parts.join('\n\n') : '找不到符合的內容。' }
    }

    case 'propose_edit': {
      const targetType = String(input.targetType ?? '')
      const targetId = String(input.targetId ?? '')
      const field = String(input.field ?? '')
      const afterValue = String(input.afterValue ?? '')

      const current = await readCurrentValue(targetType, targetId, field)
      if (current === null) {
        return { text: `找不到 ${targetType} ${targetId} 的 ${field} 欄位，提案沒有建立。` }
      }

      if (current.trim() === afterValue.trim()) {
        return { text: '改完跟原本一樣，沒有建立提案。' }
      }

      return {
        text:
          `提案已經建立，等人決定。原本 ${current.length} 字，改後 ${afterValue.length} 字。` +
          '**還沒有套用到作品上。**',
        proposal: {
          conversationId: ctx.conversationId,
          projectId: current === null ? null : await projectIdFor(targetType, targetId),
          targetType,
          targetId,
          field,
          beforeValue: current,
          afterValue,
          rationale: String(input.rationale ?? ''),
          state: 'PENDING',
        },
      }
    }

    default:
      return { text: `沒有這個工具：${name}` }
  }
}

/* -------------------------------------------------------------------------- */

/** Reads what a proposal would replace, so the diff is against the real thing. */
async function readCurrentValue(
  targetType: string,
  targetId: string,
  field: string
): Promise<string | null> {
  switch (targetType) {
    case 'chapter': {
      const [row] = await db.select().from(chapters).where(eq(chapters.id, targetId)).limit(1)
      if (!row) return null
      if (field === 'content') return row.content
      if (field === 'title') return row.title
      return null
    }
    case 'episode_outline': {
      const [row] = await db.select().from(episodes).where(eq(episodes.id, targetId)).limit(1)
      if (!row) return null
      if (field === 'title') return row.title
      if (field === 'logline') return row.logline
      if (field === 'synopsis') return row.synopsis
      return null
    }
    case 'character': {
      const [row] = await db.select().from(characters).where(eq(characters.id, targetId)).limit(1)
      if (!row) return null
      const allowed = ['personality', 'background', 'appearance', 'growth', 'visualPrompt'] as const
      if (!(allowed as readonly string[]).includes(field)) return null
      return row[field as (typeof allowed)[number]]
    }
    case 'world_entry': {
      const [row] = await db.select().from(worldEntries).where(eq(worldEntries.id, targetId)).limit(1)
      if (!row) return null
      if (field === 'summary') return row.summary
      if (field === 'body') return row.body
      return null
    }
    default:
      return null
  }
}

async function projectIdFor(targetType: string, targetId: string): Promise<string | null> {
  switch (targetType) {
    case 'chapter': {
      const [row] = await db
        .select({ projectId: episodes.projectId })
        .from(chapters)
        .innerJoin(documents, eq(documents.id, chapters.documentId))
        .innerJoin(episodes, eq(episodes.id, documents.episodeId))
        .where(eq(chapters.id, targetId))
        .limit(1)
      return row?.projectId ?? null
    }
    case 'episode_outline': {
      const [row] = await db
        .select({ projectId: episodes.projectId })
        .from(episodes)
        .where(eq(episodes.id, targetId))
        .limit(1)
      return row?.projectId ?? null
    }
    case 'character': {
      const [row] = await db
        .select({ projectId: characters.projectId })
        .from(characters)
        .where(eq(characters.id, targetId))
        .limit(1)
      return row?.projectId ?? null
    }
    case 'world_entry': {
      const [row] = await db
        .select({ projectId: worldEntries.projectId })
        .from(worldEntries)
        .where(eq(worldEntries.id, targetId))
        .limit(1)
      return row?.projectId ?? null
    }
    default:
      return null
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* -------------------------------------------------------------------------- */
/* The turn                                                                    */
/* -------------------------------------------------------------------------- */

export type AssistantResult = {
  messageId: string
  proposals: number
  costUsd: number
}

/**
 * Answers one trigger, and writes the reply into the conversation.
 *
 * The reply goes through `sendMessage` like any other, so it arrives on both
 * screens over the same channel with no special delivery path.
 */
export async function runAssistant(input: {
  conversationId: string
  triggerMessageId: string
  trigger: Trigger
  userId: string
}): Promise<AssistantResult> {
  if (!input.trigger) throw ApiError.badRequest('沒有觸發助理的內容')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    const sent = await sendMessage({
      conversationId: input.conversationId,
      senderId: null,
      body: '還沒有設定 AI 金鑰（ANTHROPIC_API_KEY），所以我現在幫不上忙。',
      fromAssistant: true,
      repliesToId: input.triggerMessageId,
    })
    return { messageId: sent.id, proposals: 0, costUsd: 0 }
  }

  if (input.trigger.kind === 'command' && input.trigger.command === 'help') {
    const sent = await sendMessage({
      conversationId: input.conversationId,
      senderId: null,
      body: HELP_TEXT,
      fromAssistant: true,
      repliesToId: input.triggerMessageId,
    })
    return { messageId: sent.id, proposals: 0, costUsd: 0 }
  }

  const history = await recentTurns(input.conversationId)
  const client = new Anthropic({ apiKey })

  const conversation: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: promptFor(input.trigger) },
  ]

  const pending: (typeof assistantProposals.$inferInsert)[] = []
  let inputTokens = 0
  let outputTokens = 0
  let reply = ''

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM,
      // Adaptive rather than a fixed budget: most turns here are a lookup and
      // a sentence, and a few are a rewrite worth thinking about.
      thinking: { type: 'adaptive' },
      tools: TOOLS,
      messages: conversation,
    })

    inputTokens += response.usage.input_tokens
    outputTokens += response.usage.output_tokens

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()

    if (text) reply = text

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )

    if (toolUses.length === 0) break

    conversation.push({ role: 'assistant', content: response.content })

    const results: Anthropic.ToolResultBlockParam[] = []

    for (const use of toolUses) {
      const outcome = await runTool(use.name, use.input as Record<string, unknown>, {
        conversationId: input.conversationId,
      })

      if (outcome.proposal) pending.push(outcome.proposal)

      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: outcome.text,
      })
    }

    conversation.push({ role: 'user', content: results })
  }

  if (!reply) {
    reply = '我沒有產出東西，再說一次要我做什麼好嗎？'
  }

  const sent = await sendMessage({
    conversationId: input.conversationId,
    senderId: null,
    body: reply,
    fromAssistant: true,
    repliesToId: input.triggerMessageId,
  })

  // Proposals are attached to the reply, so the bubble can render them.
  if (pending.length > 0) {
    await db
      .insert(assistantProposals)
      .values(pending.map((row) => ({ ...row, messageId: sent.id })))
  }

  const costUsd = await priceOf(inputTokens, outputTokens)
  await recordUsage({ userId: input.userId, inputTokens, outputTokens, costUsd })

  return { messageId: sent.id, proposals: pending.length, costUsd }
}

const HELP_TEXT = `我平常不讀這裡的訊息，也不會插話。要我做事就 @助理 或用 / 開頭。

**查東西**
@助理 第三集在講什麼
/find 沈知味的廚房

**改東西**（我只會提案，套不套用你決定）
/rewrite 把第二集開頭改得更緊一點
/outline 幫第四集寫大綱
/character 補一下許山河的背景

我看得到：作品、集數、小說正文、角色設定、世界觀。
我**不會**直接改任何東西——提案會附 diff，你按了套用才會動，
而且套用之前會先把原本的存成版本快照。`

function promptFor(trigger: NonNullable<Trigger>): string {
  if (trigger.kind === 'mention') return trigger.prompt

  switch (trigger.command) {
    case 'ask':
      return `${trigger.prompt}\n\n（只回答，不要提案修改。）`
    case 'rewrite':
      return `改寫需求：${trigger.prompt}\n\n先讀目標內容，再用 propose_edit 提案。`
    case 'outline':
      return `大綱需求：${trigger.prompt}\n\n讀過這部作品現有的設定再寫，用 propose_edit 提案。`
    case 'character':
      return `角色設定需求：${trigger.prompt}\n\n先看現有角色，再用 propose_edit 提案。`
    case 'find':
      return `在作品裡找：${trigger.prompt}`
    default:
      return trigger.prompt
  }
}

/**
 * The last few turns, so the assistant can follow a thread.
 *
 * Only its own exchanges — messages it was addressed in, and its replies.
 * Everything the two of them said to each other stays out, which is what the
 * trigger rule promises.
 */
async function recentTurns(conversationId: string): Promise<Anthropic.MessageParam[]> {
  const rows = await db
    .select({
      body: messages.body,
      fromAssistant: messages.fromAssistant,
      repliesToId: messages.repliesToId,
      seq: messages.seq,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        isNull(messages.recalledAt),
        or(eq(messages.fromAssistant, true), sql`${messages.body} ~ '^(@|/)'`)
      )
    )
    .orderBy(desc(messages.seq))
    .limit(MAX_TURNS * 2)

  return rows
    .reverse()
    .filter((row) => row.body.trim())
    .map((row) => ({
      role: row.fromAssistant ? ('assistant' as const) : ('user' as const),
      content: row.body,
    }))
}

async function priceOf(inputTokens: number, outputTokens: number): Promise<number> {
  const pricing = await getModelPricing(BUILT_IN_PRICING)
  const price = pricing[DEFAULT_MODEL]
  if (!price) return 0

  return (inputTokens * price.input) / 1_000_000 + (outputTokens * price.output) / 1_000_000
}

async function recordUsage(input: {
  userId: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}): Promise<void> {
  if (input.costUsd <= 0) return

  const period = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7)

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .orderBy(desc(projects.isFlagship))
    .limit(1)

  // The ledger is per project and `project_id` is NOT NULL; with no project
  // there is nothing to bill against and the spend is not recorded rather
  // than invented against a made-up id.
  if (!project) return

  await db.insert(usageLedger).values({
    projectId: project.id,
    source: 'AI_JOB',
    kind: 'ACTUAL',
    description: 'AI 助理對話',
    unit: 'tokens',
    quantity: String(input.inputTokens + input.outputTokens),
    amount: String(input.costUsd.toFixed(6)),
    currency: 'USD',
    period,
  })
}
