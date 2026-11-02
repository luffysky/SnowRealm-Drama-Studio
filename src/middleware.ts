import { NextResponse, type NextRequest } from 'next/server'

/**
 * Mints the CSRF cookie (spec v2 §6.3).
 *
 * This has to live in middleware rather than the root layout: Next.js only
 * allows setting a cookie from middleware, a Route Handler or a Server Action —
 * calling `cookies().set()` during a Server Component render throws, which
 * surfaces as a 500 on every page.
 *
 * Runs on the Edge runtime, so it uses Web Crypto rather than `node:crypto`.
 * Nothing here reads the session or touches the database; authentication is
 * still enforced per-route on the Node runtime.
 */

const CSRF_COOKIE = 'srds_csrf'
const TOKEN_BYTES = 32

function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(bytes)

  // base64url, without relying on Buffer (absent on Edge).
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  if (!request.cookies.get(CSRF_COOKIE)) {
    /*
     * `secure` follows the actual protocol rather than NODE_ENV. On Vercel both
     * are equivalent (always HTTPS), but running `next start` locally and
     * opening the app over http://<lan-ip> would otherwise have the browser
     * silently drop the cookie, and every write would fail CSRF with no clue why.
     */
    const isHttps =
      request.nextUrl.protocol === 'https:' ||
      request.headers.get('x-forwarded-proto') === 'https'

    response.cookies.set(CSRF_COOKIE, generateToken(), {
      // Deliberately readable by first-party script: echoing it back in a
      // header is the proof that the caller can read this origin's cookies.
      // It carries no authority on its own.
      httpOnly: false,
      secure: isHttps,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
  }

  return response
}

export const config = {
  /*
   * Everything except Next's internals and static files. API routes are
   * included so a client that calls the API before loading a page still
   * receives a token it can use on its next request.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)'],
}
