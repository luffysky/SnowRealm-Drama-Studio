import { NextResponse } from 'next/server'
import { handle, parseJson, requireUser } from '@/lib/api'
import { synthesize, voicePool } from '@/lib/azure/speech'
import { ssmlFor } from '@/lib/tts/ssml'
import { styleFor } from '@/lib/tts/style'
import { voicePreviewSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 試聽一句，給選音色用 (Z140).
 *
 * 選音色沒有試聽，等於憑名字猜。`zh-CN-XiaoyiNeural` 跟 `zh-CN-XiaozhenNeural`
 * 從字串上分不出任何事——而它們是兩個完全不同的人。
 *
 * ## 預設那句話是故意挑的
 *
 * 「他頓了頓，說要還錢。」裡面有兩個使用者親耳聽到唸錯的破音字：頓（會被
 * 唸成 ㄉㄨˊ）跟還（會被唸成 ㄏㄞˊ）。所以這一句同時在試兩件事——這把
 * 嗓子是誰，以及這個音色吃不吃得下破音字修正。
 *
 * 走 `ssmlFor`，不是自己拼一段 SSML。試聽跟正式產出必須是**同一條路**：
 * 試聽時聽到的跟匯出的不一樣，那試聽就是在騙人。
 */

/** 兩個破音字都在裡面。 */
const DEFAULT_LINE = '他頓了頓，說要還錢。'

export const POST = handle(async (request: Request) => {
  await requireUser()

  const input = await parseJson(request, voicePreviewSchema)

  /*
   * 音色要先確認在清單裡。
   *
   * 不是為了防呆——是因為 `voiceId` 會原樣進到 SSML 的屬性裡，而一個不存在
   * 的音色名字換來的是 400。先比對一次，錯誤訊息就能講得出哪裡不對，而不是
   * 轉述 Azure 的四百。
   */
  const pool = await voicePool()
  const voice = pool.find((row) => row.id === input.voiceId)

  if (!voice) {
    return NextResponse.json(
      { error: { code: 'voice_not_found', message: '這個音色不在可用清單裡' } },
      { status: 404 }
    )
  }

  /*
   * 風格要這個音色真的支援才送。`styleFor` 會做這件事，而且退讓的方向跟
   * 正式產出一致——試聽退到 gentle，匯出就不會變成別的。
   */
  const style = styleFor({
    emotion: null,
    base: input.style ?? null,
    supported: voice.styles,
  })

  const ssml = ssmlFor(
    [{ text: input.text ?? DEFAULT_LINE, paragraph: 0, ...(style ? { style } : {}) }],
    { locale: voice.locale.startsWith('zh') ? voice.locale : 'zh-TW', narratorVoice: voice.id }
  )

  const audio = await synthesize(ssml)

  return new NextResponse(new Uint8Array(audio), {
    headers: {
      'content-type': 'audio/mpeg',
      'content-length': String(audio.length),
      // 同一個音色同一句話，瀏覽器可以自己留著——按兩次不該收兩次錢。
      'cache-control': 'private, max-age=3600',
      // 風格有沒有真的套上去，讓介面講得出來。
      'x-voice-style': style ?? '',
    },
  })
})
