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
      {/*
        Background artwork. The brief (`docs/NEEDED_FROM_YOU.md` C4) asked for a
        dark, defocused centre because the card lands there; the supplied master
        is brightest in the middle instead. So the image is blurred and
        `.scrim-login` darkens the centre hardest, which is also what keeps the
        form's contrast ratio where it needs to be.
      */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/login.webp"
          alt=""
          // `scale-105` hides the soft edge the blur leaves at the viewport rim.
          className="size-full scale-105 object-cover blur-[2px]"
        />
        <div className="scrim-login absolute inset-0" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          {/*
            The full lockup, wordmark and all — unlike the 32px rail mark, there
            is room for it here, and it is the one place the brand is the
            subject rather than a label.
          */}
          {/* The h1 is the lockup: its alt text carries the page's heading. */}
          <h1 className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/lockup.webp"
              alt="SnowRealm Drama Studio"
              width={176}
              height={176}
              fetchPriority="high"
              className="size-36 drop-shadow-[0_0_28px_rgba(139,92,246,0.45)] sm:size-44"
            />
          </h1>
          {/*
            These two lines sit on the artwork with no panel behind them, and
            the master is brightest exactly here. A shadow carries them without
            darkening the whole background for the sake of 20 characters.
          */}
          <p className="text-xs text-ink-200 [text-shadow:0_1px_10px_var(--color-stage-950)]">
            雙人 AI 短劇製片管理系統
          </p>
        </div>

        <div className="panel rounded-xl bg-stage-850/90 p-6 ring-1 shadow-2xl ring-stage-700 shadow-stage-950/60 backdrop-blur-sm">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-[11px] text-ink-300 [text-shadow:0_1px_10px_var(--color-stage-950)]">
          《一灶見山河》· 第一部《萬家燈火》
        </p>
      </div>
    </main>
  )
}
