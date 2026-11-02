'use client'

import { Loader2 } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gilt'
type Size = 'sm' | 'md' | 'lg' | 'icon'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent-600 text-white hover:bg-accent-500 active:bg-accent-700 ' +
    'disabled:bg-accent-600/40 disabled:text-white/60',
  secondary:
    'bg-stage-750 text-ink-200 ring-1 ring-inset ring-stage-600 hover:bg-stage-700 ' +
    'hover:text-ink-50 active:bg-stage-800',
  ghost: 'text-ink-400 hover:bg-stage-800 hover:text-ink-50',
  danger:
    'bg-rose-600 text-white hover:bg-rose-500 active:bg-rose-700 ' +
    'disabled:bg-rose-600/40 disabled:text-white/60',
  /** Reserved for 定稿 / approve — the one place gold is earned. */
  gilt: 'bg-gilt-400 text-stage-950 font-semibold hover:bg-gilt-300 active:bg-gilt-500',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-4 text-sm gap-2 rounded-md',
  lg: 'h-11 px-6 text-sm gap-2 rounded-lg',
  icon: 'h-9 w-9 rounded-md',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  loading?: boolean
  /** Shown while `loading`; falls back to the normal children. */
  loadingText?: string
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    loadingText,
    leadingIcon,
    trailingIcon,
    fullWidth = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      // A loading button stays focusable but rejects clicks, so a screen reader
      // user is not thrown out of the control mid-action.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap',
        'transition-colors duration-100',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 aria-hidden className="size-4 animate-spin" />
      ) : (
        leadingIcon
      )}
      {size !== 'icon' && <span>{loading && loadingText ? loadingText : children}</span>}
      {!loading && trailingIcon}
    </button>
  )
})
