'use client'

import { AlertCircle } from 'lucide-react'
import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/utils'

/**
 * Form primitives. A `Field` owns the label / description / error wiring and
 * passes the generated ids down through context, so every input is correctly
 * associated without each caller repeating `aria-describedby` by hand.
 */

type FieldContextValue = {
  inputId: string
  describedBy: string | undefined
  invalid: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

function useFieldContext() {
  return useContext(FieldContext)
}

export type FieldProps = {
  label?: string
  /** Helper text under the label. */
  description?: string
  /** Server- or client-side validation message. Presence marks the field invalid. */
  error?: string | null
  required?: boolean
  /** Shown right-aligned on the label row, e.g. a character counter. */
  hint?: ReactNode
  className?: string
  children: ReactNode
}

export function Field({
  label,
  description,
  error,
  required,
  hint,
  className,
  children,
}: FieldProps) {
  const baseId = useId()
  const inputId = `${baseId}-input`
  const descriptionId = description ? `${baseId}-description` : undefined
  const errorId = error ? `${baseId}-error` : undefined

  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <FieldContext.Provider value={{ inputId, describedBy, invalid: Boolean(error) }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        {(label || hint) && (
          <div className="flex items-baseline justify-between gap-3">
            {label && (
              <label htmlFor={inputId} className="text-xs font-medium text-ink-200">
                {label}
                {required && (
                  <span aria-hidden className="ml-0.5 text-rose-400">
                    *
                  </span>
                )}
                {required && <span className="sr-only">（必填）</span>}
              </label>
            )}
            {hint && <span className="text-[11px] text-ink-500">{hint}</span>}
          </div>
        )}

        {description && (
          <p id={descriptionId} className="text-[11px] leading-relaxed text-ink-500">
            {description}
          </p>
        )}

        {children}

        {error && (
          <p
            id={errorId}
            role="alert"
            className="flex items-start gap-1.5 text-[11px] text-rose-400"
          >
            <AlertCircle aria-hidden className="mt-px size-3 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </FieldContext.Provider>
  )
}

const CONTROL_BASE =
  'w-full bg-stage-900 text-sm text-ink-50 placeholder:text-ink-600 ' +
  'ring-1 ring-inset ring-stage-700 rounded-md transition-colors ' +
  'hover:ring-stage-600 focus:ring-2 focus:ring-accent-500 focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-stage-850 disabled:text-ink-500 ' +
  'aria-[invalid=true]:ring-rose-500/70'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, id, ...rest }, ref) {
    const field = useFieldContext()
    return (
      <input
        ref={ref}
        id={id ?? field?.inputId}
        aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
        aria-invalid={rest['aria-invalid'] ?? field?.invalid ?? undefined}
        className={cn(CONTROL_BASE, 'h-9 px-3', className)}
        {...rest}
      />
    )
  }
)

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, id, rows = 4, ...rest }, ref) {
  const field = useFieldContext()
  return (
    <textarea
      ref={ref}
      id={id ?? field?.inputId}
      rows={rows}
      aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
      aria-invalid={rest['aria-invalid'] ?? field?.invalid ?? undefined}
      className={cn(CONTROL_BASE, 'resize-y px-3 py-2 leading-relaxed', className)}
      {...rest}
    />
  )
})

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  options: readonly { value: string; label: string; disabled?: boolean }[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, id, options, placeholder, ...rest },
  ref
) {
  const field = useFieldContext()
  return (
    <select
      ref={ref}
      id={id ?? field?.inputId}
      aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
      aria-invalid={rest['aria-invalid'] ?? field?.invalid ?? undefined}
      className={cn(CONTROL_BASE, 'h-9 px-3 pr-8', className)}
      {...rest}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  )
})

/** Checkbox with its label, for settings rows. */
export function Checkbox({
  label,
  description,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  const id = useId()
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={id}
        type="checkbox"
        className={cn(
          'mt-0.5 size-4 shrink-0 rounded border-stage-600 bg-stage-900',
          'text-accent-500 accent-accent-500',
          'focus:ring-2 focus:ring-accent-500 focus:ring-offset-0'
        )}
        {...rest}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-xs text-ink-200 select-none">
          {label}
        </label>
        {description && <p className="text-[11px] text-ink-500">{description}</p>}
      </div>
    </div>
  )
}

/** Groups fields into a titled block inside a dialog tab. */
export function FieldGroup({
  title,
  description,
  children,
  className,
}: {
  title?: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      {title && (
        <div className="flex flex-col gap-0.5">
          <h3 className="text-xs font-semibold tracking-wide text-ink-400 uppercase">{title}</h3>
          {description && <p className="text-[11px] text-ink-500">{description}</p>}
        </div>
      )}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}
