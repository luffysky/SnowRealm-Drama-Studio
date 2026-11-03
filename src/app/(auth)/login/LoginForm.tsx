'use client'

import { Eye, EyeOff, LogIn } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox, Field, Input } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { apiFetch } from '@/lib/client-fetch'

/**
 * Login form (spec 02). Two seeded accounts only — there is no registration
 * link, no invite flow and no third-party sign-in, by design.
 *
 * The first field takes either the member's handle or their email address;
 * the server decides which column to match. It is a plain text input rather
 * than `type="email"`, because a handle would otherwise trip the browser's own
 * validation before the request is ever made.
 */
export function LoginForm() {
  const router = useRouter()
  const toast = useToast()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)

    if (!identifier.trim() || !password) {
      setFormError('請輸入帳號與密碼')
      return
    }

    setSubmitting(true)
    try {
      const response = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), password, remember }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null
        setFormError(body?.error?.message ?? '登入失敗，請稍後再試')
        return
      }

      const { user } = (await response.json()) as { user: { name: string } }
      toast.success('登入成功', `歡迎回來，${user.name}`)

      // Refresh so the server components pick up the new session cookie.
      router.replace('/dashboard')
      router.refresh()
    } catch {
      setFormError('無法連線到伺服器，請檢查網路後重試')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Field label="帳號" hint="輸入帳號或 Email 皆可" required>
        <Input
          type="text"
          name="identifier"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder="帳號或 Email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          disabled={submitting}
        />
      </Field>

      <Field label="密碼" required>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            disabled={submitting}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
            aria-pressed={showPassword}
            disabled={submitting}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-ink-500 hover:text-ink-200"
          >
            {showPassword ? (
              <EyeOff aria-hidden className="size-4" />
            ) : (
              <Eye aria-hidden className="size-4" />
            )}
          </button>
        </div>
      </Field>

      <Checkbox
        label="記住登入狀態"
        description="在這台裝置上保持登入 30 天"
        checked={remember}
        onChange={(event) => setRemember(event.target.checked)}
        disabled={submitting}
      />

      {formError && (
        <p
          role="alert"
          className="rounded-md bg-rose-950/60 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-800"
        >
          {formError}
        </p>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={submitting}
        loadingText="登入中…"
        leadingIcon={<LogIn aria-hidden className="size-4" />}
      >
        登入
      </Button>

      <p className="text-center text-[11px] leading-relaxed text-ink-600">
        本系統僅供兩位成員使用，不提供註冊或第三方登入。
        <br />
        忘記密碼請由另一位成員協助重設。
      </p>
    </form>
  )
}
