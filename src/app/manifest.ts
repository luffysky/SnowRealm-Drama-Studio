import type { MetadataRoute } from 'next'

/**
 * PWA manifest, served at /manifest.webmanifest.
 *
 * The studio is a private two-person tool, so this exists to make it
 * installable on a tablet or phone — a production desk you can pin to the home
 * screen and open full-screen — not for discovery. `robots` in the root layout
 * still keeps it out of search indexes.
 *
 * `start_url` points at the dashboard rather than `/`: an installed app should
 * open on the workbench, and an unauthenticated launch redirects to /login by
 * itself.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'SnowRealm Drama Studio',
    short_name: 'Drama Studio',
    description: '雙人 AI 短劇製片管理系統',
    lang: 'zh-Hant-TW',
    dir: 'ltr',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    // Desktop-first by spec, but the rail collapses below `lg`, so both
    // orientations are usable on a tablet and on a phone.
    orientation: 'any',
    background_color: '#0a0618',
    theme_color: '#0a0618',
    categories: ['productivity', 'business'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        // Bleeds to the edges so a launcher may crop it to any shape.
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
