/**
 * Generates every app icon from one vector source.
 *
 *   node scripts/make-icons.mjs
 *
 * The outputs are committed, so this only needs re-running when the mark
 * changes. `sharp` arrives as a transitive dependency of Next's image
 * optimiser rather than a direct one — fine for a one-off generator whose
 * results are checked in, but that is why no build step calls this.
 *
 * The mark is a six-point snowflake (SnowRealm) in the brand's violet→magenta
 * gradient on the stage background, matching `.bg-brand-gradient` in
 * globals.css. There is no photographic art here, so the icon stays legible at
 * 16px where a scene illustration would turn to mud.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const STAGE = '#0a0618'
const STAGE_DEEP = '#06030f'
const VIOLET = '#c4b5fd'
const MAGENTA = '#e879f9'
const ACCENT = '#8b5cf6'

/**
 * Builds the snowflake as stroked paths.
 *
 * `scale` shrinks the mark inside the 512 canvas. A maskable icon may be
 * cropped to a circle by the launcher, so its art has to sit inside the inner
 * 80% — hence a smaller scale for that variant.
 */
function snowflake(scale) {
  const cx = 256
  const cy = 256
  const arm = 190 * scale

  const spokes = []
  const branches = []

  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 2
    const tipX = cx + Math.cos(angle) * arm
    const tipY = cy + Math.sin(angle) * arm
    spokes.push(`M${cx.toFixed(1)} ${cy.toFixed(1)} L${tipX.toFixed(1)} ${tipY.toFixed(1)}`)

    // Two pairs of branches per arm, the outer pair shorter. They are drawn
    // thinner than the spokes: at icon sizes a branch as thick as its own
    // length reads as a blob rather than as a crystal.
    for (const [at, length] of [
      [0.44, 0.34],
      [0.74, 0.22],
    ]) {
      const baseX = cx + Math.cos(angle) * arm * at
      const baseY = cy + Math.sin(angle) * arm * at

      for (const spread of [-0.72, 0.72]) {
        const branchAngle = angle + spread
        const endX = baseX + Math.cos(branchAngle) * arm * length
        const endY = baseY + Math.sin(branchAngle) * arm * length
        branches.push(
          `M${baseX.toFixed(1)} ${baseY.toFixed(1)} L${endX.toFixed(1)} ${endY.toFixed(1)}`
        )
      }
    }
  }

  return { spokes: spokes.join(' '), branches: branches.join(' ') }
}

/**
 * @param {{ maskable?: boolean; rounded?: boolean }} options
 */
function buildSvg({ maskable = false, rounded = true } = {}) {
  const scale = maskable ? 0.62 : 0.86
  const stroke = maskable ? 20 : 22
  // A maskable icon is cropped by the launcher, so it must bleed to the edges.
  const radius = maskable ? 0 : rounded ? 108 : 0
  const { spokes, branches } = snowflake(scale)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="SnowRealm Drama Studio">
  <defs>
    <linearGradient id="arm" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${VIOLET}"/>
      <stop offset="100%" stop-color="${MAGENTA}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${STAGE}"/>
      <stop offset="100%" stop-color="${STAGE_DEEP}"/>
    </linearGradient>
  </defs>

  <rect width="512" height="512" rx="${radius}" fill="url(#plate)"/>
  <circle cx="256" cy="256" r="236" fill="url(#glow)"/>

  <g fill="none" stroke="url(#arm)" stroke-linecap="round">
    <path d="${spokes}" stroke-width="${stroke}"/>
    <path d="${branches}" stroke-width="${(stroke * 0.68).toFixed(1)}"/>
  </g>
  <circle cx="256" cy="256" r="${(26 * scale).toFixed(1)}" fill="${MAGENTA}"/>
</svg>
`
}

async function main() {
  const svg = buildSvg()
  const maskableSvg = buildSvg({ maskable: true })

  await mkdir(join(root, 'public/icons'), { recursive: true })

  // Scalable favicon — what modern browsers prefer.
  await writeFile(join(root, 'src/app/icon.svg'), svg, 'utf8')

  const png = (source, size) =>
    sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

  const outputs = [
    // Raster fallback for anything that will not take the SVG favicon.
    // Deliberately not a .ico: sharp cannot write the ICO container, and an
    // mislabelled PNG is worse than no file at all.
    ['src/app/icon.png', svg, 48],
    ['src/app/apple-icon.png', svg, 180],
    ['public/icons/icon-192.png', svg, 192],
    ['public/icons/icon-512.png', svg, 512],
    ['public/icons/icon-maskable-512.png', maskableSvg, 512],
  ]

  for (const [path, source, size] of outputs) {
    await writeFile(join(root, path), await png(source, size))
    console.log(`  ${path.padEnd(36)} ${size}×${size}`)
  }
}

await main()
