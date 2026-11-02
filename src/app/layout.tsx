import type { Metadata, Viewport } from 'next'
import { ToastProvider } from '@/components/ui/Toast'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'SnowRealm Drama Studio',
    template: '%s｜SnowRealm Drama Studio',
  },
  description: '雙人 AI 短劇製片管理系統',
  // A private internal tool; keep it out of search indexes.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#06070e',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-TW">
      <body className="min-h-dvh bg-stage-950 font-sans text-ink-200 antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
