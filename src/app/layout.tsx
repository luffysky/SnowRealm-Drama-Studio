import type { Metadata, Viewport } from 'next'
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar'
import { ToastProvider } from '@/components/ui/Toast'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'SnowRealm Drama Studio',
    template: '%s｜SnowRealm Drama Studio',
  },
  description: '雙人 AI 短劇製片管理系統',
  applicationName: 'Drama Studio',
  // A private internal tool; keep it out of search indexes.
  robots: { index: false, follow: false },
  // Next emits the manifest link from src/app/manifest.ts.
  appleWebApp: {
    capable: true,
    title: 'Drama Studio',
    // iOS has no dark/light status bar that matches a near-black chrome;
    // `black-translucent` lets the page paint under it instead.
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom stays available: capping it would fail WCAG 1.4.4, and on a
  // phone the dense tables here are exactly what a reader needs to zoom.
  viewportFit: 'cover',
  themeColor: '#0a0618',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-TW">
      <body className="min-h-dvh bg-stage-950 font-sans text-ink-200 antialiased">
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  )
}
