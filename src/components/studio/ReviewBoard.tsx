'use client'

import { CheckCircle2, Loader2, Lock, LockOpen, MessageSquare, Send, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Textarea } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { cn, formatRelativeZh } from '@/lib/utils'

/**
 * 審核發布 (Z41, designs 57–58).
 *
 * ## 這一頁顯示的鎖是真的
 *
 * `approvals.ts` 把定稿、鎖定、解鎖寫得很完整，而 `assertNotLocked` 的註解寫
 * 著「Call this at the top of any write path」——在 Z41 之前它**沒有被放在任何
 * 一條寫入路徑上**。所以如果只做這一頁而不補那些檢查，這裡的「已鎖定」會是
 * 一個純粹的裝飾：畫面說鎖了，編輯器照樣存得進去。
 *
 * 現在小說存檔、劇本存檔、章節新增與刪除、AI 採用五條路徑都會先問這個鎖。
 *
 * ## 定稿要釘住一個確切的版本
 *
 * 不是「定稿目前這一版」——那在下一次存檔之後就失去意義了。所以沒有任何快照
 * 的文件**不能**定稿，而按鈕上要說清楚為什麼，不是畫一顆按不動的鈕。
 */

type Row = {
  documentId: string
  kindLabel: string
  episodeId: string | null
  episodeNumber: number | null
  episodeTitle: string
  version: number
  charCount: number
  latestVersionId: string | null
  latestVersionNumber: number | null
  state: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'UNLOCKED'
  locked: boolean
  approvedVersionNumber: number | null
  note: string
  unlockReason: string
  decidedAt: string | null
  decidedByName: string | null
  openNotes: number
}

type Note = {
  id: string
  body: string
  state: string
  authorName: string | null
  resolvedByName: string | null
  resolvedAt: string | null
  createdAt: string
  anchorText: string
}

const STATE_LABEL: Record<Row['state'], string> = {
  NONE: '還沒送審',
  PENDING: '等待審核',
  APPROVED: '已定稿',
  REJECTED: '已退回',
  UNLOCKED: '已解鎖',
}

const STATE_STYLE: Record<Row['state'], string> = {
  NONE: 'bg-stage-800 text-ink-400 ring-stage-700',
  PENDING: 'bg-amber-950 text-amber-300 ring-amber-800',
  APPROVED: 'bg-emerald-950 text-emerald-300 ring-emerald-800',
  REJECTED: 'bg-rose-950 text-rose-300 ring-rose-800',
  UNLOCKED: 'bg-sky-950 text-sky-300 ring-sky-800',
}

type Pending =
  | { kind: 'APPROVE'; row: Row }
  | { kind: 'REJECT'; row: Row }
  | { kind: 'UNLOCK'; row: Row }
  | { kind: 'NOTE'; row: Row }

export function ReviewBoard({
  projectId,
  rows,
  counts,
  canWrite,
}: {
  projectId: string
  rows: Row[]
  counts: { total: number; locked: number; pending: number; openNotes: number }
  canWrite: boolean
}) {
  const router = useRouter()
  const toast = useToast()

  const [busy, setBusy] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [reason, setReason] = useState('')

  const [notesFor, setNotesFor] = useState<Row | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [loadingNotes, setLoadingNotes] = useState(false)

  async function decide(
    row: Row,
    action: 'REQUEST' | 'APPROVE' | 'REJECT' | 'UNLOCK',
    note: string
  ) {
    setBusy(row.documentId)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/approvals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documentId: row.documentId,
          action,
          ...(action === 'APPROVE' && row.latestVersionId
            ? { versionId: row.latestVersionId }
            : {}),
          note,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success(
        action === 'APPROVE'
          ? '已定稿並鎖定'
          : action === 'UNLOCK'
            ? '已解除鎖定'
            : action === 'REJECT'
              ? '已退回'
              : '已送審',
        action === 'APPROVE'
          ? '這份內容現在改不動——存檔與 AI 採用都會被拒絕，要改得先解鎖。'
          : undefined
      )
      setPending(null)
      setReason('')
      router.refresh()
    } catch (cause) {
      toast.error('做不到', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function openNotes(row: Row) {
    setNotesFor(row)
    setNotes([])
    setLoadingNotes(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/review-notes?documentId=${row.documentId}`
      )
      if (!response.ok) throw new Error(await readApiError(response))
      const body = (await response.json()) as { notes: Note[] }
      setNotes(body.notes)
    } catch (cause) {
      toast.error('讀不到意見', cause instanceof Error ? cause.message : undefined)
    } finally {
      setLoadingNotes(false)
    }
  }

  async function addNote(row: Row, body: string) {
    setBusy(row.documentId)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/review-notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId: row.documentId, body }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('已留下意見')
      setPending(null)
      setReason('')
      router.refresh()
    } catch (cause) {
      toast.error('留不下來', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function setNoteState(noteId: string, state: 'OPEN' | 'RESOLVED') {
    setBusy(noteId)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/review-notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      setNotes((current) =>
        current.map((note) => (note.id === noteId ? { ...note, state } : note))
      )
      router.refresh()
    } catch (cause) {
      toast.error('改不了', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
        <Heading counts={counts} />
        <EmptyState
          title="還沒有可以審核的內容"
          description="這裡列的是每一集寫了字的小說與劇本。先寫出內容，再回來送審與定稿。"
          icon={<CheckCircle2 aria-hidden className="size-5 text-ink-500" />}
          className="py-20"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <Heading counts={counts} />

      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li
            key={row.documentId}
            className="flex min-w-0 flex-col gap-2 rounded-lg bg-stage-900 p-3 ring-1 ring-stage-700/60 sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {row.episodeNumber !== null && (
                  <span className="font-mono text-[11px] text-ink-300">
                    EP{String(row.episodeNumber).padStart(3, '0')}
                  </span>
                )}
                <span className="text-[11px] text-ink-200">{row.kindLabel}</span>
                {row.episodeTitle && (
                  <span className="truncate text-[10px] text-ink-600">{row.episodeTitle}</span>
                )}
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] ring-1 ring-inset',
                    STATE_STYLE[row.state]
                  )}
                >
                  {row.locked && <Lock aria-hidden className="size-2.5" />}
                  {STATE_LABEL[row.state]}
                </span>
              </span>

              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-600">
                <span className="tabular-nums">{row.charCount.toLocaleString('en-US')} 字</span>
                <span>目前 v{row.version}</span>
                {row.approvedVersionNumber !== null && (
                  <span className="text-emerald-400">定稿於 v{row.approvedVersionNumber}</span>
                )}
                {row.decidedAt && (
                  <span>
                    {row.decidedByName ?? '某人'}・{formatRelativeZh(new Date(row.decidedAt))}
                  </span>
                )}
                {row.episodeId && (
                  <Link
                    href={`/projects/${projectId}/episodes/${row.episodeId}/${
                      row.kindLabel.includes('劇本') ? 'script' : 'novel'
                    }`}
                    className="text-accent-400 hover:text-accent-300"
                  >
                    打開編輯器
                  </Link>
                )}
              </span>

              {row.note && <span className="text-[10px] text-ink-500">備註：{row.note}</span>}
              {row.unlockReason && (
                <span className="text-[10px] text-sky-300">解鎖原因：{row.unlockReason}</span>
              )}
              {/*
                定稿釘的版本跟目前的版本不一樣，代表定稿之後又改過——這只可能
                發生在中途解鎖過。說出來，因為「已定稿」四個字會讓人以為畫面
                上的內容就是被核准的那一份。
              */}
              {row.approvedVersionNumber !== null &&
                row.approvedVersionNumber !== row.version &&
                !row.locked && (
                  <span className="text-[10px] text-amber-400">
                    定稿的是 v{row.approvedVersionNumber}，但現在是 v{row.version}
                    ——解鎖後又改過了，要重新定稿。
                  </span>
                )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void openNotes(row)}
                className="tap inline-flex items-center gap-1 rounded-lg bg-stage-850 px-2 py-1 text-[10px] text-ink-300 ring-1 ring-inset ring-stage-700 transition-colors hover:text-ink-50"
              >
                <MessageSquare aria-hidden className="size-3" />
                意見
                {row.openNotes > 0 && (
                  <span className="rounded bg-amber-500/20 px-1 text-amber-300">
                    {row.openNotes}
                  </span>
                )}
              </button>

              {canWrite && (
                <>
                  {row.locked ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      leadingIcon={<LockOpen aria-hidden className="size-3" />}
                      onClick={() => {
                        setReason('')
                        setPending({ kind: 'UNLOCK', row })
                      }}
                    >
                      解除鎖定
                    </Button>
                  ) : (
                    <>
                      {row.state === 'NONE' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          leadingIcon={<Send aria-hidden className="size-3" />}
                          loading={busy === row.documentId}
                          onClick={() => void decide(row, 'REQUEST', '')}
                        >
                          送審
                        </Button>
                      )}

                      {row.state === 'PENDING' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          leadingIcon={<XCircle aria-hidden className="size-3" />}
                          onClick={() => {
                            setReason('')
                            setPending({ kind: 'REJECT', row })
                          }}
                        >
                          退回
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="primary"
                        leadingIcon={<CheckCircle2 aria-hidden className="size-3" />}
                        onClick={() => {
                          setReason('')
                          setPending({ kind: 'APPROVE', row })
                        }}
                      >
                        定稿
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>

          </li>
        ))}
      </ul>

      {pending && (
        <Dialog
          open
          onRequestClose={() => {
            if (!busy) setPending(null)
          }}
          title={
            pending.kind === 'APPROVE'
              ? '定稿並鎖定'
              : pending.kind === 'REJECT'
                ? '退回這份內容'
                : pending.kind === 'UNLOCK'
                  ? '解除定稿鎖定'
                  : '留一則審稿意見'
          }
          description={
            pending.kind === 'APPROVE'
              ? '定稿會先把現在這份內容存成一個版本，釘住它，然後鎖定：小說存檔、劇本存檔、新增刪除章節、AI 採用都會被拒絕，直到有人說明原因並解鎖。'
              : pending.kind === 'UNLOCK'
                ? '解鎖必須說明原因。原因會留在紀錄上，不會被覆蓋掉。'
                : pending.kind === 'REJECT'
                  ? '退回必須說明原因，否則送審的人不知道該改什麼。'
                  : undefined
          }
          busy={Boolean(busy)}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPending(null)} disabled={Boolean(busy)}>
                取消
              </Button>
              <Button
                size="sm"
                variant={pending.kind === 'APPROVE' ? 'primary' : 'primary'}
                loading={Boolean(busy)}
                disabled={
                  (pending.kind === 'UNLOCK' ||
                    pending.kind === 'REJECT' ||
                    pending.kind === 'NOTE') &&
                  !reason.trim()
                }
                onClick={() => {
                  if (pending.kind === 'NOTE') void addNote(pending.row, reason.trim())
                  else void decide(pending.row, pending.kind, reason.trim())
                }}
              >
                {pending.kind === 'APPROVE'
                  ? '確認定稿'
                  : pending.kind === 'REJECT'
                    ? '退回'
                    : pending.kind === 'UNLOCK'
                      ? '解除鎖定'
                      : '留下意見'}
              </Button>
            </div>
          }
        >
          <Field
            label={
              pending.kind === 'APPROVE'
                ? '備註（選填）'
                : pending.kind === 'NOTE'
                  ? '意見'
                  : '原因'
            }
          >
            <Textarea
              value={reason}
              rows={3}
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                pending.kind === 'APPROVE'
                  ? '例：這一版拿去配音。'
                  : pending.kind === 'UNLOCK'
                    ? '例：第三場的台詞要配合新的分鏡改。'
                    : ''
              }
            />
          </Field>
        </Dialog>
      )}

      {notesFor && (
        <Dialog
          open
          onRequestClose={() => setNotesFor(null)}
          title={`審稿意見・${
            notesFor.episodeNumber !== null
              ? `EP${String(notesFor.episodeNumber).padStart(3, '0')} `
              : ''
          }${notesFor.kindLabel}`}
          size="lg"
          footer={
            <div className="flex w-full justify-between gap-2">
              {canWrite ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setReason('')
                    setPending({ kind: 'NOTE', row: notesFor })
                    setNotesFor(null)
                  }}
                >
                  留一則意見
                </Button>
              ) : (
                <span />
              )}
              <Button size="sm" variant="ghost" onClick={() => setNotesFor(null)}>
                關閉
              </Button>
            </div>
          }
        >
          {loadingNotes ? (
            <p className="flex items-center gap-2 py-6 text-[11px] text-ink-500">
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
              讀取中…
            </p>
          ) : notes.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-ink-600">還沒有任何意見。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className={cn(
                    'flex flex-col gap-1 rounded-lg bg-stage-900 p-2.5 ring-1',
                    note.state === 'RESOLVED' ? 'ring-stage-800' : 'ring-amber-500/30'
                  )}
                >
                  {note.anchorText && (
                    <span className="border-l-2 border-stage-700 pl-2 text-[10px] text-ink-600">
                      {note.anchorText}
                    </span>
                  )}
                  <span
                    className={cn(
                      'text-[11px] leading-relaxed',
                      note.state === 'RESOLVED' ? 'text-ink-500' : 'text-ink-100'
                    )}
                  >
                    {note.body}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 text-[10px] text-ink-600">
                    <span>{note.authorName ?? '某人'}</span>
                    <span>{formatRelativeZh(new Date(note.createdAt))}</span>
                    {note.state === 'RESOLVED' && (
                      <span className="text-emerald-400">
                        已處理{note.resolvedByName ? `・${note.resolvedByName}` : ''}
                      </span>
                    )}
                    {canWrite && (
                      <button
                        type="button"
                        disabled={busy === note.id}
                        onClick={() =>
                          void setNoteState(
                            note.id,
                            note.state === 'RESOLVED' ? 'OPEN' : 'RESOLVED'
                          )
                        }
                        className="rounded px-1 text-accent-400 transition-colors hover:text-accent-300 disabled:opacity-40"
                      >
                        {note.state === 'RESOLVED' ? '重新打開' : '標成已處理'}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
    </div>
  )
}

function Heading({
  counts,
}: {
  counts: { total: number; locked: number; pending: number; openNotes: number }
}) {
  return (
    <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
        <CheckCircle2 aria-hidden className="size-4 text-accent-400" />
        審核發布
      </h2>
      <p className="text-[11px] text-ink-500">
        {counts.total} 份內容
        {counts.pending > 0 && <span className="ml-2 text-amber-400">{counts.pending} 份等待審核</span>}
        {counts.locked > 0 && (
          <span className="ml-2 text-emerald-400">{counts.locked} 份已定稿鎖定</span>
        )}
        {counts.openNotes > 0 && (
          <span className="ml-2 text-amber-400">{counts.openNotes} 則意見未處理</span>
        )}
      </p>
      <p className="text-[11px] text-ink-600">
        定稿會鎖住內容——存檔與 AI 採用都會被拒絕，直到有人說明原因並解鎖。
      </p>
    </header>
  )
}
