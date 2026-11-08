import { z } from 'zod'
import { handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { addVocabularyTerm, VOCABULARY_KINDS } from '@/lib/vocabulary'

export const runtime = 'nodejs'

const bodySchema = z.object({
  kind: z.enum(VOCABULARY_KINDS),
  value: z.string().trim().min(1, '缺少代碼').max(32),
  label: z.string().trim().min(1, '缺少名稱').max(20),
})

/**
 * 加一個自訂下拉選項 (Z184).
 *
 * 不掛在作品底下：這張表是工作室共用的（見 `@/lib/vocabulary`），而「景別」
 * 是電影語言，不是某一部戲的設定。
 *
 * 權限只要求登入。這間工作室兩個人都是 OWNER，而加一個景別是最輕的那種寫入
 * ——它不動任何既有資料，而且刪得掉。
 */
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJson(request, bodySchema)

  const term = await addVocabularyTerm({
    user,
    kind: input.kind,
    value: input.value,
    label: input.label,
  })

  await logActivity({
    user,
    action: 'create',
    entityType: 'vocabulary_term',
    entityId: term.id,
    summary: `${user.name} 新增了一個下拉選項「${term.label}」`,
  })

  return jsonOk({ term }, { status: 201 })
})
