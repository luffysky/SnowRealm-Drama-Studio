'use client'

import { Loader2, Play, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { cn } from '@/lib/utils'

/**
 * 挑一個音色，釘住它 (Z140).
 *
 * 在這之前這裡是**兩個純文字輸入框**：「音色 ID」要憑記憶打出
 * `zh-CN-XiaoxiaoNeural`，而這個帳號有 556 個音色；「語氣風格」要打出
 * `disgruntled` 而且沒有任何地方說得出哪些音色收這個字。結果是沒有人釘過
 * 任何一個音色——那個欄位看起來能用，實際上不能。
 *
 * 一個填不出來的欄位跟一個不存在的欄位，在資料庫裡是同一件事。
 *
 * ## 釘住音色為什麼重要
 *
 * 不釘的話，音色是**按順序分配**的：`assignVoices` 照角色的 id 排序發下去。
 * 所以每次角色表一變——新建一個人、刪掉一個人——後面所有人的聲音就跟著
 * 換人。120 集的作品不能這樣。
 *
 * ## 三件選的時候才需要知道的事
 *
 * 全部標在選項旁邊，而且全部是問過 Azure 的：
 *
 *  - **幾種情緒風格** —— 台灣的三個音色一種都沒有。沒有風格，
 *    `characters.voiceStyle` 就設了也不會生效。
 *  - **改不改得動破音字** —— 粵語吳語多語言一律不行，另外有四個收下來卻
 *    忽略。使用者已經聽到「還錢」唸成 ㄏㄞˊ 錢了，這一欄不是裝飾。
 *  - **它會把中文唸成什麼** —— 粵語音色會把同一份中文唸成粵語，不是帶
 *    廣東腔的國語。
 */

type Voice = {
  id: string
  label: string
  locale: string
  gender: string
  tier: string
  speaksChinese: boolean
  styles: string[]
  canCorrect: boolean
  spelling: 'bopomofo' | 'pinyin' | 'none'
}

type Catalogue = {
  available: boolean
  detail: string
  tiers: { value: string; label: string }[]
  voices: Voice[]
}

/**
 * Azure 的風格名字是英文的，而這裡要給中文使用者看。
 *
 * 認不出來的就原樣顯示——Azure 會加風格，而一個寫死的對照表遲早會遇到它
 * 沒有的那一個。顯示英文名字難看，但顯示空白會讓人以為那一項壞了。
 */
const STYLE_LABEL: Record<string, string> = {
  angry: '生氣',
  cheerful: '開心',
  sad: '悲傷',
  fearful: '害怕',
  terrified: '驚恐',
  gentle: '溫柔',
  calm: '平靜',
  serious: '嚴肅',
  disgruntled: '不悅',
  unfriendly: '冷淡',
  depressed: '低落',
  affectionate: '親切',
  embarrassed: '尷尬',
  excited: '興奮',
  friendly: '友善',
  hopeful: '期待',
  envious: '羨慕',
  whispering: '耳語',
  shouting: '喊',
  lyrical: '抒情',
  assistant: '助理',
  chat: '聊天',
  customerservice: '客服',
  newscast: '新聞',
  'newscast-casual': '新聞・輕鬆',
  'newscast-formal': '新聞・正式',
  'narration-relaxed': '旁白・放鬆',
  'narration-professional': '旁白・專業',
  'documentary-narration': '紀錄片',
  'poetry-reading': '朗詩',
  livecommercial: '直播帶貨',
  'sports-commentary': '體育解說',
  'sports-commentary-excited': '體育解說・激動',
}

function styleLabel(style: string): string {
  const zh = STYLE_LABEL[style]
  return zh ? `${zh}（${style}）` : style
}

export function VoicePicker({
  voiceId,
  voiceStyle,
  onSave,
}: {
  voiceId: string
  voiceStyle: string
  /** 存一個欄位。沿用角色頁本來那一支，所以存法只有一種。 */
  onSave: (field: string, value: string) => Promise<void>
}) {
  const toast = useToast()
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [loading, setLoading] = useState(true)
  const [previewing, setPreviewing] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  /** 上一段試聽的 object URL，要收掉——不收就是一個洩漏。 */
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const response = await apiFetch('/api/speech/voices')
        if (!response.ok) throw new Error(await readApiError(response))
        const body = (await response.json()) as { data?: Catalogue } & Partial<Catalogue>
        if (!cancelled) setCatalogue(body.data ?? (body as Catalogue))
      } catch {
        // 清單拿不到就退回「不知道」，而不是假裝沒有音色可用。
        if (!cancelled) setCatalogue(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    []
  )

  const voices = catalogue?.voices ?? []
  const chosen = voices.find((voice) => voice.id === voiceId) ?? null

  /** 這個音色支援的風格，加上「不設定」。 */
  const styles = chosen?.styles ?? []

  async function preview() {
    if (!voiceId || previewing) return
    setPreviewing(true)
    try {
      const response = await apiFetch('/api/speech/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voiceId, ...(voiceStyle ? { style: voiceStyle } : {}) }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const applied = response.headers.get('x-voice-style')
      const blob = await response.blob()

      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = URL.createObjectURL(blob)

      const audio = audioRef.current
      if (audio) {
        audio.src = urlRef.current
        await audio.play()
      }

      /*
       * 設了風格卻沒套上去要講出來。Azure 遇到不支援的風格會**安靜地照平常
       * 唸**——不報錯，所以沒人會知道這個設定沒生效。
       */
      if (voiceStyle && !applied) {
        toast.info('風格沒有套上', `這個音色不支援「${voiceStyle}」，聽到的是它平常的聲音。`)
      }
    } catch (cause) {
      toast.error('試聽失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setPreviewing(false)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-ink-600">
        <Loader2 aria-hidden className="size-3 animate-spin" />
        正在問 Azure 有哪些音色…
      </p>
    )
  }

  /*
   * 清單拿不到時**退回原來的輸入框**，而不是停用。
   *
   * 停用等於把已經填好的值鎖住，而那個值可能是對的——拿不到清單通常是
   * 金鑰還沒設，跟這個角色該用哪個音色無關。
   */
  if (!catalogue?.available) {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-400">音色 ID</span>
        <input
          defaultValue={voiceId}
          onBlur={(event) => void onSave('voiceId', event.target.value)}
          className="h-9 rounded-lg bg-stage-850 px-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
        />
        <span className="text-[10px] text-amber-400/80">
          {catalogue?.detail ?? '拿不到音色清單'}——所以只能手動填，也沒辦法試聽。
        </span>
      </label>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ------------------------------------------------------------ 音色 */}
      <label className="flex flex-col gap-1">
        <span className="flex items-baseline gap-2 text-[11px] text-ink-400">
          音色
          <span className="ml-auto text-[10px] text-ink-600">
            釘住了整季都沿用同一把嗓子
          </span>
        </span>

        <div className="flex gap-1.5">
          <select
            value={voiceId}
            onChange={(event) => void onSave('voiceId', event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg bg-stage-850 px-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          >
            <option value="">不釘，照順序自動分配</option>
            {catalogue.tiers.map((tier) => {
              const inTier = voices.filter((voice) => voice.tier === tier.value)
              if (inTier.length === 0) return null
              return (
                <optgroup key={tier.value} label={`${tier.label}（${inTier.length}）`}>
                  {inTier.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label || voice.id}
                      {voice.gender ? `・${voice.gender === 'Female' ? '女' : '男'}` : ''}
                      {voice.styles.length > 0 ? `・${voice.styles.length} 種情緒` : ''}
                      {voice.canCorrect ? '' : '・改不動破音字'}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </select>

          <button
            type="button"
            onClick={() => void preview()}
            disabled={!voiceId || previewing}
            title="唸一句「他頓了頓，說要還錢。」——兩個破音字都在裡面"
            className="tap inline-flex shrink-0 items-center gap-1 rounded-lg bg-stage-800 px-2.5 text-[11px] text-ink-200 transition-colors hover:text-ink-50 disabled:opacity-40"
          >
            {previewing ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <Play aria-hidden className="size-3.5" />
            )}
            試聽
          </button>
        </div>

        {chosen && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-600">
            <span className="font-mono">{chosen.id}</span>
            <span>{chosen.locale}</span>
            <span
              className={cn(
                chosen.canCorrect ? 'text-emerald-400/80' : 'text-amber-400/80'
              )}
            >
              {chosen.canCorrect
                ? `破音字改得動（${chosen.spelling === 'bopomofo' ? '注音' : '拼音'}）`
                : '破音字改不動'}
            </span>
            {!chosen.speaksChinese && (
              <span className="text-amber-400/80">這個音色不把中文唸成國語</span>
            )}
          </span>
        )}
      </label>

      {/* -------------------------------------------------------- 情緒風格 */}
      <label className="flex flex-col gap-1">
        <span className="flex items-baseline gap-2 text-[11px] text-ink-400">
          預設情緒風格
          <span className="ml-auto text-[10px] text-ink-600">
            正文寫出情緒的句子會蓋過這個設定
          </span>
        </span>

        {!voiceId ? (
          <p className="text-[10px] text-ink-600">先選一個音色——支援哪些風格是音色決定的。</p>
        ) : styles.length === 0 ? (
          /*
           * 停用要說出理由（規格 §4）。這個不是還沒做，是 Azure 這個音色
           * 真的沒有風格——台灣的三個都是這樣。
           */
          <p className="text-[10px] text-amber-400/80">
            這個音色沒有任何情緒風格，所以設了也不會生效。要演繹情緒就得換一個
            有風格的音色（大陸那邊有 20 個）。
          </p>
        ) : (
          <select
            value={voiceStyle}
            onChange={(event) => void onSave('voiceStyle', event.target.value)}
            className="h-9 rounded-lg bg-stage-850 px-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          >
            <option value="">不設定</option>
            {styles.map((style) => (
              <option key={style} value={style}>
                {styleLabel(style)}
              </option>
            ))}
          </select>
        )}

        {voiceStyle && styles.length > 0 && !styles.includes(voiceStyle) && (
          <span className="text-[10px] text-amber-400/80">
            現在存的是「{voiceStyle}」，但這個音色不支援——換音色的時候留下來的。
          </span>
        )}
      </label>

      {/* 一個就夠，重複用。 */}
      <audio ref={audioRef} className="hidden" preload="none">
        <track kind="captions" />
      </audio>

      {/*
       * 只講這裡選得到幾個。
       *
       * 本來把 Azure 回報的總數也印出來，於是變成「共 156 個音色。可以用，
       * 556 個音色」——兩個數字擺在一起沒有說明哪個是哪個，讀起來像壞掉。
       * 400 個是英文西班牙文那些，跟這部戲無關，講出來只是噪音。
       */}
      <p className="text-[10px] text-ink-700">
        <Volume2 aria-hidden className="mr-1 inline size-3" />
        這裡選得到 {voices.length} 個音色：中文的全部，加上英日韓。
      </p>
    </div>
  )
}
