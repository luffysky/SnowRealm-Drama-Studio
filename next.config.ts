import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /*
   * 127.0.0.1 在開發時算同一台機器，不算跨來源 (Z173).
   *
   * Next 16 預設只信任它自己印出來的那個主機名（localhost），所以瀏覽器用
   * `127.0.0.1` 連進來的時候，`/_next/hmr` 跟用戶端 chunk 會被擋掉：
   *
   *     Blocked cross-origin request to Next.js dev resource /_next/hmr
   *     from "127.0.0.1".
   *
   * 擋掉的後果不是報錯，是**整頁沒有 hydrate**——伺服器算好的 HTML 照樣顯
   * 示，所以看起來一切正常，而所有用戶端的東西都沒有發生：effect 不跑、點擊
   * 沒反應、動態 import 不載、繁簡轉換不轉。
   *
   * 而 `scripts/` 底下**21 支**會開瀏覽器的腳本預設全部連 `127.0.0.1`（port
   * 有 3400／3401／3402／3404 四種；這個設定只比對主機名，跟 port 無關）。也
   * 就是說它們拍的、量的，都是一個沒有 hydrate 的頁面——而那正好是這個專案用
   * 來證明「畫面真的對」的工具。改這 21 個檔案不如改這一行。
   *
   * 只影響開發模式，production 沒有這個檢查。
   */
  allowedDevOrigins: ['127.0.0.1'],

  images: {
    // Remote storage (Vercel Blob) serves uploaded stills / reference images.
    remotePatterns: [{ protocol: 'https', hostname: '**.public.blob.vercel-storage.com' }],
  },
}

export default nextConfig
