'use client'

import { Layers, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox, Field, Input, Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { episodeTitleFor } from '@/lib/episode-batch-view'

/**
 * 批次建立集數 (Z66, design 32).
 *
 * `episodeBatchSchema` 寫好很久、零個呼叫端——`npm run check:dead` 掃出來的
 * 那批「寫好了沒人用」之一，待辦上也一直寫著「驗證器已存在，缺介面」。
 *
 * ## 為什麼要有預覽
 *
 * 這顆按鈕一次能建 500 集，而且**建了就在那裡**——沒有「取消批次」這種東
 * 西，只能一集一集刪。所以送出之前先把「會建哪幾集、標題長什麼樣」算給人
 * 看，那一行預覽是這個對話框最重要的部分。
 */
export function EpisodeBatchCreate({
  projectId,
  arcs,
  defaultTargetSec,
  existingNumbers,
}: {
  projectId: string
  arcs: { id: string; title: string }[]
  defaultTargetSec: number
  /** 目前這部作品已經有的集號，用來預覽會跳過幾集。 */
  existingNumbers: number[]
}) {
  const router = useRouter()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const [arcId, setArcId] = useState(arcs[0]?.id ?? '')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [targetSec, setTargetSec] = useState(String(defaultTargetSec || 150))
  const [titleTemplate, setTitleTemplate] = useState('')
  const [skipExisting, setSkipExisting] = useState(true)

  const fromNumber = Number(from)
  const toNumber = Number(to)
  const rangeOk =
    Number.isInteger(fromNumber) &&
    Number.isInteger(toNumber) &&
    fromNumber >= 1 &&
    toNumber >= fromNumber &&
    toNumber - fromNumber < 500

  /*
   * 預覽在瀏覽器算。`episodeTitleFor` 是純函式，而「會建幾集」只要比對已有
   * 的集號——兩件事都不需要往返伺服器，而要往返的話這個預覽就不會是即時的。
   */
  const taken = new Set(existingNumbers)
  const wanted = rangeOk
    ? Array.from({ length: toNumber - fromNumber + 1 }, (_, i) => fromNumber + i)
    : []
  const willCreate = wanted.filter((n) => !taken.has(n))
  const willSkip = wanted.filter((n) => taken.has(n))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !rangeOk || !arcId) return

    setBusy(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/episodes/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          arcId,
          from: fromNumber,
          to: toNumber,
          targetSec: Number(targetSec) || 150,
          titleTemplate: titleTemplate.trim(),
          skipExisting,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { created: number; skipped: number[] }
      toast.success(
        `建立了 ${body.created} 集`,
        body.skipped.length > 0 ? `跳過已存在的 ${body.skipped.length} 集。` : undefined
      )
      setOpen(false)
      setFrom('')
      setTo('')
      router.refresh()
    } catch (cause) {
      toast.error('建不出來', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  if (arcs.length === 0) return null

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        leadingIcon={<Layers aria-hidden className="size-3.5" />}
        onClick={() => setOpen(true)}
      >
        批次建立
      </Button>

      {open && (
        <Dialog
          open
          onRequestClose={() => {
            if (!busy) setOpen(false)
          }}
          title="批次建立集數"
          description="一次建立一個範圍的集數。每一集會同時建立九個製作階段的紀錄。"
          busy={busy}
          footer={
            <div className="flex w-full items-center justify-between gap-3">
              {/*
                文案要是事實 (Z164).
                本來寫「只能一集一集刪」——而**整個系統沒有刪除集數的功能**：
                `/api/projects/[id]/episodes/` 底下沒有 DELETE，全 src 也沒有
                任何地方對 `episodes` 設 `deletedAt`。一句比沒寫更危險的話。
              */}
              <span className="text-[11px] text-amber-300">
                目前沒有刪除集數的功能——建錯了只能改標題，範圍要想清楚
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={(event) => void submit(event as unknown as React.FormEvent)}
                  loading={busy}
                  loadingText="建立中…"
                  disabled={!rangeOk || willCreate.length === 0}
                  leadingIcon={<Plus aria-hidden className="size-3.5" />}
                >
                  建立 {willCreate.length} 集
                </Button>
              </div>
            </div>
          }
        >
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
            {arcs.length > 1 && (
              <Field label="建在哪一卷">
                <Select
                  value={arcId}
                  onChange={(event) => setArcId(event.target.value)}
                  options={arcs.map((arc) => ({ value: arc.id, label: arc.title }))}
                />
              </Field>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="從第幾集">
                <Input
                  type="number"
                  min={1}
                  max={999}
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  placeholder="1"
                />
              </Field>
              <Field label="到第幾集">
                <Input
                  type="number"
                  min={1}
                  max={999}
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  placeholder="120"
                />
              </Field>
              <Field label="目標片長" description="秒。短劇一集 120–180 秒。">
                <Input
                  type="number"
                  min={10}
                  max={3600}
                  value={targetSec}
                  onChange={(event) => setTargetSec(event.target.value)}
                />
              </Field>
            </div>

            <Field
              label="標題樣板（選填）"
              description="{n} 換成集號、{nnn} 補零到三位。留白就是不取標題——之後才答得出「哪幾集還沒命名」。"
            >
              <Input
                value={titleTemplate}
                maxLength={120}
                onChange={(event) => setTitleTemplate(event.target.value)}
                placeholder="留白"
              />
            </Field>

            <Checkbox
              checked={skipExisting}
              onChange={(event) => setSkipExisting(event.target.checked)}
              label="跳過已經存在的集數"
              description="不勾的話，範圍內只要有一集已存在就整批不建。"
            />

            {/*
              預覽。這個對話框一次能建 500 集而且沒有復原，所以送出前要先把
              結果講清楚——而不是按下去才知道。
            */}
            <div className="rounded-lg bg-stage-850/60 px-3 py-2 text-[11px] leading-relaxed text-ink-400 ring-1 ring-inset ring-stage-700/70">
              {!rangeOk ? (
                <span className="text-ink-600">填好範圍之後這裡會顯示會建哪幾集。</span>
              ) : willCreate.length === 0 ? (
                <span className="text-amber-300">
                  這個範圍裡每一集都已經存在了，沒有東西要建。
                </span>
              ) : (
                <>
                  會建 <strong className="text-ink-100">{willCreate.length}</strong> 集：
                  EP{String(willCreate[0]).padStart(3, '0')}
                  {willCreate.length > 1 && (
                    <> – EP{String(willCreate.at(-1)).padStart(3, '0')}</>
                  )}
                  {willSkip.length > 0 && (
                    <span className="text-amber-300">
                      ，跳過已存在的 {willSkip.length} 集
                    </span>
                  )}
                  <br />
                  <span className="text-ink-600">
                    階段紀錄 {willCreate.length * 9} 筆・
                    標題
                    {titleTemplate.trim()
                      ? `會是「${episodeTitleFor(titleTemplate, willCreate[0] ?? 1)}」這樣`
                      : '留空'}
                  </span>
                </>
              )}
            </div>
          </form>
        </Dialog>
      )}
    </>
  )
}
