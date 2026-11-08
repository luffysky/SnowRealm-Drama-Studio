import { foldHeader } from '@/lib/import/map'
import { IMPORT_TARGETS, type ImportTargetKey } from '@/lib/import/targets'

/**
 * 從檔名看出這個檔案是給哪一區用的 (Z185).
 *
 * 一次丟二十個檔案進來的時候，一個一個指定「這是分鏡、那是角色」比產生那些
 * 檔案還久。所以檔名裡帶著答案——而規格寫在這裡、也印在下載的說明裡，給模型
 * 照著命名。
 *
 * ## 猜錯比猜不到糟
 *
 * 所以只認**明確的關鍵字**，認不出來就回 null 讓人自己選。不做模糊比對：一
 * 個叫「第一集整理.csv」的檔案可能是任何東西，而把它猜成集數大綱然後蓋掉
 * 二十集的標題，是這個功能唯一能造成的嚴重傷害。
 *
 * ## 檔名還能帶預設值
 *
 * `分鏡-EP001-S01.csv` 裡的 `S01` 會變成那一批鏡頭的場次預設值——內容裡沒有
 * 「場次」那一欄時才用得上，有的話以內容為準。檔名是補充，不是覆蓋。
 */

export type FilenameHints = {
  target: ImportTargetKey | null
  /** `EP001` / `第 1 集` 裡的數字。 */
  episodeNumber: number | null
  /** 內容沒給這些欄位時拿來補。鍵是欄位 key。 */
  defaults: Record<string, string>
  /** 認出來是靠哪個字，給介面顯示用。 */
  matched: string | null
}

/**
 * 每一區認哪些關鍵字。
 *
 * 第一個是**建議用的那個**，會印在規格說明裡；其餘是也收的寫法。比對前兩邊
 * 都折繁簡，所以「分镜」「分鏡」寫哪個都行。
 */
export const FILENAME_KEYWORDS: Record<ImportTargetKey, readonly string[]> = {
  shots: ['分鏡', '鏡頭', 'storyboard', 'shots', 'shot'],
  characters: ['角色', '人物', 'characters', 'character', 'cast'],
  world: ['世界觀', '設定集', 'worldbuilding', 'world', 'lore'],
  episodes: ['集數大綱', '分集大綱', '大綱', 'episodes', 'episode', 'outline'],
  chapters: ['小說', '章節', 'novel', 'chapters', 'chapter'],
  scenes: ['劇本', '場次', 'script', 'scenes', 'scene'],
  tasks: ['任務', '待辦', 'tasks', 'task', 'todo'],
  expenses: ['支出', '費用', '花費', 'expenses', 'expense', 'cost'],
}

export function readFilename(filename: string): FilenameHints {
  // 副檔名與路徑先拿掉——`分鏡.csv` 的 `csv` 不該參與比對。
  const base = filename.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '')
  const folded = foldHeader(base)

  let target: ImportTargetKey | null = null
  let matched: string | null = null
  /*
   * 取**最長的那個**關鍵字。`小說` 與 `集數大綱` 都可能出現在同一個檔名裡
   * （`小說-集數大綱.csv`），而長的那個比較明確。
   */
  for (const item of IMPORT_TARGETS) {
    for (const keyword of FILENAME_KEYWORDS[item.key]) {
      const needle = foldHeader(keyword)
      if (!needle || !folded.includes(needle)) continue
      if (!matched || needle.length > foldHeader(matched).length) {
        target = item.key
        matched = keyword
      }
    }
  }

  return {
    target,
    episodeNumber: readEpisode(base),
    defaults: readDefaults(base, target),
    matched,
  }
}

/**
 * `EP001` / `ep1` / `第 12 集` / `E05`。
 *
 * **`S01` 不算集數**——在分鏡與劇本裡 `S` 是場次。混用的話，一個叫
 * `分鏡-S01.csv` 的檔案會被匯進第一集，而它可能是第八集的第一場。
 */
function readEpisode(base: string): number | null {
  const match =
    /(?:^|[^a-z0-9])ep?[\s._-]*(\d{1,4})(?![0-9])/i.exec(base) ??
    /第\s*(\d{1,4})\s*集/.exec(base)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

/** 檔名裡的場次代號等等，給內容沒寫的欄位當預設。 */
function readDefaults(base: string, target: ImportTargetKey | null): Record<string, string> {
  if (target !== 'shots' && target !== 'scenes') return {}

  const scene = /(?:^|[^a-z0-9])(s\d{1,3})(?![0-9])/i.exec(base)?.[1]
  if (!scene) return {}

  // 分鏡的欄位叫 `sceneCode`，劇本場次的叫 `code`。
  return target === 'shots'
    ? { sceneCode: scene.toUpperCase() }
    : { code: scene.toUpperCase() }
}

/* -------------------------------------------------------------------------- */

/**
 * 檔名規格，給人看也給模型看。
 *
 * 這一份跟 `FILENAME_KEYWORDS` 是同一個來源，所以加一個關鍵字不會忘記更新文
 * 件——而一份過期的規格會讓人照著命名然後認不出來。
 */
export function filenameGuide(): string {
  const lines: string[] = [
    '# 匯入檔名規格',
    '',
    '一次可以丟很多個檔案。檔名裡帶著「這是哪一區的資料」，系統就不用一個一個問。',
    '認不出來的檔案不會亂猜——它會讓你自己選。',
    '',
    '## 基本寫法',
    '',
    '```',
    '<區塊關鍵字>[-EP集號][-S場次].<副檔名>',
    '```',
    '',
    '| 區塊 | 建議關鍵字 | 也認得 | 要不要集號 | 例子 |',
    '|---|---|---|---|---|',
  ]

  for (const target of IMPORT_TARGETS) {
    const [first, ...rest] = FILENAME_KEYWORDS[target.key]
    const needsEpisode = target.scope === 'episode'
    const example = needsEpisode
      ? `${first}-EP001.csv`
      : `${first}.csv`
    lines.push(
      `| ${target.label} | \`${first}\` | ${rest.map((k) => `\`${k}\``).join('、')} | ${needsEpisode ? '**要**' : '不用' } | \`${example}\` |`
    )
  }

  lines.push(
    '',
    '## 編碼',
    '',
    '**建議一律用 UTF-8。** 模型產出來的檔案本來就是 UTF-8，直接存就對了。',
    '',
    '| 編碼 | 收不收 | 說明 |',
    '|---|---|---|',
    '| UTF-8 | ✅ | 有沒有 BOM 都可以。BOM 會被吃掉，不會黏在第一個欄名上 |',
    '| UTF-16 LE／BE | ✅ | **要有 BOM**，沒有 BOM 的 UTF-16 認不出來 |',
    '| Big5 | ✅ | 繁體 Windows 的 Excel「另存 CSV」預設就是這個 |',
    '| GBK／GB18030 | ✅ | 簡體 Windows 的 Excel 預設 |',
    '| Shift-JIS、EUC-KR 等 | ❌ | 不猜。這裡的稿子不會是那些，而多一個候選就多一次猜錯 |',
    '| 沒有 BOM 的 UTF-16 | ❌ | 跟二進位檔分不開 |',
    '',
    '非 UTF-8 的檔案會被認出來並且**在畫面上說一聲**用了哪一種編碼——看起來不對的',
    '話，在 Excel 裡選「CSV UTF-8（逗號分隔）」重存一次最快。',
    '',
    '內容本身**繁體簡體都可以**，欄位名稱、景別、角色名都會自動對應：檔案寫',
    '「场次／景别／沈知味」跟寫「場次／景別／沈知味」，匯進來是同一個東西。',
    '',
    '## 幾條規矩',
    '',
    '- **`EP001`、`ep1`、`第 1 集` 都認得。** 集號指的是作品裡的第幾集。',
    '- **`S01` 不是集號，是場次。** 分鏡與劇本裡的 `S` 一律當場次；內容裡沒有',
    '  「場次」那一欄時，檔名裡的 `S01` 會補上去。',
    '- 一個檔名裡出現兩個區塊關鍵字時，取**比較長的那一個**（`小說-集數大綱` 會',
    '  當成集數大綱）。',
    '- 副檔名不影響判斷，內容才算：`.csv`、`.tsv`、`.txt`、`.json`、`.jsonl`、',
    '  `.md`、`.html`、`.xlsx` 都收，直接從試算表複製貼上也可以。',
    '- 檔名認不出來不是錯誤，只是要自己選一次。',
    '',
    '## 例子',
    '',
    '```',
    '分鏡-EP001.csv            ← 第 1 集的鏡頭表',
    '分鏡-EP001-S03.csv        ← 第 1 集，而且這一批都屬於 S03 場',
    '角色.json                 ← 整部作品的角色',
    '世界觀.md                 ← 整部作品的世界觀條目',
    '集數大綱.csv              ← 全部集數的大綱',
    '小說-EP002.md             ← 第 2 集的小說章節',
    '劇本-EP002.csv            ← 第 2 集的劇本場次',
    '任務.csv                  ← 跨集的任務',
    '支出.csv                  ← 花費紀錄',
    '```',
    ''
  )
  return lines.join('\n')
}
