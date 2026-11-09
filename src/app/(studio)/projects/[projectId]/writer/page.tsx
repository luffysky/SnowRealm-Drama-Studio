import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { WriterAssistant } from '@/components/studio/WriterAssistant'
import { auditableEpisodes } from '@/lib/ai/story-audit'
import { can } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'

export const metadata: Metadata = { title: '編劇助手' }

type Params = { params: Promise<{ projectId: string }> }

/**
 * 編劇助手 (Z198).
 *
 * 暖寶的原話是「整理給我看」——所以這一頁沒有任何要貼內容的輸入框，材料由伺服
 * 器端自己從這部作品裡讀。她要的四件事寫在畫面上方，而報告就是在回答那四件事。
 *
 * 老闆的 mockup 把它畫在全域側邊欄，但它每一個輸入都是作品範圍的，所以照
 * spec v3 §11.3 放在作品分頁。
 */
export default async function WriterPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const episodes = await auditableEpisodes(project.id)

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <WriterAssistant
        projectId={project.id}
        episodes={episodes}
        canRun={can(user, 'ai.run')}
      />
    </div>
  )
}
