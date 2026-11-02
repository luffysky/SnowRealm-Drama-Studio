'use client'

import { useCallback, useId, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Tab strip for the dialogs, which are all tabbed (spec §二 requires each tab
 * to be a real, independently verifiable view — not just a label).
 *
 * Keyboard behaviour follows the ARIA tabs pattern: arrows move between tabs,
 * Home/End jump to the ends, and only the active tab is in the tab order.
 */

export type TabItem = {
  id: string
  label: string
  /** Small count or status dot rendered after the label. */
  badge?: ReactNode
  disabled?: boolean
}

export type TabsProps = {
  tabs: readonly TabItem[]
  activeId: string
  onChange: (id: string) => void
  className?: string
  /** `pill` for a segmented control, `underline` for a document-style strip. */
  appearance?: 'underline' | 'pill'
}

export function Tabs({ tabs, activeId, onChange, className, appearance = 'underline' }: TabsProps) {
  const baseId = useId()
  const listRef = useRef<HTMLDivElement>(null)

  const move = useCallback(
    (direction: 1 | -1 | 'first' | 'last') => {
      const enabled = tabs.filter((t) => !t.disabled)
      if (enabled.length === 0) return

      let next: TabItem | undefined
      if (direction === 'first') next = enabled[0]
      else if (direction === 'last') next = enabled[enabled.length - 1]
      else {
        const currentIndex = enabled.findIndex((t) => t.id === activeId)
        const nextIndex = (currentIndex + direction + enabled.length) % enabled.length
        next = enabled[nextIndex]
      }

      if (!next) return
      onChange(next.id)
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-tab-id="${next.id}"]`)
        ?.focus()
    },
    [activeId, onChange, tabs]
  )

  return (
    <div
      ref={listRef}
      role="tablist"
      className={cn(
        'flex items-center gap-1 overflow-x-auto',
        appearance === 'underline' && 'border-b border-stage-700',
        appearance === 'pill' && 'rounded-lg bg-stage-900 p-1 ring-1 ring-stage-700',
        className
      )}
      onKeyDown={(event) => {
        switch (event.key) {
          case 'ArrowRight':
          case 'ArrowDown':
            event.preventDefault()
            move(1)
            break
          case 'ArrowLeft':
          case 'ArrowUp':
            event.preventDefault()
            move(-1)
            break
          case 'Home':
            event.preventDefault()
            move('first')
            break
          case 'End':
            event.preventDefault()
            move('last')
            break
        }
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-tab-id={tab.id}
            id={`${baseId}-${tab.id}-tab`}
            aria-selected={active}
            aria-controls={`${baseId}-${tab.id}-panel`}
            // Only the selected tab is tabbable; arrows move within the strip.
            tabIndex={active ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap transition-colors',
              'disabled:cursor-not-allowed disabled:text-ink-600',
              appearance === 'underline' && [
                '-mb-px border-b-2 px-3 py-2.5',
                active
                  ? 'border-accent-500 text-ink-50'
                  : 'border-transparent text-ink-500 hover:border-stage-600 hover:text-ink-200',
              ],
              appearance === 'pill' && [
                'rounded-md px-3 py-1.5',
                active
                  ? 'bg-stage-700 text-ink-50 shadow-sm'
                  : 'text-ink-500 hover:bg-stage-800 hover:text-ink-200',
              ]
            )}
          >
            {tab.label}
            {tab.badge}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({
  tabsId,
  id,
  activeId,
  children,
  className,
}: {
  /** Must match the `useId` prefix of the owning Tabs; pass the same string. */
  tabsId?: string
  id: string
  activeId: string
  children: ReactNode
  className?: string
}) {
  if (id !== activeId) return null

  return (
    <div
      role="tabpanel"
      id={tabsId ? `${tabsId}-${id}-panel` : undefined}
      tabIndex={0}
      className={cn('focus:outline-none', className)}
    >
      {children}
    </div>
  )
}
