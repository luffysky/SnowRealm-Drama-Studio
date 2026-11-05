import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 情緒是從哪一句話判出來的。判錯比判不出來難聽，所以要看原文。 */
async function main() {
  const { novelForReading } = await import('../src/lib/novel-export')
  const { mainProject } = await import('./helpers/main-project')
  const { emotionOf } = await import('../src/lib/tts/style')
  const { isDialogue } = await import('../src/lib/narration')

  const project = await mainProject()

  const chapters = await novelForReading(project.id)
  const found = new Map<string, { line: string; context: string }[]>()

  for (const chapter of chapters.slice(0, 2)) {
    const paragraphs = chapter.paragraphs
    paragraphs.forEach((para, index) => {
      if (!isDialogue(para)) return
      const before = paragraphs[index - 1] ?? ''
      const context = before && !isDialogue(before) ? before : ''
      const emotion = emotionOf(para, context)
      if (!emotion) return
      const bucket = found.get(emotion) ?? []
      bucket.push({ line: para.slice(0, 26), context: context.slice(-26) })
      found.set(emotion, bucket)
    })
  }

  for (const [emotion, rows] of [...found].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n=== ${emotion}  ${rows.length} 句 ===`)
    for (const row of rows.slice(0, 12)) {
      console.log(`  上一段…${row.context}`)
      console.log(`      ${row.line}`)
    }
  }

  process.exit(0)
}

void main()
