import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { LoginForm } from './LoginForm'

export const metadata: Metadata = { title: '登入' }

export default async function LoginPage() {
  // Already signed in: skip the form.
  const user = await getSessionUser()
  if (user) redirect('/dashboard')

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      {/* Faint vignette so the card reads as lit on a dark stage. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,theme(colors.stage-800),transparent_60%)]"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-accent-600/20 ring-1 ring-accent-500/40">
            <span aria-hidden className="text-xl">
              🎬
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold tracking-tight text-ink-50">
              SnowRealm Drama Studio
            </h1>
            <p className="text-xs text-ink-500">雙人 AI 短劇製片管理系統</p>
          </div>
        </div>

        <div className="rounded-xl bg-stage-850 p-6 ring-1 ring-stage-700 panel shadow-2xl shadow-stage-950/60">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-[11px] text-ink-600">
          《一灶見山河》· 第一部《萬家燈火》
        </p>
      </div>
    </main>
  )
}
