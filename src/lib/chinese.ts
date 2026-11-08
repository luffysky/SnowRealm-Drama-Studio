import * as OpenCC from 'opencc-js'

/**
 * 繁簡轉換 (Z135).
 *
 * **原文是簡體。** 暖寶是大陸人，稿子是她用簡體寫的；要讀繁體的是這邊的人。
 *
 * 這一句在 Z172 之前是反過來寫的（「作品是用繁體寫的」），而整個繁簡功能是照
 * 那句話蓋的——「繁體」的意思是「不要轉」，只有繁 → 簡那個方向真的會執行。前
 * 提一翻過來，那個設計就變成：**選「繁體」等於把轉換關掉，看到的還是簡體。**
 *
 * 所以現在兩個方向都要真的走，而危險的那一個（簡 → 繁，一對多）靠
 * `toTraditionalIfSimplified` 的防護，免得把介面上寫死的繁體字弄壞。
 *
 * 兩條規矩：
 *
 * 1. **只在顯示的時候轉，永遠不動存起來的正文。** 轉換是有損的：簡體轉回
 *    繁體是一對多，`乾`/`幹`/`干` 都是 `干`。把轉換後的結果存回去，等於把
 *    作者寫的字換掉，而且換不回來。
 *
 * 2. **用詞彙層級的轉換，不要用單字對照表。** 這不是講究，是對錯問題：
 *
 *        頭髮 → 头发      發現 → 发现      （同一個「發」，兩個簡體字）
 *        著火 → 着火      顯著 → 显著      （同一個「著」）
 *        乾淨 → 干净      乾坤 → 乾坤      （「乾」有時候根本不轉）
 *        沈知味 → 沈知味                   （姓氏不會變成「沉」）
 *
 *    單字對照表這四組全部會錯，而且錯得很安靜——讀起來像錯字，不像壞掉。
 *    OpenCC 的字典答得對，所以用它而不是自己寫一張表。
 */

export type ScriptPreference = 'original' | 'simplified' | 'traditional'

export const SCRIPT_LABEL: Record<ScriptPreference, string> = {
  original: '原文',
  simplified: '简体',
  traditional: '繁體',
}

/**
 * 預設簡體，因為**原文就是簡體** (Z172).
 *
 * 這個值沒有變，但它的理由整個換掉了。原本是「作者寫繁體、讀者預設看簡
 * 體」，所以預設值是一次轉換；現在稿子本來就是簡體，所以預設值是**零動作**
 * ——`original` 跟 `simplified` 在今天的稿子上看起來一樣。
 *
 * 不改成 `traditional`，是因為寫稿的人讀的是簡體，而讀繁體的人切一次就記住
 * 了（存在 localStorage）。預設值該服務寫得最多的那個人。
 */
export const DEFAULT_SCRIPT: ScriptPreference = 'simplified'

/*
 * Built once, on first use.
 *
 * The dictionaries are the bulk of this library, so building a converter
 * eagerly would make every import of this module pay for one it may never
 * call. Each direction is built only when something actually converts.
 *
 * 這裡**不再**是「大部分頁面根本不轉換所以不用付錢」那個故事了：
 * `ScriptProvider` 在模組最上層就 `void import('@/lib/chinese')`（給 `fold`
 * 用），而它掛在 studio 的 layout 上，所以整個 studio 的每一頁都已經無條件
 * 載入這個 chunk。延遲建構省下的是**建轉換器**的成本，不是下載字典的成本。
 */
let toCn: ((text: string) => string) | null = null
let toTw: ((text: string) => string) | null = null

function simplifier(): (text: string) => string {
  /*
   * `tw` rather than `t`: the source is Taiwanese Traditional, and the
   * Taiwan-specific readings are what this novel is written in.
   */
  toCn ??= OpenCC.Converter({ from: 'tw', to: 'cn' })
  return toCn
}

function traditionaliser(): (text: string) => string {
  toTw ??= OpenCC.Converter({ from: 'cn', to: 'tw' })
  return toTw
}

/**
 * 繁 → 簡.
 *
 * 來源仍然是 `tw`，即使小說原文已經是簡體：這個方向真正要轉的是**介面上寫死
 * 的繁體字**，而那些是台灣用字。對已經是簡體的正文，它是等冪的零動作。
 */
export function toSimplified(text: string): string {
  if (!text) return text
  return simplifier()(text)
}

/**
 * 簡 → 繁.
 *
 * Offered for completeness, but it is the lossy direction: one simplified
 * character can stand for several traditional ones and only context decides.
 * OpenCC's phrase dictionary handles the common cases; the rest will
 * occasionally be wrong, which is why the stored prose is never run through
 * it.
 */
export function toTraditional(text: string): string {
  if (!text) return text
  return traditionaliser()(text)
}

/**
 * 簡 → 繁，但只動看起來真的是簡體的那一段 (Z172).
 *
 * 無條件跑 `toTraditional` 會**弄壞已經是繁體的字**：`干` 在繁體裡是個正當的
 * 字，而 cn→tw 會把它變成 `幹`（實測如此）。
 *
 * 要保護的不是稿子——稿子是簡體的（見檔案開頭）。要保護的是**介面上幾百個寫死
 * 的繁體標籤**，以及使用者自己打進資料庫的繁體短字串（素材名、標籤、角色暱
 * 稱）。這一段原本寫「作品本身是繁體寫的，所以繁體這個選項在它身上必須是零動
 * 作」——那是舊前提，而且正是這次改動要推翻的那一句。
 *
 * 判準是「這一段有沒有繁體獨有的字」，而拿來問的就是反方向的轉換器：
 * `toSimplified(text) !== text` 代表裡面有東西可以簡化，也就是它本來就是繁
 * 體——那就別碰。`許山河推開門` 會被這一條擋下來，`头发` 不會。
 *
 * 粒度是一段。一整段都沒有繁體獨有字、卻又是繁體寫的（例如只有「干！」兩個
 * 字的一句），仍然會被當成簡體轉掉——那是這個啟發法的已知極限，而換成整本書
 * 投票會讓混排的譯稿整本都不轉。段落級在真實稿子上夠準：繁體小說的一段幾乎
 * 一定帶著某個繁體獨有字。
 */
function toTraditionalIfSimplified(text: string): string {
  if (!text) return text
  if (toSimplified(text) !== text) return text
  return toTraditional(text)
}

/** Whichever the reader asked for. `original` is returned untouched. */
export function convertScript(text: string, preference: ScriptPreference): string {
  if (preference === 'simplified') return toSimplified(text)
  if (preference === 'traditional') return toTraditionalIfSimplified(text)
  return text
}

/**
 * Converts a whole chapter's paragraphs in one pass.
 *
 * One converter call per paragraph rather than joining and splitting: a
 * separator would have to be a character that cannot appear in the prose, and
 * there is no such character.
 */
export function convertParagraphs(
  paragraphs: readonly string[],
  preference: ScriptPreference
): string[] {
  if (preference === 'original') return [...paragraphs]
  // 兩個方向都走 `convertScript`，簡 → 繁 的那道防護才不會只有一半的呼叫端有。
  return paragraphs.map((text) => (text ? convertScript(text, preference) : text))
}

/**
 * 比對使用者打的字時，兩邊要折到同一個點 (Z139，算式在 Z174 修正).
 *
 * 畫面顯示的是轉換後的字形，資料庫裡存的是原值。要使用者打名字確認的地方
 * （刪除素材）如果直接比對原值，**照著畫面打反而不給過**——是這個轉換功能
 * 自己製造出來的坑。
 *
 * 原本的做法是兩邊都折成簡體，理由是「繁 → 簡 是多對一，所以是穩定的標準
 * 形」。那句話對單一方向成立，但這裡要的是 `簡(繁體化(x)) === 簡(x)`，而**它
 * 不成立**：
 *
 *     存的是 熏香 → 畫面顯示 薰香 → 折成簡體 薰香   （`薰` 沒有更簡的寫法）
 *     存的是 熏香 →              → 折成簡體 熏香
 *
 * 於是照著畫面打 `薰香` 不給過。掃 U+4E00–U+9FFF，有 17 個單字會這樣
 * （侭昵渖稆縆缐讬谘迳钜锺镟颚馀鲶麹麺），詞組層也有。
 *
 * 所以**先套畫面那條轉換，再折成簡體**：前一步讓兩邊落在同一點，後一步讓使
 * 用者打另一種字形也收。
 *
 * 這一支是純函式而且匯出，是為了讓它測得到——它原本寫在 `ScriptProvider` 的
 * `useCallback` 裡，而那裡沒有 jsdom 測不到。
 */
export function foldForCompare(text: string, preference: ScriptPreference): string {
  return toSimplified(convertScript(text, preference))
}

/*
 * 一個字折一次，而且結果會留著 (Z179).
 *
 * `foldForSearch` 會被每一次按鍵叫到，餵進去的是一整章（這本書一章 9,000
 * 字）。不快取的話每打一個字就是九千次轉換器呼叫。快取的鍵是**單字**，所以一
 * 章裡不同的字大約一兩千個，第二次開始全是 Map 查詢。
 */
const searchFoldCache = new Map<string, string>()

/**
 * 搜尋比對用的折疊：繁簡兩種都收，而且**長度一個字都不會變** (Z179).
 *
 * ## 為什麼不能用 `foldForCompare`
 *
 * `foldForCompare` 是給「打字確認」用的，它只要答對或錯。搜尋不一樣：找到之後
 * 要知道**它在文件的哪個位置**，而位置是靠偏移量算的。詞彙層級的轉換會改變長
 * 度（`計算機` → `计算机` 剛好同長，但一對多與多對一的詞組不保證），於是折疊
 * 後的偏移量對不回原文——高亮會標在隔壁，取代會砍到別的字。那種錯不會報錯，
 * 只會默默吃掉稿子。
 *
 * 所以這一支**逐字**折，而且只在「換出來剛好一樣長」的時候採用，否則保留原
 * 字。於是 `fold(text).length === text.length` 恆成立（有測試守著），偏移量可
 * 以直接拿來用。
 *
 * ## 逐字折不準，但它一致，而搜尋要的是一致
 *
 * 逐字會失去詞彙上下文：`頭髮` 與 `發現` 的 `髮`／`發` 是兩個不同的簡體字，而
 * 逐字只能給一個答案。這對**顯示**是錯的（所以顯示那條路走的是
 * `convertScript`，不是這裡），但對**比對**不是錯的——因為兩邊都用同一張表折，
 * 所以 `头发` 與 `頭髮` 一定落在同一點。
 *
 * 代價是會多收：折疊後 `干`／`乾`／`幹` 同一點，所以搜「干」會連「乾淨」一起
 * 找到。對一個標著「繁簡通用」的開關來說，多收是它該有的行為；不想要的時候把
 * 開關關掉就是精確比對。
 */
export function foldForSearch(text: string): string {
  if (!text) return text

  let out = ''
  // `for…of` 走的是碼位，所以代理對（罕用漢字）是一個 char，不會被切兩半。
  for (const char of text) {
    let folded = searchFoldCache.get(char)
    if (folded === undefined) {
      const converted = toSimplified(char)
      // 長度不同就不要——偏移量的正確性比多認一個字重要。
      folded = converted.length === char.length ? converted : char
      searchFoldCache.set(char, folded)
    }
    out += folded
  }
  return out
}

export function isScriptPreference(value: unknown): value is ScriptPreference {
  return value === 'original' || value === 'simplified' || value === 'traditional'
}
