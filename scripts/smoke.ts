/**
 * End-to-end smoke test against a running server.
 *
 * Exercises the real HTTP surface — login, the Argon2id migration, rate
 * limiting, concurrent updates, the AI queue, and the upload guards — rather
 * than calling library functions directly, so it catches wiring mistakes that
 * unit tests cannot.
 *
 *   npm run build && npm start      # terminal 1
 *   npm run test:smoke              # terminal 2
 */
import { eq, sql } from 'drizzle-orm'
import { closeDb, db } from '../src/db'
import { projects, securityEvents, users } from '../src/db/schema'
import { hashPassword } from '../src/lib/auth/password'
import { loadEnv } from '../src/lib/load-env'
import bcrypt from 'bcryptjs'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3400'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    failures.push(name + (detail ? ` — ${detail}` : ''))
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(name: string) {
  console.log(`\n${name}`)
}

/** Minimal cookie jar: enough to carry the session and CSRF cookies. */
type Jar = Map<string, string>

function newJar(): Jar {
  return new Map()
}

const CSRF_COOKIE = 'srds_csrf'

/**
 * Primes a jar with a CSRF cookie by doing what a browser does: load a page
 * first. Mutating requests then echo the cookie in the header.
 */
async function primeCsrf(jar: Jar): Promise<void> {
  await call('/login', { jar })
}

/** A jar that already holds a CSRF cookie, like a browser that loaded a page. */
async function browserJar(): Promise<Jar> {
  const jar = newJar()
  await primeCsrf(jar)
  return jar
}

async function call(
  path: string,
  init: RequestInit & { json?: unknown; jar?: Jar } = {}
): Promise<{ status: number; body: any; headers: Headers }> {
  const { json, jar, ...rest } = init

  const method = (rest.method ?? 'GET').toUpperCase()
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  const csrf = jar?.get(CSRF_COOKIE)

  const response = await fetch(`${BASE}${path}`, {
    ...rest,
    redirect: 'manual',
    headers: {
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...(jar && jar.size > 0
        ? { cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
        : {}),
      // Browsers send Origin on same-origin POSTs; mirror that.
      ...(mutating ? { origin: BASE } : {}),
      ...(mutating && csrf ? { 'x-csrf-token': csrf } : {}),
      ...rest.headers,
    },
    ...(json ? { body: JSON.stringify(json) } : {}),
  })

  if (jar) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';')
      const index = pair?.indexOf('=') ?? -1
      if (pair && index > 0) {
        const name = pair.slice(0, index)
        const value = pair.slice(index + 1)
        if (value === '' || value === 'deleted') jar.delete(name)
        else jar.set(name, value)
      }
    }
  }

  let body: any = null
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('application/json')) body = await response.json().catch(() => null)
  else body = await response.text().catch(() => '')

  return { status: response.status, body, headers: response.headers }
}

async function hashPrefixOf(email: string): Promise<string> {
  const [row] = await db
    .select({ hash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  return row?.hash.slice(0, 10) ?? ''
}

/** Puts the account back on bcrypt so the migration path can be re-tested. */
async function forceBcrypt(email: string, password: string): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(password, 12) })
    .where(eq(users.email, email))
}

async function main() {
  loadEnv()

  const email = process.env.SEED_OWNER_EMAIL?.toLowerCase()
  const password = process.env.SEED_OWNER_PASSWORD
  if (!email || !password) {
    throw new Error('SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD must be set to run the smoke test')
  }

  const dbUrl = process.env.DATABASE_URL ?? ''
  const isLocalDb = !/neon\.(tech|build)/.test(dbUrl)
  if (!isLocalDb) {
    throw new Error(
      'Refusing to run: the smoke test resets password hashes and clears security events.\n' +
        'Point DATABASE_URL at a local or dev database first.'
    )
  }

  console.log(`\n[smoke] target ${BASE}`)

  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .limit(1)
  if (!project) throw new Error('No project found. Run `npm run db:seed` first.')
  const projectId = project.id
  console.log(`[smoke] project 《${project.title}》\n`)

  // Start from a clean limiter window so the run is repeatable.
  await db.delete(securityEvents)

  // ---------------------------------------------------------------- anonymous
  section('unauthenticated')
  {
    const jar = await browserJar()
    const me = await call('/api/auth/me', { jar })
    check('GET /api/auth/me returns a null user', me.status === 200 && me.body?.user === null)

    const dashboard = await call('/dashboard', { jar })
    check(
      'GET /dashboard redirects to /login',
      dashboard.status === 307 || dashboard.status === 302,
      `status ${dashboard.status}`
    )

    const upload = await call('/api/uploads', {
      method: 'POST',
      jar,
      json: { projectId, kind: 'IMAGE', filename: 'x.png', sizeBytes: 10 },
    })
    check('POST /api/uploads rejects anonymous callers with 401', upload.status === 401)

    const jobs = await call('/api/ai/jobs', { jar })
    check('GET /api/ai/jobs rejects anonymous callers with 401', jobs.status === 401)
  }

  // ------------------------------------------------------------- request ids
  section('error envelope (spec v2 §7)')
  {
    const jar = await browserJar()
    const res = await call('/api/auth/me', { jar })
    check('every response carries an x-request-id header', Boolean(res.headers.get('x-request-id')))

    /*
     * An empty identifier, not a malformed email. Since login accepts a handle
     * as well as an address, `not-an-email` is a perfectly valid identifier —
     * it simply matches no account, which is a 401, not a 422.
     */
    const bad = await call('/api/auth/login', {
      method: 'POST',
      jar,
      json: { identifier: '', password: '' },
    })
    check('validation failure returns 422', bad.status === 422, `status ${bad.status}`)

    const unknownHandle = await call('/api/auth/login', {
      method: 'POST',
      jar,
      json: { identifier: 'not-an-email', password: 'whatever' },
    })
    check(
      'a non-email identifier is a credential failure, not a validation error',
      unknownHandle.status === 401,
      `status ${unknownHandle.status}`
    )
    check(
      'error body contains code, message and requestId',
      typeof bad.body?.error?.code === 'string' &&
        typeof bad.body?.error?.message === 'string' &&
        typeof bad.body?.error?.requestId === 'string',
      JSON.stringify(bad.body?.error)?.slice(0, 120)
    )
    check(
      'requestId in the body matches the header',
      bad.body?.error?.requestId === bad.headers.get('x-request-id')
    )
  }

  // ------------------------------------------------------------------ CSRF
  section('CSRF protection (spec v2 §6.3)')
  {
    const jar = await browserJar()
    check('a page visit sets the CSRF cookie', Boolean(jar.get(CSRF_COOKIE)))

    // Raw fetch so none of the browser-like headers are added automatically.
    const noToken = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
        origin: BASE,
      },
      body: JSON.stringify({ email, password }),
    })
    check('a POST without the token header is refused', noToken.status === 403, `status ${noToken.status}`)

    const wrongToken = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
        origin: BASE,
        'x-csrf-token': 'not-the-right-token',
      },
      body: JSON.stringify({ email, password }),
    })
    check('a POST with a wrong token is refused', wrongToken.status === 403, `status ${wrongToken.status}`)

    const foreignOrigin = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
        origin: 'https://evil.example.com',
        'x-csrf-token': jar.get(CSRF_COOKIE) ?? '',
      },
      body: JSON.stringify({ email, password }),
    })
    check(
      'a POST from a foreign origin is refused even with a valid token',
      foreignOrigin.status === 403,
      `status ${foreignOrigin.status}`
    )

    const readOnly = await fetch(`${BASE}/api/auth/me`, {
      headers: { cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') },
    })
    check('GET is unaffected by CSRF checks', readOnly.status === 200, `status ${readOnly.status}`)

    // A correctly-formed request still works — the check must not block the app.
    const proper = await call('/api/auth/login', {
      method: 'POST',
      jar,
      json: { email, password: 'wrong-on-purpose' },
    })
    check(
      'a properly-tokened POST reaches the handler',
      proper.status === 401,
      `status ${proper.status} (401 means it got past CSRF to the password check)`
    )

    await db.delete(securityEvents)
  }

  // ------------------------------------------------- Argon2id migration path
  section('Argon2id transparent migration')
  {
    await forceBcrypt(email, password)
    const before = await hashPrefixOf(email)
    check('account starts on a bcrypt hash', before.startsWith('$2'), before)

    const jar = await browserJar()
    const ok = await call('/api/auth/login', { method: 'POST', jar, json: { email, password } })
    check('login with the bcrypt hash succeeds', ok.status === 200, `status ${ok.status}`)
    check('response reports the password was upgraded', ok.body?.passwordUpgraded === true)

    const after = await hashPrefixOf(email)
    check('stored hash is now Argon2id', after === '$argon2id$', after)

    const [row] = await db
      .select({ hash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    check(
      'the new hash carries the agreed parameters',
      (row?.hash ?? '').includes('$m=19456,t=2,p=1$'),
      (row?.hash ?? '').slice(0, 40)
    )
    check(
      'the stored value is a hash, never the plaintext',
      !(row?.hash ?? '').includes(password)
    )

    // Logging in again must not re-migrate.
    const jar2 = await browserJar()
    const again = await call('/api/auth/login', {
      method: 'POST',
      jar: jar2,
      json: { email, password },
    })
    check('second login still succeeds on Argon2id', again.status === 200)
    check('second login does not re-migrate', again.body?.passwordUpgraded === false)

    const events = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(securityEvents)
      .where(eq(securityEvents.kind, 'PASSWORD_REHASHED'))
    check('exactly one rehash was audited', Number(events[0]?.n ?? 0) === 1, String(events[0]?.n))
  }

  // ------------------------------------------------------ concurrent updates
  section('concurrent login during migration')
  {
    await forceBcrypt(email, password)
    await db.delete(securityEvents)

    // Six simultaneous logins against a bcrypt hash. The conditional update
    // means exactly one may win the rehash; none may fail or corrupt the hash.
    // Jars are primed up front so the logins themselves start together.
    const jars = await Promise.all(Array.from({ length: 6 }, () => browserJar()))
    const results = await Promise.all(
      jars.map((j) => call('/api/auth/login', { method: 'POST', jar: j, json: { email, password } }))
    )

    const succeeded = results.filter((r) => r.status === 200).length
    const upgraded = results.filter((r) => r.body?.passwordUpgraded === true).length

    check('all six concurrent logins succeed', succeeded === 6, `${succeeded}/6`)
    check(
      'exactly one of them performs the rehash',
      upgraded === 1,
      `${upgraded} reported an upgrade`
    )

    const after = await hashPrefixOf(email)
    check('hash is valid Argon2id after the race', after === '$argon2id$', after)

    const stillWorks = await call('/api/auth/login', {
      method: 'POST',
      jar: await browserJar(),
      json: { email, password },
    })
    check('the password still works after the race', stillWorks.status === 200)
  }

  // ------------------------------------------------------------ rate limiting
  section('login rate limiting (spec v2 §6.3)')
  {
    await db.delete(securityEvents)
    const probe = 'ratelimit-probe@snowrealm.local'

    let limitedAt = -1
    for (let attempt = 1; attempt <= 12; attempt++) {
      const res = await call('/api/auth/login', {
        method: 'POST',
        jar: await browserJar(),
        json: { email: probe, password: 'definitely-wrong-password' },
      })
      if (res.status === 429) {
        limitedAt = attempt
        check(
          '429 includes a Retry-After header',
          Boolean(res.headers.get('retry-after')),
          res.headers.get('retry-after') ?? 'missing'
        )
        break
      }
    }

    check(
      'repeated failures are eventually rate limited',
      limitedAt > 0,
      limitedAt < 0 ? 'never limited in 12 attempts' : `limited on attempt ${limitedAt}`
    )
    check('the limit is not so tight it blocks normal typos', limitedAt === -1 || limitedAt > 3)

    const audited = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(securityEvents)
      .where(eq(securityEvents.kind, 'LOGIN_FAILED'))
    check('failed attempts are audited', Number(audited[0]?.n ?? 0) > 0)

    const [anyEvent] = await db.select().from(securityEvents).limit(1)
    check(
      'no audit row contains a password or hash',
      !JSON.stringify(anyEvent ?? {}).includes('definitely-wrong-password') &&
        !JSON.stringify(anyEvent ?? {}).includes('$argon2') &&
        !JSON.stringify(anyEvent ?? {}).includes('$2b$')
    )

    // Clear so the real account is usable for the rest of the run.
    await db.delete(securityEvents)
  }

  // ----------------------------------------------------------- authenticated
  section('authenticated')
  const jar = await browserJar()
  {
    const ok = await call('/api/auth/login', { method: 'POST', jar, json: { email, password } })
    check('login for the remaining checks', ok.status === 200, `status ${ok.status}`)

    const me = await call('/api/auth/me', { jar })
    check('GET /api/auth/me returns the signed-in user', Boolean(me.body?.user?.id))
    check(
      'OWNER receives the full permission set',
      Array.isArray(me.body?.permissions) && me.body.permissions.includes('project.delete')
    )

    const dashboard = await call('/dashboard', { jar })
    check('GET /dashboard renders', dashboard.status === 200)
    check(
      'dashboard shows the real project title',
      typeof dashboard.body === 'string' && dashboard.body.includes('一灶見山河')
    )

    const sessions = await call('/api/auth/sessions', { jar })
    check(
      'exactly one session is marked current',
      Array.isArray(sessions.body?.sessions) &&
        sessions.body.sessions.filter((s: any) => s.isCurrent).length === 1
    )
  }

  // --------------------------------------------------------- password change
  section('password change')
  {
    const nextPassword = `${password}-rotated`

    const changed = await call('/api/auth/password', {
      method: 'POST',
      jar,
      json: {
        currentPassword: password,
        newPassword: nextPassword,
        confirmPassword: nextPassword,
      },
    })
    check('password change succeeds', changed.status === 200, `status ${changed.status}`)

    const hash = await hashPrefixOf(email)
    check('the new password is stored as Argon2id', hash === '$argon2id$', hash)

    const withNew = await call('/api/auth/login', {
      method: 'POST',
      jar: await browserJar(),
      json: { email, password: nextPassword },
    })
    check('the new password works', withNew.status === 200)

    const withOld = await call('/api/auth/login', {
      method: 'POST',
      jar: await browserJar(),
      json: { email, password },
    })
    check('the old password no longer works', withOld.status === 401)

    const audited = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(securityEvents)
      .where(eq(securityEvents.kind, 'PASSWORD_CHANGED'))
    check('the change is audited', Number(audited[0]?.n ?? 0) >= 1)

    // Restore the seeded password so re-running the suite is idempotent.
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.email, email))
    await db.delete(securityEvents)
  }

  // ------------------------------------------------------------- AI queue
  section('AI queue is asynchronous (spec v2 §6.6)')
  const jar2 = await browserJar()
  {
    await call('/api/auth/login', { method: 'POST', jar: jar2, json: { email, password } })

    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY)
    const idempotencyKey = `smoke-${Date.now()}`

    const enqueue = await call('/api/ai/jobs', {
      method: 'POST',
      jar: jar2,
      headers: { 'idempotency-key': idempotencyKey },
      json: { task: 'NOVEL_CONTINUE', projectId, userInstruction: 'smoke test', candidates: 1 },
    })

    if (!hasKey) {
      check(
        'without an AI key, enqueueing fails closed with 503',
        enqueue.status === 503,
        `status ${enqueue.status}`
      )
      check(
        'the error explains that no provider is configured',
        typeof enqueue.body?.error?.message === 'string' &&
          enqueue.body.error.message.includes('AI'),
        enqueue.body?.error?.message
      )
    } else {
      check('enqueueing returns 202 Accepted, not 200', enqueue.status === 202, `status ${enqueue.status}`)
      check(
        'the job is QUEUED — the request did not run the model inline',
        enqueue.body?.job?.status === 'QUEUED',
        enqueue.body?.job?.status
      )

      const again = await call('/api/ai/jobs', {
        method: 'POST',
        jar: jar2,
        headers: { 'idempotency-key': idempotencyKey },
        json: { task: 'NOVEL_CONTINUE', projectId, userInstruction: 'smoke test', candidates: 1 },
      })
      check('resubmitting the same idempotency key is deduplicated', again.body?.deduplicated === true)
      check(
        'deduplication returns the same job rather than a second one',
        again.body?.job?.id === enqueue.body?.job?.id
      )

      const detail = await call(`/api/ai/jobs/${enqueue.body.job.id}`, { jar: jar2 })
      check('the job detail endpoint serves progress for polling', detail.status === 200)
      check('progress comes from the server', typeof detail.body?.job?.progress === 'number')

      const cancelled = await call(`/api/ai/jobs/${enqueue.body.job.id}/cancel`, {
        method: 'POST',
        jar: jar2,
      })
      check('a queued job can be cancelled', cancelled.status === 200)
    }
  }

  // --------------------------------------------------------------- worker auth
  section('worker endpoint')
  {
    const noAuth = await call('/api/ai/worker')
    check(
      'the worker rejects an unauthenticated call',
      noAuth.status === 401 || noAuth.status === 503,
      `status ${noAuth.status}`
    )

    const secret = process.env.CRON_SECRET
    if (secret) {
      const wrong = await call('/api/ai/worker', {
        headers: { authorization: 'Bearer definitely-not-the-secret' },
      })
      check('the worker rejects a wrong secret', wrong.status === 401, `status ${wrong.status}`)

      const right = await call('/api/ai/worker', {
        headers: { authorization: `Bearer ${secret}` },
      })
      check('the worker accepts the configured secret', right.status === 200, `status ${right.status}`)
      check('the worker reports what it claimed', typeof right.body?.claimed === 'number')
    } else {
      check('without CRON_SECRET the worker fails closed', noAuth.status === 503)
    }
  }

  // ------------------------------------------------------- object storage guard
  section('object storage guard')
  {
    const upload = await call('/api/uploads', {
      method: 'POST',
      jar: jar2,
      json: {
        projectId,
        kind: 'IMAGE',
        filename: 'still.png',
        contentType: 'image/png',
        sizeBytes: 2048,
      },
    })

    if (process.env.R2_BUCKET) {
      check('upload request succeeds with R2 configured', upload.status === 200)
    } else {
      check('missing R2 credentials produce 503, not a crash', upload.status === 503, `status ${upload.status}`)
      check(
        'the error names exactly which R2 variables are missing',
        typeof upload.body?.error?.message === 'string' &&
          upload.body.error.message.includes('R2_BUCKET'),
        upload.body?.error?.message
      )
    }
  }

  // ------------------------------------------------------------------- logout
  section('logout')
  {
    const out = await call('/api/auth/logout', { method: 'POST', jar: jar2 })
    check('POST /api/auth/logout succeeds', out.status === 200)

    const me = await call('/api/auth/me', { jar: jar2 })
    check('session is no longer valid after logout', me.body?.user === null)
  }

  console.log(`\n[smoke] ${passed} passed, ${failed} failed\n`)
  if (failed > 0) {
    console.log('failures:')
    for (const f of failures) console.log(`  - ${f}`)
    console.log()
    process.exit(1)
  }
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error('\n[smoke] error:', err instanceof Error ? err.message : err, '\n')
    await closeDb().catch(() => {})
    process.exit(1)
  })
