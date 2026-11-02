import dotenv from 'dotenv'

/**
 * Next.js loads .env.local on its own; plain node/tsx scripts and drizzle-kit
 * do not. Call this at the top of any script that runs outside Next.
 */
export function loadEnv() {
  dotenv.config({ path: ['.env.local', '.env'], quiet: true })
}
