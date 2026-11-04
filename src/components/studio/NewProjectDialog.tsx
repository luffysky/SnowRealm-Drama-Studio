'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { PROJECT_STATUS_LABEL, PROJECT_STATUSES } from '@/lib/constants'

/**
 * 新增作品 (Z63 / designs 24–29).
 *
 * The one required field is the title. A new work has nothing written yet, and
 * demanding a logline before it can exist would get a placeholder typed in —
 * which is exactly the invented copy spec v3 §0 forbids.
 *
 * 集數 defaults to 120 because that is what a short drama is here, and the
 * numbering is the plan even when every title is blank. Setting it to 0 is
 * allowed for a work whose length is genuinely undecided.
 */
export function NewProjectDialog({ canWrite }: { canWrite: boolean }) {
  const router = useRouter()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [title, setTitle] = useState('')
  const [novelTitle, setNovelTitle] = useState('')
  const [dramaTitle, setDramaTitle] = useState('')
  const [logline, setLogline] = useState('')
  const [synopsis, setSynopsis] = useState('')
  const [tagText, setTagText] = useState('')
  const [status, setStatus] = useState<string>('PLANNING')
  const [arcIndex, setArcIndex] = useState('1')
  const [arcTitle, setArcTitle] = useState('')
  const [plannedEpisodes, setPlannedEpisodes] = useState('120')
  const [targetMinSec, setTargetMinSec] = useState('120')
  const [targetMaxSec, setTargetMaxSec] = useState('180')
  const [targetChars, setTargetChars] = useState('4000')

  async function submit() {
    if (!title.trim()) {
      toast.error('請輸入作品名稱')
      return
    }

    setSaving(true)
    try {
      const response = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          novelTitle: novelTitle.trim(),
          dramaTitle: dramaTitle.trim(),
          logline: logline.trim(),
          synopsis: synopsis.trim(),
          tags: tagText
            .split(/[,，、\s]+/)
            .map((tag) => tag.trim())
            .filter(Boolean)
            .slice(0, 8),
          status,
          arcIndex: Number(arcIndex) || 1,
          arcTitle: arcTitle.trim(),
          plannedEpisodes: Number(plannedEpisodes) || 0,
          targetMinSec: Number(targetMinSec) || 120,
          targetMaxSec: Number(targetMaxSec) || 180,
          targetChars: Number(targetChars) || 4000,
        }),
      })

      if (!response.ok) throw new Error(await readApiError(response))

      /*
       * `jsonOk` returns the value as the body, not wrapped in `{ data }`.
       * Reading `body.data.id` threw「Cannot read properties of undefined」
       * *after* the work had already been created — so the dialog reported a
       * failure for something that succeeded, and the next attempt made a
       * second copy.
       */
      const body = (await response.json()) as { id: string; episodeCount: number }

      toast.success(
        `《${title.trim()}》已建立`,
        body.episodeCount > 0 ? `已排好 ${body.episodeCount} 集` : undefined
      )
      setOpen(false)
      // Straight into the new work: the next thing anyone does is set it up.
      router.push(`/projects/${body.id}`)
      router.refresh()
    } catch (cause) {
      toast.error('建立失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  if (!canWrite) {
    return (
      <span
        aria-disabled="true"
        title="你的角色沒有建立作品的權限"
        className="ml-auto inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-lg bg-stage-800 px-4 py-2 text-xs font-medium text-ink-600 ring-1 ring-stage-700"
      >
        <Plus aria-hidden className="size-4" />
        新增作品
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-brand-gradient glow-accent-sm ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
      >
        <Plus aria-hidden className="size-4" />
        新增作品
      </button>

      {/* The shared Dialog handles the portal, focus trap, Escape and the
          bottom-sheet layout on a phone. */}
      <Dialog
        open={open}
        onRequestClose={() => setOpen(false)}
        title="新增作品"
        description="只有作品名稱是必填。其他之後在「作品設定」隨時可以補。"
        size="sm"
        busy={saving}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void submit()}
              loading={saving}
              loadingText="建立中…"
              disabled={!title.trim()}
            >
              建立作品
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
                <Field label="作品名稱" required>
                  <Input
                    autoFocus
                    value={title}
                    maxLength={120}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="例：一灶見山河"
                    className="h-9 text-xs"
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="小說書名" hint="留白 = 同作品名稱">
                    <Input
                      value={novelTitle}
                      maxLength={120}
                      onChange={(event) => setNovelTitle(event.target.value)}
                      className="h-9 text-xs"
                    />
                  </Field>
                  <Field label="短劇劇名" hint="留白 = 同作品名稱">
                    <Input
                      value={dramaTitle}
                      maxLength={120}
                      onChange={(event) => setDramaTitle(event.target.value)}
                      className="h-9 text-xs"
                    />
                  </Field>
                </div>

                <Field label="一句話簡介">
                  <Input
                    value={logline}
                    maxLength={400}
                    onChange={(event) => setLogline(event.target.value)}
                    placeholder="一句話講完這部戲"
                    className="h-9 text-xs"
                  />
                </Field>

                <Field label="簡介">
                  <Textarea
                    value={synopsis}
                    rows={3}
                    maxLength={8000}
                    onChange={(event) => setSynopsis(event.target.value)}
                    className="text-xs"
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="類型標籤" hint="用逗號或空白分隔，最多 8 個">
                    <Input
                      value={tagText}
                      onChange={(event) => setTagText(event.target.value)}
                      placeholder="古風 愛情 權謀"
                      className="h-9 text-xs"
                    />
                  </Field>
                  <Field label="狀態">
                    <select
                      value={status}
                      onChange={(event) => setStatus(event.target.value)}
                      className="h-9 rounded-lg bg-stage-900 px-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 outline-none focus:ring-2 focus:ring-accent-500"
                    >
                      {PROJECT_STATUSES.map((key) => (
                        <option key={key} value={key} className="bg-stage-850">
                          {PROJECT_STATUS_LABEL[key]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="第幾部">
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={arcIndex}
                      onChange={(event) => setArcIndex(event.target.value)}
                      className="h-9 text-xs"
                    />
                  </Field>
                  <Field label="篇章名稱" hint="留白 = 第一部">
                    <Input
                      value={arcTitle}
                      maxLength={80}
                      onChange={(event) => setArcTitle(event.target.value)}
                      placeholder="萬家燈火"
                      className="h-9 text-xs"
                    />
                  </Field>
                  <Field label="集數" hint="0 = 之後再排">
                    <Input
                      type="number"
                      min={0}
                      max={999}
                      value={plannedEpisodes}
                      onChange={(event) => setPlannedEpisodes(event.target.value)}
                      className="h-9 text-xs"
                    />
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="單集片長下限（秒）">
                    <Input
                      type="number"
                      min={10}
                      max={3600}
                      value={targetMinSec}
                      onChange={(event) => setTargetMinSec(event.target.value)}
                      className="h-9 text-xs"
                    />
                  </Field>
                  <Field label="單集片長上限（秒）">
                    <Input
                      type="number"
                      min={10}
                      max={3600}
                      value={targetMaxSec}
                      onChange={(event) => setTargetMaxSec(event.target.value)}
                      className="h-9 text-xs"
                    />
                  </Field>
                </div>

                <Field
                  label="單集目標字數"
                  hint="小說編輯器的進度條以它為準。一集 120–180 秒大約 4000 字，但那是節奏問題，不是規定。"
                >
                  <Input
                    type="number"
                    min={100}
                    max={100000}
                    value={targetChars}
                    onChange={(event) => setTargetChars(event.target.value)}
                    className="h-9 text-xs"
                  />
                </Field>

          <p className="text-[10px] leading-relaxed text-ink-700">
            建立後會一併排好集數與九大製作階段的進度列，集名與大綱留空等你寫。
          </p>
        </div>
      </Dialog>
    </>
  )
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="flex items-baseline gap-1.5 text-[10px] text-ink-500">
        {label}
        {required && <span className="text-rose-400">*</span>}
        {hint && <span className="text-ink-700">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
