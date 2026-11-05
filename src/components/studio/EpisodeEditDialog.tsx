'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { EPISODE_STATUSES, EPISODE_STATUS_LABEL, type EpisodeStatusValue } from '@/lib/constants'

/**
 * 編輯一集 (Z35, design 33).
 *
 * 詳情列那支鉛筆在這之前是個禁用的 `<span>`，標題寫著「集數編輯尚未實作，
 * 預計於 M1 階段交付」。
 *
 * ## 沒有集號
 *
 * `episodes.number` 是小說、劇本、分鏡、有聲書與正文裡每一句「第 007 集」共
 * 用的編號。改它等於把那些全部指向別處，而**沒有任何一個會跟著動**。要調順
 * 序是搬卷或重新規劃，不是改這個欄位。
 *
 * ## 只送改過的欄位
 *
 * 跟載入時比對，一樣的就不送。全部送出去的話，兩個人同時編輯不同欄位會互相
 * 覆蓋——而這一頁沒有樂觀鎖（`episodes` 沒有 `lock_revision`），所以少送一個
 * 欄位就是少一次覆蓋別人的機會。
 */

export type EditableEpisode = {
  id: string
  number: number
  arcId: string
  title: string
  logline: string
  synopsis: string
  notes: string
  targetSec: number
  status: EpisodeStatusValue
  /** ISO 日期字串，或 null。 */
  dueDate: string | null
}

export function EpisodeEditDialog({
  projectId,
  episode,
  arcs,
  onClose,
}: {
  projectId: string
  episode: EditableEpisode
  arcs: { id: string; title: string }[]
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()

  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: episode.title,
    logline: episode.logline,
    synopsis: episode.synopsis,
    notes: episode.notes,
    targetSec: String(episode.targetSec),
    status: episode.status,
    arcId: episode.arcId,
    // `<input type="date">` 要 YYYY-MM-DD，而存的是完整時間戳。
    dueDate: episode.dueDate ? episode.dueDate.slice(0, 10) : '',
  })

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    if (saving) return

    const seconds = Number(form.targetSec)
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) {
      toast.error('片長不對', '要是 10 到 3600 之間的整數秒。')
      return
    }

    /*
     * 只送改過的。沒改的欄位不出現在 payload 裡，所以另一個人同時改了別的
     * 欄位也不會被這次存檔蓋掉。
     */
    const patch: Record<string, unknown> = {}
    if (form.title !== episode.title) patch.title = form.title
    if (form.logline !== episode.logline) patch.logline = form.logline
    if (form.synopsis !== episode.synopsis) patch.synopsis = form.synopsis
    if (form.notes !== episode.notes) patch.notes = form.notes
    if (seconds !== episode.targetSec) patch.targetSec = seconds
    if (form.status !== episode.status) patch.status = form.status
    if (form.arcId !== episode.arcId) patch.arcId = form.arcId

    const originalDue = episode.dueDate ? episode.dueDate.slice(0, 10) : ''
    if (form.dueDate !== originalDue) patch.dueDate = form.dueDate || null

    if (Object.keys(patch).length === 0) {
      toast.info('沒有改到東西')
      onClose()
      return
    }

    setSaving(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/episodes/${episode.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('已儲存', `第 ${episode.number} 集`)
      router.refresh()
      onClose()
    } catch (cause) {
      toast.error('存不起來', cause instanceof Error ? cause.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onRequestClose={() => {
        if (!saving) onClose()
      }}
      title={`編輯第 ${episode.number} 集`}
      description="集號不能改——小說、劇本、分鏡與正文裡的「第 007 集」都指著它。"
      size="lg"
      busy={saving}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void save()}
            loading={saving}
            loadingText="儲存中…"
          >
            儲存
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="集數標題" description="留白就是還沒命名，不會自動補「第 N 集」。">
          <Input
            value={form.title}
            maxLength={120}
            onChange={(event) => set('title', event.target.value)}
            placeholder="未命名"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="製作狀態">
            <Select
              value={form.status}
              onChange={(event) => set('status', event.target.value as EpisodeStatusValue)}
              options={EPISODE_STATUSES.map((value) => ({
                value,
                label: EPISODE_STATUS_LABEL[value],
              }))}
            />
          </Field>
          <Field label="目標片長" description="秒">
            <Input
              type="number"
              min={10}
              max={3600}
              value={form.targetSec}
              onChange={(event) => set('targetSec', event.target.value)}
            />
          </Field>
          <Field label="期限">
            <Input
              type="date"
              value={form.dueDate}
              onChange={(event) => set('dueDate', event.target.value)}
            />
          </Field>
        </div>

        {arcs.length > 1 && (
          <Field label="屬於哪一卷" description="搬卷只改歸屬，集號原封不動。">
            <Select
              value={form.arcId}
              onChange={(event) => set('arcId', event.target.value)}
              options={arcs.map((arc) => ({ value: arc.id, label: arc.title }))}
            />
          </Field>
        )}

        <Field label="劇情重點" description="一句話講完這集發生什麼。列表上顯示的就是它。">
          <Textarea
            value={form.logline}
            rows={2}
            maxLength={300}
            onChange={(event) => set('logline', event.target.value)}
          />
        </Field>

        <Field label="分集大綱" description="事件與轉折。AI 生成大綱寫的也是這一欄。">
          <Textarea
            value={form.synopsis}
            rows={5}
            maxLength={5000}
            onChange={(event) => set('synopsis', event.target.value)}
          />
        </Field>

        <Field label="備註" description="給人看的，不會送進 AI。">
          <Textarea
            value={form.notes}
            rows={2}
            maxLength={2000}
            onChange={(event) => set('notes', event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  )
}
