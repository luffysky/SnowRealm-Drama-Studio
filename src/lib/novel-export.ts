import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { chapters, documents, episodes, projects } from '@/db/schema'
import { createZip } from '@/lib/zip'
import { NOVEL_EXPORT_FORMATS, type NovelExportFormat } from '@/lib/novel-export-view'

/**
 * Exporting the novel (小說匯出).
 *
 * Four formats, chosen for what people actually read Chinese novels with:
 *
 *  - **TXT** is the lingua franca. Every Chinese reader app — 靜讀天下, 閱讀,
 *    Moon+ — opens one, and it is what 起點 / 晉江 downloads are. UTF-8 with a
 *    BOM, because a plain UTF-8 .txt is still guessed as GBK by a lot of
 *    Windows software and opens as mojibake.
 *  - **EPUB** is the ebook standard: Apple Books, Kobo, Google Play Books, and
 *    Kindle via Send to Kindle, which converts on delivery. We do not emit
 *    MOBI — Amazon has been retiring it from Send to Kindle, and EPUB is the
 *    format they now ask for.
 *  - **Markdown** for anything that will be edited again or put in a repo.
 *  - **HTML** is one self-contained, print-ready file. It exists because
 *    there is no PDF here: a correct CJK PDF needs an embedded font of several
 *    megabytes, and the browser already has the fonts and a good paginator.
 *    Open the HTML and print to PDF.
 *
 * Everything is assembled in memory. 120 episodes of a short drama is a few
 * hundred kilobytes of text — streaming would be machinery for a problem this
 * does not have.
 */

export { NOVEL_EXPORT_FORMATS }
export type { NovelExportFormat }

export type NovelExportOptions = {
  format: NovelExportFormat
  /** Episode ids to include. Empty means every episode with prose in it. */
  episodeIds?: string[]
  /** Skip episodes with no text. On by default — blank chapters help nobody. */
  includeEmpty?: boolean
}

export type NovelExportFile = {
  filename: string
  contentType: string
  body: Buffer
}

type Episode = {
  id: string
  number: number
  title: string
  /** Chapter title and prose, in order. */
  chapters: { title: string; text: string }[]
  charCount: number
}

/* -------------------------------------------------------------------------- */
/* Gathering                                                                   */
/* -------------------------------------------------------------------------- */

async function gather(projectId: string, options: NovelExportOptions) {
  const [project] = await db
    .select({
      title: projects.title,
      novelTitle: projects.novelTitle,
      synopsis: projects.synopsis,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) throw new Error('找不到這部作品')

  const wanted = options.episodeIds ?? []

  const rows = await db
    .select({
      episodeId: episodes.id,
      number: episodes.number,
      episodeTitle: episodes.title,
      chapterTitle: chapters.title,
      content: chapters.content,
      sortOrder: chapters.sortOrder,
    })
    .from(episodes)
    .leftJoin(
      documents,
      and(
        eq(documents.episodeId, episodes.id),
        eq(documents.kind, 'NOVEL'),
        isNull(documents.deletedAt)
      )
    )
    .leftJoin(chapters, eq(chapters.documentId, documents.id))
    .where(
      and(
        eq(episodes.projectId, projectId),
        isNull(episodes.deletedAt),
        ...(wanted.length > 0 ? [inArray(episodes.id, wanted)] : [])
      )
    )
    .orderBy(asc(episodes.number), asc(chapters.sortOrder))

  const byEpisode = new Map<string, Episode>()

  for (const row of rows) {
    let episode = byEpisode.get(row.episodeId)
    if (!episode) {
      episode = {
        id: row.episodeId,
        number: row.number,
        title: row.episodeTitle ?? '',
        chapters: [],
        charCount: 0,
      }
      byEpisode.set(row.episodeId, episode)
    }

    // The left joins produce one all-null row for an episode with no document.
    if (row.content === null) continue

    const text = htmlToText(row.content)
    if (text.length === 0) continue

    episode.chapters.push({ title: row.chapterTitle ?? '', text })
    episode.charCount += text.replace(/\s/g, '').length
  }

  const list = [...byEpisode.values()].sort((a, b) => a.number - b.number)

  return {
    project,
    episodes: options.includeEmpty ? list : list.filter((e) => e.charCount > 0),
  }
}

/** One chapter, ready for the reader. */
export type ReaderChapter = {
  id: string
  episodeId: string
  episodeNumber: number
  episodeTitle: string
  chapterTitle: string
  paragraphs: string[]
  charCount: number
}

/**
 * The whole novel as paragraphs, for 小說閱讀器.
 *
 * The HTML is flattened on the server for the same reason the export is: the
 * reader renders plain paragraphs into its own typography, and shipping the
 * editor's markup to be injected into the page would mean trusting stored
 * HTML in a context that has none of the editor's sanitising.
 */
export async function novelForReading(projectId: string): Promise<ReaderChapter[]> {
  const rows = await db
    .select({
      chapterId: chapters.id,
      episodeId: episodes.id,
      number: episodes.number,
      episodeTitle: episodes.title,
      chapterTitle: chapters.title,
      content: chapters.content,
      sortOrder: chapters.sortOrder,
    })
    .from(episodes)
    .innerJoin(
      documents,
      and(
        eq(documents.episodeId, episodes.id),
        eq(documents.kind, 'NOVEL'),
        isNull(documents.deletedAt)
      )
    )
    .innerJoin(chapters, eq(chapters.documentId, documents.id))
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
    .orderBy(asc(episodes.number), asc(chapters.sortOrder))

  return rows
    .map((row) => {
      const text = htmlToText(row.content)
      const blocks = paragraphs(text)

      return {
        id: row.chapterId,
        episodeId: row.episodeId,
        episodeNumber: row.number,
        episodeTitle: row.episodeTitle ?? '',
        chapterTitle: row.chapterTitle ?? '',
        paragraphs: blocks,
        charCount: text.replace(/\s/g, '').length,
      }
    })
    // An empty chapter in the reader is a page that says nothing; it belongs
    // in the editor, where it is a plan, not here.
    .filter((chapter) => chapter.paragraphs.length > 0)
}

/* -------------------------------------------------------------------------- */
/* HTML to text                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The prose is stored as the editor's HTML; every format here needs it as
 * paragraphs of text.
 *
 * Block ends become newlines *before* tags are stripped, or every paragraph
 * would be welded into one line — which is what makes a bad TXT export
 * unreadable. `<br>` is a single newline, a closing block is a blank line.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n\n')
    .replace(/<hr\s*\/?>/gi, '\n\n* * *\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    // `&amp;` last: doing it first would turn `&amp;lt;` into a real `<`.
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
}

/**
 * Whether to print the chapter title above the prose.
 *
 * One chapter per episode is the normal arrangement here, and the split tool
 * set both names from the same source — so the export was printing
 * 「第 1 集　三文錢的生意」 and then 「── 三文錢的生意 ──」 directly
 * under it. A heading that repeats the heading above it is noise.
 *
 * Only a chapter whose name says something the episode heading does not.
 */
function showsChapterTitle(episode: Episode, title: string): boolean {
  const name = title.trim()
  if (!name) return false
  if (episode.chapters.length > 1) return true
  return name !== episode.title.trim()
}

function episodeLabel(episode: Episode): string {
  const number = `第 ${episode.number} 集`
  return episode.title ? `${number}　${episode.title}` : number
}

/* -------------------------------------------------------------------------- */
/* Formats                                                                     */
/* -------------------------------------------------------------------------- */

export async function exportNovel(
  projectId: string,
  options: NovelExportOptions
): Promise<NovelExportFile> {
  const { project, episodes: list } = await gather(projectId, options)

  const title = project.novelTitle?.trim() || project.title
  const stem = safeFilename(title)

  switch (options.format) {
    case 'txt':
      return {
        filename: `${stem}.txt`,
        contentType: 'text/plain; charset=utf-8',
        // The BOM is deliberate: without it a lot of Windows software still
        // guesses GBK for a .txt and the whole book opens as mojibake.
        body: Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(buildTxt(title, list), 'utf8')]),
      }

    case 'markdown':
      return {
        filename: `${stem}.md`,
        contentType: 'text/markdown; charset=utf-8',
        body: Buffer.from(buildMarkdown(title, list), 'utf8'),
      }

    case 'html':
      return {
        filename: `${stem}.html`,
        contentType: 'text/html; charset=utf-8',
        body: Buffer.from(buildHtml(title, list), 'utf8'),
      }

    case 'epub':
      return {
        filename: `${stem}.epub`,
        contentType: 'application/epub+zip',
        body: buildEpub(title, project.synopsis ?? '', list),
      }
  }
}

function buildTxt(title: string, list: Episode[]): string {
  const parts = [title, '', '']

  for (const episode of list) {
    parts.push(episodeLabel(episode), '')

    for (const chapter of episode.chapters) {
      if (showsChapterTitle(episode, chapter.title)) {
        parts.push(`　　── ${chapter.title} ──`, '')
      }
      // Two full-width spaces: the standard first-line indent in Chinese
      // typesetting, and what every reader app expects to find already there.
      for (const block of paragraphs(chapter.text)) {
        parts.push(`　　${block.replace(/\n/g, '\n　　')}`)
      }
      parts.push('')
    }

    parts.push('')
  }

  return parts.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n'
}

function buildMarkdown(title: string, list: Episode[]): string {
  const parts = [`# ${title}`, '']

  for (const episode of list) {
    parts.push(`## ${episodeLabel(episode)}`, '')

    for (const chapter of episode.chapters) {
      if (showsChapterTitle(episode, chapter.title)) parts.push(`### ${chapter.title}`, '')
      for (const block of paragraphs(chapter.text)) {
        parts.push(block.replace(/\n/g, '  \n'), '')
      }
    }
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n')
}

function buildHtml(title: string, list: Episode[]): string {
  const body = list
    .map((episode) => {
      const inner = episode.chapters
        .map((chapter) => {
          const head = showsChapterTitle(episode, chapter.title)
            ? `<h3>${escapeXml(chapter.title)}</h3>\n`
            : ''
          const prose = paragraphs(chapter.text)
            .map((block) => `<p>${escapeXml(block).replace(/\n/g, '<br />')}</p>`)
            .join('\n')
          return head + prose
        })
        .join('\n')

      return `<section class="episode">\n<h2>${escapeXml(episodeLabel(episode))}</h2>\n${inner}\n</section>`
    })
    .join('\n\n')

  const chars = list.reduce((n, e) => n + e.charCount, 0)

  /*
   * Self-contained and print-ready. There is no PDF export because a correct
   * CJK PDF needs an embedded font of several megabytes; the browser already
   * has the fonts, so printing this to PDF gives a better result than anything
   * generated here would.
   */
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeXml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 3rem 1.5rem; max-width: 38rem;
    font-family: "Noto Serif TC", "Source Han Serif TC", "PingFang TC",
                 "Microsoft JhengHei", serif;
    font-size: 18px; line-height: 2; color: #1b1b1f; background: #fdfbf7;
    text-align: justify;
  }
  @media (prefers-color-scheme: dark) { body { color: #d9d7e0; background: #15131c; } }
  h1 { font-size: 1.9rem; text-align: center; margin: 0 0 .5rem; }
  .meta { text-align: center; color: #8a8694; font-size: .8rem; margin-bottom: 3rem; }
  h2 { font-size: 1.25rem; margin: 3rem 0 1.25rem; text-align: center; }
  h3 { font-size: 1rem; font-weight: 500; color: #6d6a78; margin: 2rem 0 1rem; }
  p { margin: 0 0 1em; text-indent: 2em; }
  .episode { break-before: page; }
  @media print {
    body { padding: 0; font-size: 11pt; background: #fff; color: #000; }
    .meta { margin-bottom: 2rem; }
  }
</style>
</head>
<body>
<h1>${escapeXml(title)}</h1>
<p class="meta">${list.length} 集・${chars.toLocaleString('en-US')} 字</p>
${body}
</body>
</html>
`
}

function buildEpub(title: string, synopsis: string, list: Episode[]): Buffer {
  // Stable across exports of the same book, so a reader updating a file
  // recognises it as the same work rather than adding a second copy.
  const uid = `urn:uuid:${uuidFrom(title)}`
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  const docs = list.map((episode, index) => {
    const name = `ch${String(index + 1).padStart(4, '0')}.xhtml`
    const inner = episode.chapters
      .map((chapter) => {
        const head = showsChapterTitle(episode, chapter.title)
          ? `<h3>${escapeXml(chapter.title)}</h3>\n`
          : ''
        const prose = paragraphs(chapter.text)
          .map((block) => `<p>${escapeXml(block).replace(/\n/g, '<br />')}</p>`)
          .join('\n')
        return head + prose
      })
      .join('\n')

    const label = episodeLabel(episode)

    return {
      name,
      label,
      xhtml: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-Hant" lang="zh-Hant">
<head><meta charset="utf-8" /><title>${escapeXml(label)}</title>
<link rel="stylesheet" type="text/css" href="style.css" /></head>
<body><h2>${escapeXml(label)}</h2>
${inner}
</body></html>
`,
    }
  })

  const manifest = docs
    .map((doc) => `    <item id="${doc.name.replace('.xhtml', '')}" href="${doc.name}" media-type="application/xhtml+xml"/>`)
    .join('\n')

  const spine = docs
    .map((doc) => `    <itemref idref="${doc.name.replace('.xhtml', '')}"/>`)
    .join('\n')

  const navList = docs
    .map((doc) => `      <li><a href="${doc.name}">${escapeXml(doc.label)}</a></li>`)
    .join('\n')

  const ncxList = docs
    .map(
      (doc, index) => `    <navPoint id="nav${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(doc.label)}</text></navLabel>
      <content src="${doc.name}"/>
    </navPoint>`
    )
    .join('\n')

  return createZip([
    /*
     * `mimetype` must be first and stored uncompressed: a reader checks for
     * the magic string at a fixed byte offset, and a deflated or reordered
     * entry makes the file unopenable with no useful error.
     */
    { path: 'mimetype', data: 'application/epub+zip', store: true },

    {
      path: 'META-INF/container.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
    },

    {
      path: 'OEBPS/content.opf',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-Hant">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>zh-Hant</dc:language>
${synopsis.trim() ? `    <dc:description>${escapeXml(synopsis.trim())}</dc:description>\n` : ''}    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>
`,
    },

    {
      path: 'OEBPS/nav.xhtml',
      data: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-Hant" lang="zh-Hant">
<head><meta charset="utf-8" /><title>目錄</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目錄</h1>
    <ol>
${navList}
    </ol>
  </nav>
</body></html>
`,
    },

    {
      // EPUB 3 does not need an NCX, but plenty of older readers — and a few
      // current Chinese ones — show no table of contents without it.
      path: 'OEBPS/toc.ncx',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${uid}"/></head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${ncxList}
  </navMap>
</ncx>
`,
    },

    {
      path: 'OEBPS/style.css',
      data: `body { font-family: serif; line-height: 1.9; text-align: justify; margin: 1em; }
h2 { text-align: center; font-size: 1.3em; margin: 1.5em 0 1em; }
h3 { font-size: 1em; font-weight: normal; color: #666; margin: 1.5em 0 .8em; }
p { margin: 0 0 .8em; text-indent: 2em; }
`,
    },

    ...docs.map((doc) => ({ path: `OEBPS/${doc.name}`, data: doc.xhtml })),
  ])
}

/* -------------------------------------------------------------------------- */

/**
 * A deterministic UUID from the title.
 *
 * Not random: re-exporting the same book must produce the same identifier, or
 * a reader treats each download as a different work and the library fills with
 * duplicates. Not a real UUIDv5 — there is no namespace hashing here — but it
 * is well-formed, stable, and only ever compared for equality.
 */
function uuidFrom(title: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193

  for (let i = 0; i < title.length; i += 1) {
    h1 = Math.imul(h1 ^ title.charCodeAt(i), 0x01000193) >>> 0
    h2 = Math.imul(h2 + title.charCodeAt(i), 0x85ebca6b) >>> 0
  }

  const hex = (n: number) => n.toString(16).padStart(8, '0')
  const a = hex(h1)
  const b = hex(h2)
  const c = hex((h1 ^ h2) >>> 0)
  const d = hex((Math.imul(h1, h2) >>> 0) || 0x9e3779b9)

  return `${a}-${b.slice(0, 4)}-4${b.slice(5)}-a${c.slice(1, 4)}-${c.slice(4)}${d}`
}

function safeFilename(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 80) || 'novel'
}
