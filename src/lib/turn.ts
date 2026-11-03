import { env } from '@/lib/env'
import { DEFAULT_ICE_SERVERS, getIceServers, type IceServer } from '@/lib/settings'

/**
 * ICE servers for a call, including a TURN relay when one is configured.
 *
 * Three sources, in order:
 *
 *  1. **Cloudflare TURN**, when `CLOUDFLARE_TURN_KEY_ID` and an API token are
 *     set. Credentials are minted per call and expire; the long-term key stays
 *     on the server, because it is what authorises relay traffic against the
 *     account's bill.
 *  2. **`app_settings`**, for any other TURN provider — coturn, Twilio —
 *     entered by hand.
 *  3. **Google STUN**, the default. Enough for two ordinary home networks and
 *     nothing else.
 *
 * STUN alone fails when both sides sit behind a NAT that will not hold a port
 * open for an unknown peer. The diagnosis in the call panel distinguishes that
 * case from a broken handshake, which is the difference between "configure a
 * relay" and "there is a bug".
 */

type Minted = { servers: IceServer[]; expiresAt: number }

/*
 * One cached credential per server instance.
 *
 * Minting costs an API round trip, and the credentials are valid for hours —
 * fetching a new one per call would add a second of latency to every dial for
 * no benefit. Re-minted when inside the refresh margin, so a call never starts
 * with a credential that expires mid-conversation.
 */
let cached: Minted | null = null

/** How long a minted credential lasts. Longer than any call anyone will make. */
const TTL_SECONDS = 6 * 60 * 60
/** Re-mint this far ahead of expiry. */
const REFRESH_MARGIN_MS = 30 * 60 * 1000

export async function iceServersForCall(): Promise<IceServer[]> {
  const cloudflare = await cloudflareTurn()
  if (cloudflare) return cloudflare

  return getIceServers()
}

async function cloudflareTurn(): Promise<IceServer[] | null> {
  const config = env()
  const keyId = config.CLOUDFLARE_TURN_KEY_ID
  const token = config.CLOUDFLARE_TURN_API_TOKEN
  if (!keyId || !token) return null

  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return cached.servers
  }

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
        // Never cached: these are credentials, and a cached one would be
        // handed out after it had expired.
        cache: 'no-store',
      }
    )

    if (!response.ok) {
      console.error('[turn] mint failed', response.status, await response.text())
      return null
    }

    const body = (await response.json()) as { iceServers?: unknown }
    const servers = normalise(body.iceServers)
    if (servers.length === 0) return null

    cached = { servers, expiresAt: Date.now() + TTL_SECONDS * 1000 }
    return servers
  } catch (error) {
    /*
     * A relay that cannot be reached must not stop the call being attempted:
     * most calls connect without one. Falls through to STUN, and the panel's
     * diagnosis says so if that turns out not to be enough.
     */
    console.error('[turn] mint error', error)
    return null
  }
}

/**
 * Narrows Cloudflare's response and drops the port-53 URL.
 *
 * Their own documentation warns it frequently times out in browsers, and a
 * candidate that hangs delays the whole gathering phase.
 */
function normalise(value: unknown): IceServer[] {
  if (!Array.isArray(value)) return []

  const out: IceServer[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>

    const urls = (Array.isArray(row.urls) ? row.urls : [row.urls])
      .filter((url): url is string => typeof url === 'string' && url.length > 0)
      .filter((url) => !url.includes(':53?') && !url.endsWith(':53'))

    if (urls.length === 0) continue

    out.push({
      urls,
      ...(typeof row.username === 'string' ? { username: row.username } : {}),
      ...(typeof row.credential === 'string' ? { credential: row.credential } : {}),
    })
  }

  return out
}

/** Whether a relay is configured at all, for the settings screen to report. */
export function turnConfigured(): boolean {
  const config = env()
  return Boolean(config.CLOUDFLARE_TURN_KEY_ID && config.CLOUDFLARE_TURN_API_TOKEN)
}

export { DEFAULT_ICE_SERVERS }
