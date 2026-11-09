import { ArrowRight, BookOpen, CircleHelp, FileUp, Printer, Sparkles } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { RAIL_HELP, TAB_HELP } from '@/lib/help'

export const metadata: Metadata = { title: '使用說明' }

/**
 * 使用說明 (Z189).
 *
 * ## 寫給沒碰過這類工具的人
 *
 * 這一頁的讀者不是工程師，也不是用過三套製作管理軟體的人——是**第一次打開它
 * 的人**。所以三條規矩：一句話講一件事；專有名詞第一次出現就用白話解釋，而
 * 不是放一個連結；先講「要做什麼」再講「為什麼」。
 *
 * ## 為什麼不是一堆連結
 *
 * 「說明中心」最常見的壞法是變成一張目錄：每一條都連到別的地方，而讀的人點
 * 了三層還沒看到答案。這一頁把會用到的東西**直接寫在上面**，長一點沒關係
 * ——Ctrl+F 找得到的長文件，比點三層的目錄好用。
 *
 * 只有匯入那一節太長才獨立出去（`/help/import`），因為它有八張欄位表。
 */
export default async function HelpPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <div className="flex flex-col gap-6 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-col gap-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <CircleHelp aria-hidden className="size-4 text-accent-400" />
          使用說明
        </h2>
        <p className="text-[11px] text-ink-500">
          這個工具是用來把一個故事做成短劇的。從寫小說開始，到最後出片。
        </p>
      </header>

      {/*
        編劇助手那一頁獨立出去（Z202）：它有一個需要互動才講得清楚的概念，攤平
        成文字就失去意義了。這裡放一張看得見的卡，不是藏在內文裡的連結。
      */}
      <Link
        href="/help/writer"
        className="panel group flex items-center gap-3.5 rounded-2xl bg-stage-900 p-4 ring-1 ring-stage-700 transition-all hover:-translate-y-0.5 hover:ring-accent-500/40"
      >
        <span
          aria-hidden
          className="bg-brand-gradient grid size-11 shrink-0 place-items-center rounded-2xl text-xl"
        >
          🎬
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold text-ink-50">編劇助手怎麼用</span>
          <span className="text-xs text-ink-500">
            它會自己讀完你的小說，告訴你爽點在哪、哪裡會卡住。附第 1 集真的查到的三件事。
          </span>
        </span>
        <ArrowRight
          aria-hidden
          className="size-4 shrink-0 text-ink-600 transition-transform group-hover:translate-x-0.5"
        />
      </Link>

      <Section title="第一次用，照這個順序">
        <ol className="flex flex-col gap-2">
          {[
            ['建一部戲', '在「作品列表」按新增。填名字就好，其他之後再補。'],
            ['建集數', '進到那部戲 →「集數管理」。一次可以建很多集。'],
            ['寫大綱', '「小說編輯」裡有分集大綱。先寫一句話，之後再長。'],
            ['寫小說', '點某一集開始寫。寫好的稿子也可以直接匯入。'],
            ['改成劇本', '「劇本工坊」。可以叫 AI 先轉一版，再自己改。'],
            ['排分鏡', '「分鏡工作台」。一集要拍哪些鏡頭、每個幾秒。'],
            ['配音', '「看小說 → 有聲」。先判對白是誰說的，再合成。'],
          ].map(([step, detail], index) => (
            <li key={step} className="flex gap-3">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-600/20 text-[10px] text-accent-200">
                {index + 1}
              </span>
              <span className="text-xs text-ink-200">
                <strong className="font-medium text-ink-50">{step}</strong>
                <span className="mx-1.5 text-ink-700">·</span>
                <span className="text-ink-400">{detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="左邊那排是什麼">
        <p className="mb-2 text-[11px] text-ink-500">
          左邊這一排是<strong className="text-ink-300">跨作品</strong>的東西——不管你在做哪一部戲，它們都在。
          某一部戲專用的功能，要先點進那部戲才看得到。
        </p>
        <TwoColumn items={RAIL_HELP} />
      </Section>

      <Section title="點進一部戲之後，上面那排分頁">
        <TwoColumn items={TAB_HELP} />
      </Section>

      <Section title="匯入：把寫好的東西一次倒進來" icon={<FileUp aria-hidden className="size-3.5" />}>
        <p className="text-xs leading-relaxed text-ink-300">
          不用一格一格打。你可以把資料整理成一個檔案，直接丟進來——
          <strong className="text-ink-100">而且可以請 ChatGPT 幫你整理成那個格式</strong>。
        </p>
        <p className="mt-2 text-xs leading-relaxed text-ink-400">
          舉個例：你想一次建好一集的三十個鏡頭。做法是請 ChatGPT 照著我們的欄位產一份
          表格，存成檔案，然後在「分鏡工作台」按「匯入」把檔案丟進去。它會先讓你看一遍
          對不對，確認了才寫進去。
        </p>
        <Link
          href="/help/import"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-stage-800 px-3 py-1.5 text-[11px] text-ink-200 transition-colors hover:bg-stage-700"
        >
          怎麼匯入、每一欄要填什麼
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      </Section>

      <Section title="匯出與列印" icon={<Printer aria-hidden className="size-3.5" />}>
        <Bullets
          items={[
            ['想拿給別人看', '在匯入視窗的下面有「匯出現況」，選區塊跟格式就會下載。'],
            [
              '想印出來或存成 PDF',
              '同一排最後一顆是 PDF，它會開一頁乾淨的版面。在列印視窗裡選「另存為 PDF」。',
            ],
            [
              '繁體簡體可以轉',
              '匯出時可以選原文、繁體或简体。要改完再匯回來的話選「原文」——轉過的字再匯回來，資料庫裡就會變成轉過的樣子，而簡轉繁是轉不回去的。',
            ],
          ]}
        />
      </Section>

      <Section title="AI 幫你做事" icon={<Sparkles aria-hidden className="size-3.5" />}>
        <Bullets
          items={[
            [
              'AI 不會直接改你的東西',
              '它產出來的結果會停在「待確認」。你看過、按採用，才會寫進去。',
            ],
            [
              '按下去之前會先告訴你大概多少錢',
              '每一個 AI 功能旁邊都有「估算成本」。',
            ],
            [
              '跑完去哪裡看',
              '左邊的「AI 製片中心」。那裡列出跑過哪些、哪些在等你確認。',
            ],
            [
              '要先設金鑰',
              '「系統設定」裡設 AI 供應商。沒設的話那些按鈕會告訴你還差什麼。',
            ],
          ]}
        />
      </Section>

      <Section title="繁體還是簡體" icon={<BookOpen aria-hidden className="size-3.5" />}>
        <p className="text-xs leading-relaxed text-ink-300">
          原稿是<strong className="text-ink-100">簡體</strong>寫的。畫面右上角可以切成繁體——
          那只是<strong className="text-ink-100">看起來</strong>變了，存進資料庫的一個字都沒有動。
        </p>
        <p className="mt-2 text-xs leading-relaxed text-ink-400">
          搜尋也不分繁簡：你打「頭髮」找得到「头发」，反過來也可以。
        </p>
      </Section>

      <Section title="出事了怎麼辦">
        <Bullets
          items={[
            ['不小心刪掉了', '大部分東西是「假刪除」，還在資料庫裡。跟我說要救哪一個。'],
            [
              '改壞了想退回去',
              '「版本紀錄」那一頁有每一次存檔的快照，可以看差異也可以還原。',
            ],
            [
              '匯入匯錯了',
              '匯入只會新增，不會蓋掉既有的（集數大綱是唯一例外，它會更新同一集）。匯錯的話把新增的那些刪掉就好。',
            ],
            ['畫面卡住或怪怪的', '先重新整理。還是怪的話截圖跟我說，順便講一下你剛做了什麼。'],
          ]}
        />
      </Section>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="panel rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
      <h3 className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-100">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function TwoColumn({ items }: { items: { label: string; what: string }[] }) {
  return (
    <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.label} className="flex gap-2 text-xs">
          <span className="w-24 shrink-0 text-ink-200">{item.label}</span>
          <span className="min-w-0 flex-1 text-ink-500">{item.what}</span>
        </li>
      ))}
    </ul>
  )
}

function Bullets({ items }: { items: (readonly [string, string])[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map(([label, detail]) => (
        <li key={label} className="text-xs leading-relaxed">
          <strong className="font-medium text-ink-100">{label}</strong>
          <span className="mx-1.5 text-ink-700">·</span>
          <span className="text-ink-400">{detail}</span>
        </li>
      ))}
    </ul>
  )
}
