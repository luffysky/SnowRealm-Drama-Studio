import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { aiProviders, modelAssignments } from '@/db/schema'
import { AI_JOB_KINDS, AI_JOB_KIND_LABEL, type AiJobKindValue } from '@/lib/constants'
import type { AiTaskKind } from './types'

/**
 * 哪個任務用哪個模型 (Z152).
 *
 * `model_assignments` 這張表從第一支 migration 就在，形狀也正好對：
 * 任務 → 供應商＋模型＋effort＋maxTokens＋候選數，每個任務一組。
 * **零個呼叫端。** 於是 `adapterForTask()` 一直是「挑第一個啟用、支援這個
 * 任務的供應商」——接了七家也只會用到一家。
 *
 * ## 為什麼在排隊的時候套用，不是在執行的時候
 *
 * `ai_jobs` 這一列本來就存 `provider_id`、`model`，以及 request 裡的
 * effort／maxTokens／候選數。在排隊時把指派寫進去，這一列就**記得它實際用
 * 了什麼**——成本帳、`ai_outputs.model` 的來源追溯、還有「這段是哪個模型
 * 寫的」都靠它。
 *
 * 留到執行時才查，任務列上會是空的，而那個空白沒有任何地方補得回來。
 *
 * ## 估價也要套用同一組
 *
 * 不然報價是 A 模型的、實際跑的是 B 模型——那是跟匯率那個壞掉的表同一類的
 * 錯：每個數字看起來都像數字，只是跟事實無關。
 */

export type Assignment = {
  task: AiJobKindValue
  providerId: string
  model: string
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxTokens: number
  candidates: number
}

export type AssignmentRow = Assignment & {
  providerLabel: string
  providerKind: string
  providerEnabled: boolean
}

/** 一個任務的指派，沒有設就是 null。 */
export async function assignmentFor(task: AiTaskKind): Promise<Assignment | null> {
  const [row] = await db
    .select({
      task: modelAssignments.task,
      providerId: modelAssignments.providerId,
      model: modelAssignments.model,
      effort: modelAssignments.effort,
      maxTokens: modelAssignments.maxTokens,
      candidates: modelAssignments.candidates,
    })
    .from(modelAssignments)
    .where(eq(modelAssignments.task, task as AiJobKindValue))
    .limit(1)

  if (!row) return null

  return {
    task: row.task,
    providerId: row.providerId,
    model: row.model,
    effort: row.effort as Assignment['effort'],
    maxTokens: row.maxTokens,
    candidates: row.candidates,
  }
}

/**
 * 每一個任務一列，沒設的也要出現。
 *
 * 沒設的不出現的話，面板只會顯示「已經設過的」，而**還沒設的才是需要看見
 * 的那些**——那正是這張表躺著沒人用的原因之一。
 */
export async function listAssignments(): Promise<{
  rows: { task: AiJobKindValue; label: string; assignment: AssignmentRow | null }[]
  providers: { id: string; label: string; kind: string; enabled: boolean; models: string[] }[]
}> {
  const [assigned, providers] = await Promise.all([
    db
      .select({
        task: modelAssignments.task,
        providerId: modelAssignments.providerId,
        model: modelAssignments.model,
        effort: modelAssignments.effort,
        maxTokens: modelAssignments.maxTokens,
        candidates: modelAssignments.candidates,
        providerLabel: aiProviders.label,
        providerKind: aiProviders.kind,
        providerEnabled: aiProviders.enabled,
      })
      .from(modelAssignments)
      .innerJoin(aiProviders, eq(aiProviders.id, modelAssignments.providerId)),

    db
      .select({
        id: aiProviders.id,
        label: aiProviders.label,
        kind: aiProviders.kind,
        enabled: aiProviders.enabled,
        defaultModel: aiProviders.defaultModel,
        availableModels: aiProviders.availableModels,
      })
      .from(aiProviders)
      .orderBy(asc(aiProviders.createdAt)),
  ])

  const byTask = new Map(assigned.map((row) => [row.task, row]))

  return {
    rows: AI_JOB_KINDS.map((task) => {
      const row = byTask.get(task)
      return {
        task,
        label: AI_JOB_KIND_LABEL[task] ?? task,
        assignment: row
          ? {
              task: row.task,
              providerId: row.providerId,
              model: row.model,
              effort: row.effort as Assignment['effort'],
              maxTokens: row.maxTokens,
              candidates: row.candidates,
              providerLabel: row.providerLabel,
              providerKind: row.providerKind,
              providerEnabled: row.providerEnabled,
            }
          : null,
      }
    }),
    providers: providers.map((row) => ({
      id: row.id,
      label: row.label,
      kind: row.kind,
      enabled: row.enabled,
      /** 預設模型也算一個選項——抓過模型清單的話那裡會更多。 */
      models: [
        ...new Set([...(row.availableModels ?? []), row.defaultModel].filter(Boolean)),
      ] as string[],
    })),
  }
}

export async function setAssignment(input: Assignment): Promise<void> {
  await db
    .insert(modelAssignments)
    .values({
      task: input.task,
      providerId: input.providerId,
      model: input.model,
      effort: input.effort,
      maxTokens: input.maxTokens,
      candidates: input.candidates,
    })
    /*
     * 每個任務只能有一組（`model_assignments_task_idx` 是 unique）。
     * 重設就是覆蓋，不是再插一列。
     */
    .onConflictDoUpdate({
      target: modelAssignments.task,
      set: {
        providerId: input.providerId,
        model: input.model,
        effort: input.effort,
        maxTokens: input.maxTokens,
        candidates: input.candidates,
        updatedAt: new Date(),
      },
    })
}

export async function clearAssignment(task: AiJobKindValue): Promise<void> {
  await db.delete(modelAssignments).where(eq(modelAssignments.task, task))
}

/**
 * 把指派填進一個請求裡，**只填呼叫端沒有指定的**。
 *
 * 呼叫端說了算：介面上明確選了某個供應商或模型的時候，那是人的決定，不該
 * 被預設值蓋掉。指派是「沒有人特別說的時候用什麼」。
 */
export async function applyAssignment<
  T extends {
    task: AiTaskKind
    providerId?: string | null
    model?: string
    effort?: Assignment['effort']
    maxTokens?: number
    candidates?: number
  },
>(input: T): Promise<T> {
  // 已經指名供應商就整組不套用——混用一半指派一半指名會很難解釋。
  if (input.providerId) return input

  const assignment = await assignmentFor(input.task)
  if (!assignment) return input

  return {
    ...input,
    providerId: assignment.providerId,
    model: input.model || assignment.model,
    effort: input.effort ?? assignment.effort,
    maxTokens: input.maxTokens ?? assignment.maxTokens,
    candidates: input.candidates ?? assignment.candidates,
  }
}
