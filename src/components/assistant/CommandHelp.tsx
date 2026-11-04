'use client'

import { HelpCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { COMMAND_GROUPS, SLASH_COMMANDS } from '@/lib/assistant/triggers'
import { cn } from '@/lib/utils'

/**
 * 指令說明 (Z100).
 *
 * The picker in the composer shows one line per command, which is enough to
 * pick one you already know and not enough to learn what they are for. This is
 * the long version, behind a 「?」 — grouped by the thing worth knowing before
 * you press send: whether the command only reads, or comes back with something
 * to decide and pay for.
 *
 * Built from the same `SLASH_COMMANDS` array that parses the commands and that
 * `/help` prints, so there is one list and it cannot drift.
 *
 * Every example is clickable and lands in the composer rather than being sent,
 * because the examples name real characters and episodes of this work — 「照
 * 著改一個字就能用」 is the point, not 「按下去看看會發生什麼」.
 */
export function CommandHelp({ onPick }: { onPick: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    const away = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((on) => !on)}
        aria-label="指令說明"
        aria-expanded={open}
        className={cn(
          'tap rounded-lg p-1.5 transition-colors',
          open ? 'bg-stage-800 text-cyan-300' : 'text-ink-500 hover:bg-stage-800 hover:text-ink-200'
        )}
      >
        <HelpCircle aria-hidden className="size-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="指令說明"
          /*
           * Anchored right on desktop, but a near-full-width sheet on a phone:
           * a 360px popover hanging off a button 24px from the right edge is
           * half off-screen at 390px wide.
           */
          className="panel animate-rise absolute top-full right-0 z-40 mt-1.5 max-h-[min(70dvh,34rem)] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl bg-stage-850 p-3 shadow-2xl shadow-stage-990/80 ring-1 ring-stage-700"
        >
          <div className="mb-2 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-ink-50">指令</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-ink-500">
                不用指令直接說也可以。指令的作用是把範圍跟做法講死——
                例如 <span className="font-mono text-accent-300">/polish</span> 明確禁止它動情節。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="關閉"
              className="tap shrink-0 rounded p-0.5 text-ink-600 hover:text-ink-200"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>

          {COMMAND_GROUPS.map((group) => {
            const commands = SLASH_COMMANDS.filter((command) => command.group === group.key)
            if (commands.length === 0) return null

            return (
              <section key={group.key} className="mt-3 first:mt-1">
                <div className="flex items-baseline gap-1.5">
                  <h3
                    className={cn(
                      'text-[11px] font-medium',
                      group.key === 'propose' ? 'text-amber-300' : 'text-ink-200'
                    )}
                  >
                    {group.label}
                  </h3>
                  {group.note && <span className="text-[9px] text-ink-600">{group.note}</span>}
                </div>

                <ul className="mt-1 flex flex-col gap-1.5">
                  {commands.map((command) => (
                    <li
                      key={command.name}
                      className="rounded-lg bg-stage-900/60 p-2 ring-1 ring-stage-700/60"
                    >
                      <p className="font-mono text-[11px] text-accent-300">{command.usage}</p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-ink-400">
                        {command.detail}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          onPick(command.example)
                          setOpen(false)
                          document.getElementById('assistant-draft')?.focus()
                        }}
                        className="mt-1 w-full truncate rounded-md bg-stage-800 px-2 py-1 text-left font-mono text-[10px] text-ink-300 transition-colors hover:bg-stage-700 hover:text-ink-100"
                        title="填進輸入框"
                      >
                        {command.example}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}

          <p className="mt-3 border-t border-stage-700/60 pt-2 text-[10px] leading-relaxed text-ink-500">
            「會提案」的指令不會直接改東西。它會給你 diff，你按套用才會動，
            而且套用之前先把原本的存成版本快照。
          </p>
        </div>
      )}
    </div>
  )
}
