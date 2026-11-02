'use client'

import { AlertTriangle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Field, Input } from './Field'

/**
 * Confirmation for an irreversible action.
 *
 * When `confirmName` is given the user must retype it before the action
 * unlocks. Both members are OWNER, so a role check stops nothing here — making
 * the user type the record's name is the real protection against deleting the
 * wrong thing (see `isDestructive` in lib/auth/rbac.ts).
 */
export type ConfirmDialogProps = {
  open: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  title: string
  /** What will happen, in plain terms. */
  message: ReactNode
  /** Rendered as a highlighted list of affected records. */
  impact?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
  /** Require the user to type this exact string to enable the confirm button. */
  confirmName?: string
  busy?: boolean
}

/**
 * Unmounts entirely while closed. That is what resets the typed confirmation
 * name between openings — a previous attempt can never leave the confirm
 * button pre-armed, and no effect or ref juggling is needed to achieve it.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null
  return <ConfirmDialogContent {...props} />
}

function ConfirmDialogContent({
  open,
  onCancel,
  onConfirm,
  title,
  message,
  impact,
  confirmLabel = '確認',
  cancelLabel = '取消',
  tone = 'danger',
  confirmName,
  busy = false,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const nameMatches = !confirmName || typed === confirmName
  const isBusy = busy || submitting

  async function handleConfirm() {
    if (!nameMatches) return
    setSubmitting(true)
    try {
      await onConfirm()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onRequestClose={isBusy ? () => {} : onCancel}
      title={title}
      size="sm"
      busy={isBusy}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={isBusy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            disabled={!nameMatches}
            loading={isBusy}
            loadingText="處理中…"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          {tone === 'danger' && (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-rose-950 ring-1 ring-rose-800">
              <AlertTriangle aria-hidden className="size-4 text-rose-400" />
            </span>
          )}
          <div className="text-xs leading-relaxed text-ink-200">{message}</div>
        </div>

        {impact && (
          <div className="rounded-md bg-stage-900 px-3 py-2.5 text-[11px] text-ink-400 ring-1 ring-stage-700">
            {impact}
          </div>
        )}

        {confirmName && (
          <Field
            label="輸入名稱以確認"
            description={`請輸入「${confirmName}」`}
            error={typed.length > 0 && !nameMatches ? '名稱不相符' : null}
          >
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={confirmName}
              autoComplete="off"
              spellCheck={false}
              disabled={isBusy}
            />
          </Field>
        )}
      </div>
    </Dialog>
  )
}

/**
 * Guard for closing a dirty form. The spec is explicit that cancelling must not
 * quietly discard edits (「取消不得偷偷覆蓋資料」).
 */
export function UnsavedChangesDialog({
  open,
  onKeepEditing,
  onDiscard,
}: {
  open: boolean
  onKeepEditing: () => void
  onDiscard: () => void
}) {
  return (
    <ConfirmDialog
      open={open}
      onCancel={onKeepEditing}
      onConfirm={onDiscard}
      title="尚未儲存的變更"
      message="這個表單有尚未儲存的修改。關閉後這些修改會遺失。"
      confirmLabel="放棄變更"
      cancelLabel="繼續編輯"
      tone="danger"
    />
  )
}
