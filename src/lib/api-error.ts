/**
 * The API error shape, on its own.
 *
 * 從 `api.ts` 抽出來 (Z66)，因為那一支 import 了 `@/db` 與 session——也就是
 * `next/headers`——所以任何想丟一個有狀態碼的錯誤的**純函式**，都會因此被釘
 * 在伺服器端。批次建立集數那支就是：它的 `planEpisodeBatch` 要在瀏覽器裡跑
 * 預覽，而它想丟 400。
 *
 * 一個錯誤類別不需要知道 request context。`api.ts` 照樣 re-export 它，所以
 * 既有的 `import { ApiError } from '@/lib/api'` 一行都不用改。
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = 'error',
    readonly details?: unknown,
    /** Extra response headers, e.g. Retry-After on a 429. */
    readonly headers?: Record<string, string>
  ) {
    super(message)
    this.name = 'ApiError'
  }

  static unauthorized(message = '請先登入') {
    return new ApiError(401, message, 'unauthorized')
  }

  static forbidden(message = '權限不足') {
    return new ApiError(403, message, 'forbidden')
  }

  static notFound(message = '找不到資料') {
    return new ApiError(404, message, 'not_found')
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, 'bad_request', details)
  }

  /** Someone else saved first, or the record is still referenced. */
  static conflict(message = '資料已被另一位成員修改，請重新載入', details?: unknown) {
    return new ApiError(409, message, 'conflict', details)
  }

  static rateLimited(message: string, retryAfterSec: number) {
    return new ApiError(429, message, 'rate_limited', { retryAfterSec }, {
      'Retry-After': String(retryAfterSec),
    })
  }

  /** A required credential is not configured on the server. */
  static notConfigured(message: string, details?: unknown) {
    return new ApiError(503, message, 'not_configured', details)
  }
}
