/**
 * End-to-end check of the Cloudflare R2 bucket.
 *
 *   npm run r2:check
 *
 * Exercises exactly what the app does, in order: presigned PUT, HEAD, presigned
 * GET, multipart create/upload/complete, abort, and delete. Then it replays the
 * CORS preflight a browser sends before a direct upload, for every origin the
 * app is served from, because a bucket that works from Node and fails from the
 * browser is the normal way this goes wrong.
 *
 * Every object it writes lives under `__healthcheck__/` and is deleted again.
 * Nothing here touches a real asset.
 */
import { loadEnv } from '../src/lib/load-env'

/** Origins the browser will upload from. Must match the bucket's CORS policy. */
const ORIGINS = [
  'http://localhost:3400',
  'http://127.0.0.1:3400',
  'https://dramastudio-neon.vercel.app',
  'https://dreama.snowrealm.pet',
]

const PASS = '  ✓'
const FAIL = '  ✗'

let failures = 0

function report(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? PASS : FAIL} ${label}${detail ? `  ${detail}` : ''}`)
}

async function main(): Promise<void> {
  loadEnv()

  const r2 = await import('../src/lib/r2')
  const { env } = await import('../src/lib/env')

  const bucket = env().R2_BUCKET
  console.log(`\n[r2] bucket=${bucket}\n`)

  const stamp = Date.now()
  const key = `__healthcheck__/${stamp}-single.txt`
  const body = Buffer.from(`snowrealm r2 healthcheck ${new Date().toISOString()}\n`, 'utf8')

  // --- 1. presigned PUT --------------------------------------------------
  const put = await r2.presignPut({
    objectKey: key,
    contentType: 'text/plain',
    contentLength: body.byteLength,
  })

  /*
   * The URL must address the bucket exactly once. The SDK defaults to
   * virtual-hosted style (`drama.<account>.r2.cloudflarestorage.com/<key>`),
   * so the bucket may legitimately appear in the host instead of the path —
   * what must never happen is both, which is what an R2_ENDPOINT with the
   * bucket appended produces. That still uploads, just to `drama/drama/…`.
   */
  const putUrl = new URL(put.url)
  const inHost = putUrl.hostname.startsWith(`${bucket}.`)
  const pathSegments = putUrl.pathname.split('/').filter(Boolean)
  const inPath = pathSegments[0] === bucket
  report(
    (inHost || inPath) && !(inHost && inPath) && pathSegments[1] !== bucket,
    'presigned URL 對 bucket 定址一次（不是兩次）',
    `${inHost ? 'host' : 'path'}: ${putUrl.host}${putUrl.pathname}`
  )

  // Sent with an Origin, exactly as the browser does — that is what makes R2
  // attach the CORS response headers we need to inspect.
  const browserOrigin = ORIGINS[0]!
  const putResponse = await fetch(put.url, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain', origin: browserOrigin },
    body,
  })
  report(putResponse.ok, '單檔上傳 (PUT)', `HTTP ${putResponse.status}`)

  /*
   * `Access-Control-Expose-Headers` belongs on the real response, not on the
   * preflight — checking the preflight for it reports a false failure. Without
   * it the browser cannot read the ETag, and multipart completion fails at the
   * last step.
   */
  const exposeOnPut = (
    putResponse.headers.get('access-control-expose-headers') ?? ''
  ).toLowerCase()
  report(
    exposeOnPut.includes('etag'),
    'CORS ExposeHeaders 含 etag（multipart 合併需要）',
    exposeOnPut || '(未回傳)'
  )

  // --- 2. HEAD -----------------------------------------------------------
  const head = await r2.headObject(key)
  report(head !== null, '伺服器端 HEAD 讀得到物件')
  report(
    head?.sizeBytes === body.byteLength,
    '回報的大小與實際相符',
    `${head?.sizeBytes ?? '?'} / ${body.byteLength} bytes`
  )

  // --- 3. presigned GET --------------------------------------------------
  const get = await r2.presignGet({ objectKey: key })
  const getResponse = await fetch(get.url)
  const text = await getResponse.text()
  report(getResponse.ok && text === body.toString('utf8'), '下載內容與上傳一致')

  // A download must carry the original filename, not the UUID key.
  const named = await r2.presignGet({ objectKey: key, downloadName: '測試檔案.txt' })
  const namedResponse = await fetch(named.url)
  const disposition = namedResponse.headers.get('content-disposition') ?? ''
  report(disposition.includes('attachment'), 'download=1 會帶 Content-Disposition', disposition)

  // --- 4. the bucket must not be publicly readable -----------------------
  const unsigned = new URL(get.url)
  unsigned.search = ''
  const anonymous = await fetch(unsigned.toString())
  const anonymousBody = await anonymous.text()
  // R2 answers an unsigned request with 400 (InvalidArgument) rather than 403.
  // What matters is that it refuses and never returns the object.
  report(
    !anonymous.ok && !anonymousBody.includes('healthcheck'),
    'bucket 未公開：拿掉簽章就讀不到',
    `HTTP ${anonymous.status}`
  )

  // --- 5. multipart ------------------------------------------------------
  const multipartKey = `__healthcheck__/${stamp}-multipart.bin`
  const { uploadId } = await r2.startMultipart({
    objectKey: multipartKey,
    contentType: 'application/octet-stream',
  })
  report(Boolean(uploadId), 'multipart 建立成功')

  const [partUrl] = await r2.presignParts({
    objectKey: multipartKey,
    uploadId,
    partNumbers: [1],
  })

  const partBody = Buffer.alloc(1024, 7)
  const partResponse = await fetch(partUrl!.url, { method: 'PUT', body: partBody })
  const etag = (partResponse.headers.get('etag') ?? '').replaceAll('"', '')
  report(partResponse.ok && etag.length > 0, 'multipart 分段上傳並取回 ETag', etag)

  await r2.completeMultipart({
    objectKey: multipartKey,
    uploadId,
    parts: [{ partNumber: 1, etag }],
  })
  const multipartHead = await r2.headObject(multipartKey)
  report(multipartHead?.sizeBytes === partBody.byteLength, 'multipart 合併完成')

  // --- 6. abort ----------------------------------------------------------
  const abortKey = `__healthcheck__/${stamp}-abort.bin`
  const aborted = await r2.startMultipart({
    objectKey: abortKey,
    contentType: 'application/octet-stream',
  })
  await r2.abortMultipart({ objectKey: abortKey, uploadId: aborted.uploadId })
  report((await r2.headObject(abortKey)) === null, '取消 multipart 後不留下物件')

  // --- 7. CORS preflight, per origin -------------------------------------
  console.log('\n  CORS preflight（瀏覽器直傳前會先發這個）')
  for (const origin of ORIGINS) {
    const preflight = await fetch(put.url, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
      },
    })

    const allowOrigin = preflight.headers.get('access-control-allow-origin')
    const allowMethods = (
      preflight.headers.get('access-control-allow-methods') ?? ''
    ).toUpperCase()

    report(
      preflight.ok && allowOrigin === origin && allowMethods.includes('PUT'),
      `  ${origin}`,
      `HTTP ${preflight.status}${allowMethods ? ` allow=${allowMethods}` : ''}`
    )
  }

  // --- cleanup -----------------------------------------------------------
  await r2.deleteObject(key)
  await r2.deleteObject(multipartKey)
  report((await r2.headObject(key)) === null, '刪除後物件消失')

  console.log(
    failures === 0 ? '\n[r2] 全部通過\n' : `\n[r2] ${failures} 項失敗\n`
  )
  if (failures > 0) process.exit(1)
}

void main()
