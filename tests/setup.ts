/**
 * Test-suite guard rails, applied before any test file loads.
 *
 * `npm test` must never make a billed API call. The AI adapters read their
 * credential from `process.env` at call time, and the test helpers load
 * `.env.local` to find the database — which means the day a real
 * `ANTHROPIC_API_KEY` landed in that file, the queue tests started calling
 * Claude for real and timing out. The cost was small; the principle is not.
 *
 * So the credentials are cleared here. A test that genuinely wants to exercise
 * a live provider must set one back explicitly, which makes that intent
 * visible in the test rather than dependent on whoever ran it.
 */
const PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'REPLICATE_API_TOKEN',
  'ELEVENLABS_API_KEY',
]

/*
 * Set to empty rather than deleted. The test helpers call loadEnv(), which
 * runs dotenv — and dotenv does not overwrite a key that already exists in
 * process.env, but it will happily fill in one that was deleted. An empty
 * string survives that, and every adapter treats it as "no key" because they
 * read it with `||`.
 */
for (const key of PROVIDER_KEYS) {
  process.env[key] = ''
}
