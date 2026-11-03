/**
 * Uploads a local image and makes it a project's cover.
 *
 *   npx tsx scripts/set-project-cover.ts --project yi-zao-jian-shan-he \
 *     --file "picture/banner/yizao_jian_shanhe_banner_v1.png.png" \
 *     --name "一灶見山河 主視覺 v1"
 *
 * Goes through the real upload pipeline (`beginUpload` → presigned PUT →
 * `finishUpload`) rather than writing an asset row by hand, so the result is
 * indistinguishable from a cover uploaded through the UI: the bytes are
 * verified to have landed, the size and MIME come back from R2 rather than
 * from this script, and the object key is a UUID with no filename in it.
 */
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { loadEnv } from '../src/lib/load-env'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]?.trim()
}

/** Minimal sniffing — enough to reject a file that is not actually an image. */
function imageMime(bytes: Buffer, filename: string): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  // An .svg has no magic number; accept it only on the extension.
  if (extname(filename).toLowerCase() === '.svg') return 'image/svg+xml'
  return null
}

async function main(): Promise<void> {
  loadEnv()

  const projectRef = arg('project')
  const file = arg('file')
  if (!projectRef || !file) {
    console.error(
      '用法：npx tsx scripts/set-project-cover.ts --project <slug 或 id> --file <圖檔> [--name <顯示名稱>]'
    )
    process.exit(1)
  }

  const { eq, or } = await import('drizzle-orm')
  const { db, closeDb } = await import('../src/db')
  const { projects, users } = await import('../src/db/schema')
  const { beginUpload, finishUpload } = await import('../src/lib/assets')
  const { isProjectId } = await import('../src/lib/project-access')

  const [project] = await db
    .select({ id: projects.id, title: projects.title, coverAssetId: projects.coverAssetId })
    .from(projects)
    .where(
      isProjectId(projectRef)
        ? or(eq(projects.id, projectRef), eq(projects.slug, projectRef))!
        : eq(projects.slug, projectRef)
    )
    .limit(1)

  if (!project) {
    console.error(`找不到作品：${projectRef}`)
    await closeDb()
    process.exit(1)
  }

  // The upload is attributed to the owner, as if they had done it in the UI.
  const [owner] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      title: users.title,
      role: users.role,
      color: users.color,
      displayCurrency: users.displayCurrency,
    })
    .from(users)
    .where(eq(users.email, (process.env.SEED_OWNER_EMAIL ?? '').toLowerCase()))
    .limit(1)

  if (!owner) {
    console.error('找不到 SEED_OWNER_EMAIL 對應的帳號')
    await closeDb()
    process.exit(1)
  }

  const bytes = await readFile(file)
  const contentType = imageMime(bytes, file)
  if (!contentType) {
    console.error(`${file} 看起來不是圖片檔`)
    await closeDb()
    process.exit(1)
  }

  const filename = basename(file)
  const displayName = arg('name') || filename

  console.log(`\n作品：《${project.title}》`)
  console.log(`檔案：${filename}  ${(bytes.byteLength / 1048576).toFixed(2)} MB  ${contentType}`)
  if (project.coverAssetId) console.log(`注意：已有封面，將被取代（舊素材保留，不刪除）`)

  const begin = await beginUpload({
    user: {
      id: owner.id,
      email: owner.email,
      name: owner.name,
      title: owner.title,
      role: owner.role,
      color: owner.color,
      displayCurrency: owner.displayCurrency as 'TWD' | 'USD' | 'CNY',
    },
    projectId: project.id,
    kind: 'IMAGE',
    filename: displayName,
    contentType,
    sizeBytes: bytes.byteLength,
  })

  if (begin.multipart || !begin.url) {
    console.error('封面不應大到需要分段上傳，請先壓縮')
    await closeDb()
    process.exit(1)
  }

  const put = await fetch(begin.url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: new Uint8Array(bytes),
  })
  if (!put.ok) {
    console.error(`上傳失敗 HTTP ${put.status}`)
    await closeDb()
    process.exit(1)
  }

  const asset = await finishUpload({
    user: {
      id: owner.id,
      email: owner.email,
      name: owner.name,
      title: owner.title,
      role: owner.role,
      color: owner.color,
      displayCurrency: owner.displayCurrency as 'TWD' | 'USD' | 'CNY',
    },
    uploadSessionId: begin.uploadSessionId,
  })

  await db
    .update(projects)
    .set({ coverAssetId: asset.id, updatedAt: new Date() })
    .where(eq(projects.id, project.id))

  console.log(`\n已設為封面`)
  console.log(`  asset   ${asset.id}`)
  console.log(`  key     ${asset.objectKey}`)
  console.log(`  size    ${asset.sizeBytes} bytes（由 R2 回報，非本腳本自述）`)
  console.log(`  瀏覽    /api/files/${asset.id}\n`)

  await closeDb()
}

void main()
