import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 正文裡的標記符號，分門別類；以及破音字出現在哪些詞裡。 */
async function main() {
  const { novelForReading } = await import('../src/lib/novel-export')
  const { db } = await import('../src/db')
  const { projects } = await import('../src/db/schema')

  const rows = await db.select({ id: projects.id, title: projects.title }).from(projects)

  /** 常見破音字。只列出真的在正文裡出現的，以及它前後各一個字。 */
  const AMBIGUOUS = '還了得著重長少好為行種數量盛調差強累相間落空發乾華中便更分要和'

  for (const project of rows) {
    const chapters = await novelForReading(project.id)
    const shapes = new Map<string, number>()
    const contexts = new Map<string, Map<string, number>>()

    for (const chapter of chapters) {
      for (const para of chapter.paragraphs) {
        for (const match of para.matchAll(/[*_~`#>]+[^\S\n]*[*_~`#>]*/g)) {
          const key = match[0].trim()
          shapes.set(key, (shapes.get(key) ?? 0) + 1)
        }
        for (let i = 0; i < para.length; i += 1) {
          const ch = para[i]!
          if (!AMBIGUOUS.includes(ch)) continue
          const word = para.slice(i, i + 2)
          if (word.length < 2 || /[\s*。，！？「」、：；…]/.test(word[1]!)) continue
          const bucket = contexts.get(ch) ?? new Map<string, number>()
          bucket.set(word, (bucket.get(word) ?? 0) + 1)
          contexts.set(ch, bucket)
        }
      }
    }

    console.log(`\n=== ${project.title}（${chapters.length} 章）===`)
    console.log('標記符號：')
    for (const [shape, count] of [...shapes].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${JSON.stringify(shape)} × ${count}`)
    }
    console.log('破音字的詞：')
    for (const [ch, bucket] of [...contexts].sort()) {
      const top = [...bucket]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([w, n]) => `${w}×${n}`)
        .join(' ')
      console.log(`  ${ch}  ${top}`)
    }
  }

  process.exit(0)
}

void main()
