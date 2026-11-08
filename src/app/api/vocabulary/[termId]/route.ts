import { ApiError, handle, jsonOk, logActivity, requireUser } from '@/lib/api'
import { deleteVocabularyTerm, isVocabularyKind } from '@/lib/vocabulary'

export const runtime = 'nodejs'

/**
 * 刪掉一個自訂下拉選項 (Z184).
 *
 * **已經有東西在用它也照樣刪得掉。** 這張表是「下拉裡有哪些選項」，不是「資
 * 料裡有哪些值」——擋著不給刪的話，一個打錯字的選項只要被存過一次就永遠刪不
 * 掉。用過它的那幾筆會留著那個值，而顯示時查不到會回值本身，所以畫面上看得
 * 到 `HANDHELD_LOW`，不是一個空格。
 *
 * `kind` 從查詢字串來，而且是必要的：它讓刪除限定在呼叫端以為的那一類裡，所
 * 以一個複製錯的 id 不會刪到別類的選項。
 */
export const DELETE = handle(
  async (request: Request, context: { params: Promise<{ termId: string }> }) => {
    const user = await requireUser()
    const { termId } = await context.params

    const kind = new URL(request.url).searchParams.get('kind')
    if (!isVocabularyKind(kind)) throw ApiError.badRequest('缺少或不認得的選項類別')

    await deleteVocabularyTerm({ kind, termId })

    await logActivity({
      user,
      action: 'delete',
      entityType: 'vocabulary_term',
      entityId: termId,
      summary: `${user.name} 刪除了一個下拉選項`,
    })

    return jsonOk({ ok: true })
  }
)
