import { ArrowLeft, Check, Download, X } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { helpSections } from '@/lib/help'

export const metadata: Metadata = { title: '怎麼匯入' }

/**
 * 匯入說明的**人話版** (Z189).
 *
 * `docs/import/` 那一份是寫給模型讀的——它講得精確，而精確的寫法對人來說常常
 * 是難讀的。這一頁講同一件事，但假設讀的人沒碰過「欄位對應」「編碼」這些詞。
 *
 * 欄位表是從 `IMPORT_TARGETS` 算出來的，跟那份給模型的規格是**同一個來
 * 源**。所以兩邊不會說不一樣的話——而「說明跟實際不一樣」是這種文件最常見也
 * 最傷的壞法。
 */
export default async function ImportHelpPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const sections = helpSections()

  return (
    <div className="flex flex-col gap-5 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-col gap-1">
        <Link
          href="/help"
          className="inline-flex w-fit items-center gap-1 text-[11px] text-ink-500 transition-colors hover:text-ink-200"
        >
          <ArrowLeft aria-hidden className="size-3" />
          使用說明
        </Link>
        <h2 className="text-sm font-semibold text-ink-100">怎麼把資料一次倒進來</h2>
        <p className="text-[11px] text-ink-500">
          不用一格一格打。整理成一個檔案丟進來就好——而這個檔案可以請 ChatGPT 幫你產。
        </p>
      </header>

      <section className="panel rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
        <h3 className="mb-3 text-xs font-semibold text-ink-100">三步</h3>
        <ol className="flex flex-col gap-3">
          {[
            [
              '跟 ChatGPT 要一份檔案',
              '下面每一區都有「下載範本」。把範本跟說明一起貼給它，然後說你要什麼。例如：「照這個格式，幫我寫第一集的三十個鏡頭」。',
            ],
            [
              '存成檔案，照規矩取名',
              '檔名裡寫清楚這是什麼、第幾集。像 `分鏡-EP001.csv`。這樣一次丟二十個檔案，系統自己知道哪個是哪個。',
            ],
            [
              '丟進來，先看一眼再確認',
              '在那一頁按「匯入」，把檔案拖進去。它會先告訴你：每一欄對到什麼、哪幾列有問題。覺得對了才按匯入。',
            ],
          ].map(([step, detail], index) => (
            <li key={step} className="flex gap-3">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-600/20 text-[10px] text-accent-200">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-ink-50">{step}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-400">{detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
        <h3 className="mb-2 text-xs font-semibold text-ink-100">幾件不用擔心的事</h3>
        <ul className="flex flex-col gap-1.5 text-[11px] leading-relaxed text-ink-400">
          <li>
            <strong className="text-ink-200">欄位名稱不用一模一樣。</strong>{' '}
            寫「场次」「場次」「場次（必填）」「sceneCode」都認得。認不出來的那一欄，
            它會讓你自己從清單裡選。
          </li>
          <li>
            <strong className="text-ink-200">少幾欄沒關係。</strong>{' '}
            只填你有的，其他留空。多出來不認得的欄位會被忽略，不會亂塞。
          </li>
          <li>
            <strong className="text-ink-200">不會蓋掉你已經有的東西。</strong>{' '}
            匯入只會「加上去」。同名的角色、同名的世界觀條目會被跳過並告訴你。
            只有「集數大綱」例外——它會更新同一集的大綱，但不碰正文。
          </li>
          <li>
            <strong className="text-ink-200">繁體簡體都可以。</strong>{' '}
            欄位名稱、角色名、景別，寫哪一種都對得上。
          </li>
          <li>
            <strong className="text-ink-200">清單裡沒有的景別、運鏡會自動加。</strong>{' '}
            例如你寫「過肩」，它會變成一個新的選項。但「狀態」那種不會自動加——
            那些有程式在讀，多一個出來會讓看板算錯。
          </li>
        </ul>
      </section>

      <section className="panel rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
        <h3 className="mb-2 text-xs font-semibold text-ink-100">檔案可以是什麼</h3>
        <div className="grid gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-2">
          {[
            ['CSV', 'Excel 另存就有。最通用。'],
            ['Excel（.xlsx）', '直接丟 Excel 檔也可以。'],
            ['直接複製貼上', '在 Excel 或 Google 試算表選一塊複製，貼進匯入視窗的輸入框。'],
            ['JSON', 'ChatGPT 最常吐這個。'],
            ['Markdown 表格', 'ChatGPT 在聊天視窗裡回你的那種表格，整段複製就行。'],
            ['純文字 / TXT', '用逗號或 Tab 隔開都可以。'],
          ].map(([name, note]) => (
            <p key={name}>
              <span className="text-ink-200">{name}</span>
              <span className="mx-1.5 text-ink-700">·</span>
              <span className="text-ink-500">{note}</span>
            </p>
          ))}
        </div>

        <div className="mt-3 rounded-lg bg-stage-850/60 px-3 py-2 text-[11px] leading-relaxed text-ink-400">
          <p>
            <strong className="text-ink-200">如果開起來是一堆問號或亂碼：</strong>{' '}
            那是「編碼」的問題。中文版 Excel 存 CSV 的時候，預設用的不是最通用的那一種。
            最快的解法是在 Excel 另存時選
            <strong className="text-ink-100">「CSV UTF-8（逗號分隔）」</strong>。
          </p>
          <p className="mt-1">
            不過我們會先自己試著認出來，認出來的時候畫面上會跟你說一聲。
          </p>
        </div>
      </section>

      <section className="panel rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
        <h3 className="mb-2 text-xs font-semibold text-ink-100">檔名怎麼取</h3>
        <p className="mb-2 text-[11px] leading-relaxed text-ink-400">
          檔名裡寫清楚「這是什麼」跟「第幾集」，系統就不用問你。
          認不出來也沒關係，它會讓你自己選。
        </p>
        <pre className="overflow-x-auto rounded-lg bg-stage-950 px-3 py-2 text-[11px] leading-relaxed text-ink-300">
          {[
            '分鏡-EP001.csv        ← 第 1 集的鏡頭',
            '分鏡-EP001-S03.csv    ← 第 1 集，而且這一批都是 S03 場',
            '角色.json             ← 整部戲的角色',
            '小說-EP002.md         ← 第 2 集的小說',
            '集數大綱.csv          ← 全部集數的大綱',
          ].join('\n')}
        </pre>
        <p className="mt-2 text-[11px] text-ink-600">
          `EP001`、`ep1`、`第 1 集` 都認得。注意 `S01` 是「場次」不是集數。
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-ink-100">每一區要填什麼</h3>
        {sections.map((section) => (
          <div
            key={section.key}
            className="panel overflow-hidden rounded-xl bg-stage-900 ring-1 ring-stage-700"
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
              <h4 className="text-xs font-semibold text-ink-100">{section.title}</h4>
              <p className="min-w-0 flex-1 text-[11px] text-ink-500">{section.what}</p>
              <code className="rounded bg-stage-850 px-1.5 py-0.5 text-[10px] text-ink-400">
                {section.filename}
              </code>
              {section.needsEpisode && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">
                  要指定集數
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-ink-600">
                    <th className="px-4 py-1.5 font-normal">欄位</th>
                    <th className="px-2 py-1.5 font-normal">必填</th>
                    <th className="px-2 py-1.5 font-normal">要填什麼</th>
                    <th className="px-4 py-1.5 font-normal">例子</th>
                  </tr>
                </thead>
                <tbody>
                  {section.fields.map((field) => (
                    <tr key={field.label} className="border-t border-stage-800">
                      <td className="px-4 py-1.5 text-ink-200">{field.label}</td>
                      <td className="px-2 py-1.5">
                        {field.required ? (
                          <Check aria-label="必填" className="size-3 text-amber-300" />
                        ) : (
                          <X aria-label="可以空白" className="size-3 text-ink-700" />
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-ink-500">{field.hint}</td>
                      <td className="px-4 py-1.5 text-ink-600">{field.sample || '（可以空白）'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-t border-stage-700/60 px-4 py-2 text-[10px] text-ink-500">
              <Download aria-hidden className="size-3" />
              下載
              {(
                [
                  ['範本（CSV）', `/api/import/template?target=${section.key}&format=csv`],
                  ['範本（JSON）', `/api/import/template?target=${section.key}&format=json`],
                  ['給 ChatGPT 的說明', `/api/import/template?kind=guide&target=${section.key}`],
                ] as const
              ).map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  className="rounded bg-stage-850 px-1.5 py-0.5 ring-1 ring-stage-700 transition-colors hover:text-ink-100"
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
