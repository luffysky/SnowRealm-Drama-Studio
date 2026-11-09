'use client'

import { ChevronRight, Lightbulb, Quote as QuoteIcon } from 'lucide-react'
import { Fragment, useState } from 'react'
import {
  DEMO_SOURCE,
  REAL_HOLES,
  STEPS,
  TOGGLE_DEMO,
  type Finding,
} from '@/lib/help-writer'
import { VERDICT_HINT, type VerdictCode } from '@/lib/ai/story-audit-view'
import { VERDICT_TONE, VerdictPill } from '@/components/studio/VerdictPill'
import { cn } from '@/lib/utils'

/**
 * 編劇助手怎麼用，寫給暖寶（Z202）。
 *
 * ## 互動是重點，不是裝飾
 *
 * 這一頁要講清楚的事只有一件：**隱藏設定不是裝飾，它決定了這個工具判不判得出
 * 東西。** 寫三段講不清楚，但一個開關可以——同一條疑問，撥過去判定就變了。
 *
 * 那兩邊的結果**都是真的**（`help-writer.ts` 的檔頭說明了出處）。說明頁放一份
 * 看起來像結果的假資料，是「不要餵假資料」這條規矩最容易被繞過的形式：它不在資
 * 料庫裡，所以沒有任何檢查抓得到，而讀的人會以為那就是這個工具的水準。
 *
 * ## 寫給誰
 *
 * 讀者是老闆，不是工程師。一句話講一件事、專有名詞用白話、先講要做什麼再講為什
 * 麼——跟 `/help` 同一套規矩。
 */
export function WriterGuide() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Hero />
      <Steps />
      <ToggleDemo />
      <Verdicts />
      <Findings />
      <Footnotes />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="panel relative overflow-hidden rounded-3xl bg-stage-900 ring-1 ring-stage-700">
      <div aria-hidden className="bg-brand-gradient h-1.5 w-full" />
      <div className="flex flex-col gap-3 p-6 sm:p-8">
        <span
          aria-hidden
          className="bg-brand-gradient glow-accent-sm grid size-12 place-items-center rounded-3xl text-2xl"
        >
          🎬
        </span>
        <h2 className="text-2xl font-semibold tracking-tight text-ink-50">
          編劇助手怎麼用
        </h2>
        <p className="max-w-2xl text-base leading-8 text-ink-300">
          它會自己把你寫好的小說讀完，然後告訴你：每一集的爽點在哪裡、鉤子是什麼、
          還有哪裡讀起來會卡住。
          <br />
          <strong className="font-medium text-ink-100">不用貼稿子，不用複製到別的地方。</strong>
        </p>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */

/** 三個步驟。點哪一個就展開哪一個，一次只開一個——同時攤開三段就又變成一面牆。 */
function Steps() {
  const [open, setOpen] = useState(0)

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle icon="🪄">三步驟</SectionTitle>

      <ol className="flex flex-col gap-2.5">
        {STEPS.map((step, index) => {
          const active = open === index
          return (
            <li key={step.title}>
              <button
                type="button"
                onClick={() => setOpen(active ? -1 : index)}
                aria-expanded={active}
                className={cn(
                  'panel w-full rounded-3xl p-5 text-left ring-1 transition-all sm:p-6',
                  active
                    ? 'bg-stage-850 ring-accent-500/40'
                    : 'bg-stage-900 ring-stage-700 hover:-translate-y-0.5 hover:ring-stage-600'
                )}
              >
                <div className="flex items-center gap-3.5">
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-11 shrink-0 place-items-center rounded-2xl text-xl transition-colors',
                      active ? 'bg-brand-gradient' : 'bg-stage-800'
                    )}
                  >
                    {step.icon}
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-baseline gap-2">
                      <span className="text-xs text-ink-600 tabular-nums">
                        第 {index + 1} 步
                      </span>
                      <span className="text-lg font-semibold text-ink-50">{step.title}</span>
                    </span>
                    <span className="text-[15px] leading-7 text-ink-400">{step.lead}</span>
                  </div>

                  <ChevronRight
                    aria-hidden
                    className={cn(
                      'size-5 shrink-0 text-ink-600 transition-transform',
                      active && 'rotate-90'
                    )}
                  />
                </div>

                {active && (
                  <span className="mt-4 block border-t border-stage-700/60 pt-4 text-[15px] leading-8 text-ink-200">
                    <Emphasised text={step.detail} />
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * 整頁的核心。
 *
 * 同一條疑問，撥動「編劇有沒有填設定」，判定會變。兩邊都是真的跑出來的。
 */
function ToggleDemo() {
  const [withSecret, setWithSecret] = useState(false)
  const side = withSecret ? TOGGLE_DEMO.with : TOGGLE_DEMO.without

  return (
    <section className="panel flex flex-col gap-5 rounded-3xl bg-stage-900 p-6 ring-1 ring-stage-700 sm:p-8">
      <div className="flex flex-col gap-2">
        <SectionTitle icon="🔑">
          為什麼一定要填「隱藏設定」
        </SectionTitle>
        <p className="text-[15px] leading-8 text-ink-300">
          不填也判得了，但它什麼都不知道——
          <strong className="font-medium text-ink-100">
            第 1 集那次，七條疑問裡有六條它只能回「我判不出來」。
          </strong>
          <br />
          撥一下看看同一條疑問的差別：
        </p>
      </div>

      {/* 開關 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={withSecret}
          aria-label="編劇有沒有填隱藏設定"
          onClick={() => setWithSecret((v) => !v)}
          className={cn(
            'tap relative h-10 w-[4.5rem] shrink-0 rounded-full ring-1 transition-colors',
            withSecret
              ? 'bg-brand-gradient ring-accent-500/50'
              : 'bg-stage-800 ring-stage-600'
          )}
        >
          <span
            aria-hidden
            className={cn(
              'absolute top-1 grid size-8 place-items-center rounded-full bg-white text-base shadow transition-all duration-300',
              withSecret ? 'left-[2.25rem]' : 'left-1'
            )}
          >
            {withSecret ? '🔓' : '🔒'}
          </span>
        </button>

        <span className="text-base font-medium text-ink-100">
          {withSecret ? '編劇填了隱藏設定' : '編劇還沒填隱藏設定'}
        </span>
      </div>

      {/* 問題 */}
      <div className="flex flex-col gap-2 rounded-2xl bg-stage-850/60 p-4 ring-1 ring-stage-700/60">
        <span className="text-xs text-ink-600">觀眾讀到這裡卡住了</span>
        <p className="text-[17px] leading-8 text-ink-50">{TOGGLE_DEMO.question}</p>
        <p className="rounded-lg border-l-[3px] border-accent-500/60 bg-stage-950/50 py-2 pl-3 text-sm leading-7 text-ink-400">
          {TOGGLE_DEMO.quote}
        </p>
      </div>

      {/* 填進去的那一段——只有開著的時候出現 */}
      {withSecret && (
        <div className="flex flex-col gap-2 rounded-2xl bg-accent-700/15 p-4 ring-1 ring-accent-700/40">
          <span className="inline-flex items-center gap-1.5 text-xs text-accent-300">
            🔒 編劇填進去的（只有「編劇視角」那一趟看得到）
          </span>
          <p className="text-[15px] leading-8 text-ink-200">{TOGGLE_DEMO.secret}</p>
        </div>
      )}

      {/* 判定 */}
      <div
        className={cn(
          'flex flex-col gap-3 rounded-2xl p-5 ring-1 transition-all',
          VERDICT_TONE[side.verdict]
        )}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs text-ink-500">它的判定</span>
          <VerdictPill code={side.verdict} big />
        </div>

        <p className="text-[15px] leading-8 text-ink-200">{side.because}</p>

        {side.fix && (
          <p className="flex gap-2.5 rounded-xl bg-stage-950/40 p-3.5 text-[15px] leading-8">
            <span
              aria-hidden
              className="shrink-0 rounded-md bg-accent-500/20 px-2 text-[13px] leading-7 text-accent-300"
            >
              怎麼改
            </span>
            <span className="min-w-0 text-ink-100">{side.fix}</span>
          </p>
        )}
      </div>

      <p className="flex items-start gap-2 text-sm leading-7 text-ink-500">
        <Lightbulb aria-hidden className="mt-1 size-4 shrink-0 text-gilt-400" />
        填了設定之後，同一條從「我判不出來」變成「這不是漏洞，但鋪墊不夠」——而且給得出
        一句能直接用的改法。
      </p>
    </section>
  )
}

/** 四種判定。點了展開那一種的白話說明。 */
function Verdicts() {
  const [open, setOpen] = useState<VerdictCode | null>(null)

  const plain: Record<VerdictCode, string> = {
    HELD_BACK:
      '你是故意不講的，而且後面會講。**這種不要改**——觀眾在這裡有疑問正是你要的效果。',
    UNDER_SEEDED:
      '後面會講，但現在的線索太少，觀眾不是好奇而是困惑。要補的是**線索的分量**，不是把答案提前講出來。',
    REAL_HOLE:
      '後面也沒打算講，或是跟你已經寫定的事情打架。**這種才要改劇情。**',
    NOT_ENOUGH_INFO:
      '它判不出來。多半是因為那一集還沒填隱藏設定——補上去再判一次就會變準。',
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle icon="⚖️">它會把問題分成四種</SectionTitle>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {(Object.keys(plain) as VerdictCode[]).map((code) => {
          const active = open === code
          return (
            <button
              key={code}
              type="button"
              onClick={() => setOpen(active ? null : code)}
              aria-expanded={active}
              className={cn(
                'panel flex flex-col gap-2.5 rounded-3xl p-5 text-left ring-1 transition-all',
                active
                  ? VERDICT_TONE[code]
                  : 'bg-stage-900 ring-stage-700 hover:-translate-y-0.5 hover:ring-stage-600'
              )}
            >
              <div className="flex items-center gap-2">
                <VerdictPill code={code} big />
                <ChevronRight
                  aria-hidden
                  className={cn(
                    'ml-auto size-4 text-ink-600 transition-transform',
                    active && 'rotate-90'
                  )}
                />
              </div>
              <span className="block text-sm leading-7 text-ink-400">{VERDICT_HINT[code]}</span>
              {active && (
                <span className="block border-t border-stage-700/50 pt-3 text-[15px] leading-8 text-ink-200">
                  <Emphasised text={plain[code]} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */

/** 第 1 集真的查到的三件事。 */
function Findings() {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle icon="🕳️">它在第 1 集真的查到 {REAL_HOLES.length} 件事</SectionTitle>

      <p className="text-[15px] leading-8 text-ink-400">
        下面是{' '}
        <strong className="font-medium text-ink-200">{DEMO_SOURCE.episode}</strong> 在{' '}
        {DEMO_SOURCE.when} 跑出來的，共 {DEMO_SOURCE.doubtCount} 條疑問，其中這 {REAL_HOLES.length} 條被判成
        「真正漏洞」。每一條都點得開。
      </p>

      <ul className="flex flex-col gap-2.5">
        {REAL_HOLES.map((finding, index) => (
          <li key={finding.question}>
            <FindingCard finding={finding} index={index} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function FindingCard({ finding, index }: { finding: Finding; index: number }) {
  return (
    <details className="group panel rounded-3xl bg-stage-900 ring-1 ring-stage-700 transition-all open:bg-stage-850 open:ring-rose-900/40">
      <summary className="tap flex cursor-pointer list-none items-start gap-3.5 p-5 sm:p-6">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-2xl bg-rose-500/15 text-sm font-semibold text-rose-300 tabular-nums"
        >
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 text-[17px] leading-8 text-ink-50">
          {finding.question}
        </span>
        <ChevronRight
          aria-hidden
          className="mt-1.5 size-5 shrink-0 text-ink-600 transition-transform group-open:rotate-90"
        />
      </summary>

      <div className="flex flex-col gap-4 border-t border-stage-700/60 p-5 sm:p-6">
        <Row label="哪一句">
          <p className="flex gap-2.5 rounded-xl bg-stage-950/50 p-3.5">
            <QuoteIcon aria-hidden className="mt-1.5 size-4 shrink-0 text-accent-500/70" />
            <span className="min-w-0 text-[15px] leading-8 text-ink-200">{finding.quote}</span>
          </p>
        </Row>

        <Row label="觀眾卡在哪">
          <p className="text-[15px] leading-8 text-ink-300">{finding.why}</p>
        </Row>

        <Row label="為什麼算漏洞">
          <p className="text-[15px] leading-8 text-ink-300">{finding.because}</p>
        </Row>

        <Row label="怎麼改">
          <p className="rounded-xl bg-emerald-950/25 p-3.5 text-[15px] leading-8 text-emerald-100 ring-1 ring-emerald-900/40">
            {finding.fix}
          </p>
        </Row>
      </div>
    </details>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-500">{label}</span>
      {children}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Footnotes() {
  return (
    <section className="panel flex flex-col gap-3 rounded-3xl bg-stage-900 p-6 ring-1 ring-stage-700">
      <SectionTitle icon="💡">兩件要先知道的事</SectionTitle>

      <ul className="flex flex-col gap-3">
        <li className="flex gap-3 text-[15px] leading-8 text-ink-300">
          <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent-400" />
          <span>
            <strong className="font-medium text-ink-100">每次跑結果會不一樣。</strong>
            它不是查字典，是在讀你的故事——同一集跑兩次，問出來的疑點可能不完全相同。
            覺得哪一次說得比較準，就把那一份「存起來」。
          </span>
        </li>
        <li className="flex gap-3 text-[15px] leading-8 text-ink-300">
          <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-gilt-400" />
          <span>
            <strong className="font-medium text-ink-100">每跑一次都要錢。</strong>
            整理一集大概幾塊台幣，算在「成本中心」的 AI 那一欄。重跑是新的一次花費，
            所以跑出滿意的就存起來，不用一直重跑。
          </span>
        </li>
      </ul>
    </section>
  )
}

/* -------------------------------------------------------------------------- */

function SectionTitle({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <h3 className="inline-flex items-center gap-2.5 text-lg font-semibold text-ink-50">
      <span aria-hidden className="text-xl">
        {icon}
      </span>
      {children}
    </h3>
  )
}

/**
 * 文字裡用 `**` 框起來的那一段要變粗，其餘照原樣。
 *
 * 這一頁的說明文字是寫在原始碼裡的常數，不是模型產出的 Markdown，所以不需要
 * 一個 Markdown 解析器——需要的只有「這幾個字要重」。**但星號絕對不能留在畫面
 * 上**：老闆看不懂那是什麼，而那正是他退過的東西。
 *
 * 用 `split('**')` 而不是正規表示式：奇數段就是被框起來的那一段，偶數段是外
 * 面的文字。落單的星號只會讓最後一段不變粗，不會有東西消失，也不會丟例外。
 */
function Emphasised({ text }: { text: string }) {
  return (
    <>
      {text.split('**').map((part, index) =>
        index % 2 === 1 ? (
          <strong key={index} className="font-semibold text-ink-50">
            {part}
          </strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      )}
    </>
  )
}
