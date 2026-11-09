import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { WriterGuide } from '@/components/studio/WriterGuide'
import { getSessionUser } from '@/lib/auth/session'

export const metadata: Metadata = { title: '編劇助手怎麼用' }

/**
 * 編劇助手怎麼用 (Z202).
 *
 * 獨立成一頁而不是塞進 `/help`：那一頁的規矩是「會用到的直接寫在上面」，而這一
 * 頁有一個需要互動才講得清楚的概念（隱藏設定填不填，判定會差很多），攤平成文字
 * 就失去意義了。匯入那一節當初獨立出去也是同一個理由。
 *
 * 範例資料全部是第 1 集真的跑出來的，見 `src/lib/help-writer.ts` 的檔頭。
 */
export default async function WriterHelpPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <Link
        href="/help"
        className="self-start text-[13px] text-ink-500 transition-colors hover:text-ink-200"
      >
        ← 回使用說明
      </Link>
      <WriterGuide />
    </div>
  )
}
