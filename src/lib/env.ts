import { z } from 'zod'

/**
 * Server-only environment. Importing this from a Client Component is a build
 * error by design — nothing in here may reach the browser, so no variable is
 * ever named with a NEXT_PUBLIC_ prefix.
 *
 * Values are validated lazily (on first read) rather than at module load, so a
 * missing optional credential surfaces as a clear message from the feature that
 * needs it instead of crashing the whole app at boot.
 */

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — see docs/ENVIRONMENT.md'),
  DATABASE_URL_UNPOOLED: z.string().optional(),
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters — see docs/ENVIRONMENT.md'),
  /** Separate key for encrypting stored AI provider keys at rest. */
  ENCRYPTION_KEY: z.string().optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  PRESIGN_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

  /*
   * Cloudflare TURN, for calls that cannot be made peer-to-peer.
   *
   * The key is a long-term secret and never leaves the server: it is used to
   * mint short-lived credentials per call, which is what the browser gets.
   * Handing the key itself to the client would let anyone relay traffic on
   * this account's bill.
   */
  CLOUDFLARE_TURN_KEY_ID: z.string().optional(),
  CLOUDFLARE_TURN_API_TOKEN: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),

  /** Bearer token Vercel Cron presents to /api/ai/worker. Worker is disabled without it. */
  CRON_SECRET: z.string().optional(),

  /**
   * Output ceiling per AI generation. Defaults to 8000, sized for the Vercel
   * Hobby plan's 60s function limit. Raise it on a plan allowing longer runs.
   */
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(128_000).optional(),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type ServerEnv = z.infer<typeof schema>

let cached: ServerEnv | null = null

export function env(): ServerEnv {
  if (cached) return cached

  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid server environment:\n${issues}`)
  }

  cached = parsed.data
  return cached
}

/** Clears the memoised env. Tests use this after mutating process.env. */
export function resetEnvCache() {
  cached = null
}

/** True when every R2 credential needed for presigning is present. */
export function hasR2Config(): boolean {
  const e = process.env
  return Boolean(
    e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY && e.R2_BUCKET
  )
}

/** Names of the R2 variables that are still missing, for a precise error message. */
export function missingR2Keys(): string[] {
  const required = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
  ] as const
  return required.filter((k) => !process.env[k])
}

/** Neon serves over HTTP; a local embedded-postgres instance does not. */
export function isNeonUrl(url: string): boolean {
  return url.includes('neon.tech') || url.includes('neon.build')
}
