'use client'

import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  FileUp,
  Plus,
  Trash2,
} from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { AiTaskLauncher } from '@/components/studio/AiTaskLauncher'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { applyTargetFor } from '@/lib/ai/apply-targets'
import { ImportDialog } from '@/components/studio/ImportDialog'
import { ReferenceImages } from '@/components/studio/ReferenceImages'
import { VocabularySelect } from '@/components/ui/VocabularySelect'
import { vocabularyTermLabel, type VocabularyTerm } from '@/lib/vocabulary-view'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import type { ShotReference } from '@/lib/storyboard-view'
/*
 * 景別與運鏡的清單不從這裡來了 (Z184)：它們可以有使用者自己加的值，所以選項
 * 由 `vocabularyOptions` 算（內建 ∪ 自訂），標籤由 `vocabularyTermLabel` 查。
 * 鏡頭狀態還是列舉——它有程式分支讀它的值。
 */
import {
  SHOT_STATUSES,
  SHOT_STATUS_LABEL,
  SHOT_STATUS_STYLE,
  type ShotStatusValue,
} from '@/lib/constants'
import type { CurrencyValue, FxRates } from '@/lib/money'
import { formatSeconds, type DurationCheck } from '@/lib/storyboard-view'
import { cn } from '@/lib/utils'

/**
 * 分鏡工作台 (Z39/Z40/Z71, designs 12–13 + 66–68).
 *
 * `shots` 這張表一筆資料都沒有，也沒有任何地方碰過它——所以這不是做一個檢
 * 視，是做出功能。
 *
 * ## 不是影片剪輯器
 *
 * spec 12：「不是影片剪輯器；鏡頭時長須校驗」。所以沒有軌道、沒有轉場、沒有
 * 拖拉時間軸。上面那條彩色長條是**比例圖**不是時間軸編輯器：它回答「哪幾個
 * 鏡頭吃掉了大部分的秒數」，點一下跳到那個鏡頭，如此而已。
 *
 * 真正重要的是那個總長校驗。短劇一集 120–180 秒，而一張不校驗總長的鏡頭表
 * 會在剪接的時候才發現多了四十秒——那時候要砍的是已經花錢生好的圖。
 *
 * ## 狀態放在網址裡
 *
 * 哪一集、哪一個鏡頭都在 query string（`docs/ROUTES.md` §4）：深連結、重新
 * 整理、兩個分頁各看一集，三件事都要成立。
 *
 * ## 不做拖拉排序
 *
 * 上下箭頭。拖拉要處理整批 `order` 重排，而 `unique(episode_id, order)` 讓每
 * 一次重排都是一次可能的衝突——換到的只是一個手勢。
 */

export type ShotItem = {
  id: string
  order: number
  sceneCode: string
  durationSec: number
  shotSize: string
  camera: string
  location: string
  timeOfDay: string
  action: string
  dialogue: string
  speakerId: string | null
  speakerName: string | null
  prompt: string
  negativePrompt: string
  status: ShotStatusValue
  notes: string
  /** 人上傳的參考圖 (Z183)。 */
  references: ShotReference[]
}

export type StoryboardEpisodeOption = {
  id: string
  number: number
  title: string
  shotCount: number
  totalSec: number
  targetSec: number
}

export function StoryboardWorkbench({
  projectId,
  episodes,
  episode,
  shots,
  duration,
  cast,
  hasScript,
  canWrite,
  currency,
  fx,
  providerReady,
  providerDetail,
  selectedShotId,
  terms,
}: {
  projectId: string
  episodes: StoryboardEpisodeOption[]
  episode: { id: string; number: number; title: string; targetSec: number }
  shots: ShotItem[]
  duration: DurationCheck
  cast: { id: string; name: string }[]
  hasScript: boolean
  canWrite: boolean
  currency: CurrencyValue
  fx: FxRates
  providerReady: boolean
  providerDetail?: string
  selectedShotId: string | null
  /**
   * 使用者自己加的景別與運鏡 (Z184)。
   *
   * 從頁面傳下來而不是在元件裡 fetch：它一頁只需要一次，而且在伺服器端查完
   * 之後，第一次畫出來的下拉就是完整的——用 effect 去拿的話，開頁的第一格會
   * 少掉自訂的那幾個，而剛好在那一格選一個值的人會選到別的東西。
   */
  terms: VocabularyTerm[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const toast = useToast()

  const [busy, setBusy] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ShotItem | null>(null)
  const [importing, setImporting] = useState(false)

  const selected = shots.find((shot) => shot.id === selectedShotId) ?? shots[0] ?? null

  function go(next: Record<string, string | null>) {
    const search = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value === null) search.delete(key)
      else search.set(key, value)
    }
    router.replace(`${pathname}?${search.toString()}`)
  }

  async function addShot() {
    if (busy) return
    setBusy('new')
    try {
      const response = await apiFetch(`/api/projects/${projectId}/shots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          episodeId: episode.id,
          // 五秒是短劇一個鏡頭的常見長度，而留白會讓這一筆進不了驗證。
          durationSec: 5,
          sceneCode: shots.at(-1)?.sceneCode ?? '',
          location: shots.at(-1)?.location ?? '',
          timeOfDay: shots.at(-1)?.timeOfDay ?? '',
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const { shot } = (await response.json()) as { shot: { id: string } }
      router.refresh()
      go({ shot: shot.id })
    } catch (cause) {
      toast.error('加不進去', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function move(shot: ShotItem, direction: 'up' | 'down') {
    if (busy) return
    setBusy(shot.id)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/shots/${shot.id}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ direction }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      router.refresh()
    } catch (cause) {
      toast.error('挪不動', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function remove(shot: ShotItem) {
    setBusy(shot.id)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/shots/${shot.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('已刪除', `第 ${shot.order} 個鏡頭，後面的序號已往前遞補。`)
      setRemoving(null)
      if (selected?.id === shot.id) go({ shot: null })
      router.refresh()
    } catch (cause) {
      toast.error('刪不掉', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Clapperboard aria-hidden className="size-4 text-accent-400" />
          分鏡工作台
        </h2>

        <Select
          value={episode.id}
          onChange={(event) => go({ ep: event.target.value, shot: null })}
          aria-label="選擇集數"
          className="h-8 w-auto text-[11px]"
          options={episodes.map((option) => ({
            value: option.id,
            label:
              `EP${String(option.number).padStart(3, '0')}` +
              (option.title ? `・${option.title}` : '') +
              `（${option.shotCount} 鏡）`,
          }))}
        />

        <span className="text-[11px] text-ink-500">
          不是影片剪輯器——這裡規劃鏡頭與校驗總長
        </span>

        {canWrite && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <AiTaskLauncher
              label="AI 生成分鏡"
              title="AI 依劇本生成分鏡"
              description="讀這一集的劇本，產出鏡頭表。採用後會接在現有鏡頭後面，不會覆蓋。"
              projectId={projectId}
              episodeId={episode.id}
              /*
               * 採用要真的寫進去 (Z71)。沒有 targetType 的話，`applyCandidate`
               * 找不到目標，採用只會把任務標成已採用、一個鏡頭都沒建。
               */
              targetType={applyTargetFor('STORYBOARD_GENERATE')}
              scopeLabel={`第 ${episode.number} 集，目標片長 ${episode.targetSec || '未設定'} 秒`}
              currency={currency}
              fx={fx}
              providerReady={providerReady}
              {...(providerDetail ? { providerDetail } : {})}
              {...(hasScript
                ? {}
                : { disabledReason: '這一集還沒有劇本，沒有東西可以據以分鏡。' })}
              tasks={[
                {
                  kind: 'STORYBOARD_GENERATE',
                  label: 'AI 分鏡生成',
                  hint: '依劇本產生鏡頭表：場次、秒數、景別、運鏡、畫面、台詞與生圖提示詞。',
                },
              ]}
            />

            {/*
              匯入 (Z185)。放在「新增鏡頭」旁邊而不是藏進選單：一次把一集的
              鏡頭表貼進來，比按二十次「新增鏡頭」合理太多。
            */}
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<FileUp aria-hidden className="size-3.5" />}
              onClick={() => setImporting(true)}
            >
              匯入
            </Button>
            <Button
              size="sm"
              variant="primary"
              leadingIcon={<Plus aria-hidden className="size-3.5" />}
              onClick={() => void addShot()}
              loading={busy === 'new'}
            >
              新增鏡頭
            </Button>
          </div>
        )}
      </header>

      {importing && (
        <ImportDialog
          projectId={projectId}
          episodes={episodes.map((item) => ({
            id: item.id,
            number: item.number,
            title: item.title,
          }))}
          defaultTarget="shots"
          defaultEpisodeId={episode.id}
          onClose={() => setImporting(false)}
        />
      )}

      <DurationBar
        duration={duration}
        shots={shots}
        terms={terms}
        selectedId={selected?.id ?? null}
        onPick={(id) => go({ shot: id })}
      />

      {shots.length === 0 ? (
        <EmptyState
          title="這一集還沒有任何鏡頭"
          description={
            hasScript
              ? '可以按「AI 生成分鏡」依劇本產一版，再逐個鏡頭修；也可以直接新增一個空鏡頭自己寫。'
              : '這一集還沒有劇本。先在「劇本工坊」寫出劇本，AI 分鏡才有東西可以依據——也可以直接新增空鏡頭自己寫。'
          }
          icon={<Clapperboard aria-hidden className="size-5 text-ink-500" />}
          className="py-20"
        />
      ) : (
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <ul className="flex min-w-0 flex-col gap-1.5">
            {shots.map((shot) => (
              <li key={shot.id}>
                <ShotCard
                  shot={shot}
                  active={selected?.id === shot.id}
                  canWrite={canWrite}
                  terms={terms}
                  busy={busy === shot.id}
                  first={shot.order === shots[0]?.order}
                  last={shot.order === shots.at(-1)?.order}
                  onPick={() => go({ shot: shot.id })}
                  onMove={(direction) => void move(shot, direction)}
                  onRemove={() => setRemoving(shot)}
                />
              </li>
            ))}
          </ul>

          {selected && (
            <ShotDetail
              key={selected.id}
              projectId={projectId}
              episodeId={episode.id}
              shot={selected}
              cast={cast}
              canWrite={canWrite}
              terms={terms}
            />
          )}
        </div>
      )}

      {removing && (
        <ConfirmDialog
          open
          title={`刪除第 ${removing.order} 個鏡頭？`}
          message="鏡頭沒有版本快照，刪掉就真的沒了。後面的鏡頭序號會往前遞補。"
          confirmLabel="刪除"
          tone="danger"
          busy={busy === removing.id}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove(removing)}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * 總長校驗加上比例圖。
 *
 * 這是 spec 12 唯一寫明的實作提醒（「鏡頭時長須校驗」），所以它在最上面、
 * 用顏色講話，而且把容許範圍寫出來——一個只說「超過了」卻不說超過多少、
 * 容許多少的警告，沒有人知道該不該理它。
 */
function DurationBar({
  duration,
  shots,
  selectedId,
  onPick,
  terms,
}: {
  duration: DurationCheck
  shots: ShotItem[]
  selectedId: string | null
  onPick: (id: string) => void
  terms: VocabularyTerm[]
}) {
  const tone =
    duration.verdict === 'OK'
      ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
      : duration.verdict === 'NO_TARGET'
        ? 'bg-stage-850/60 text-ink-400 ring-stage-700/70'
        : 'bg-amber-500/10 text-amber-300 ring-amber-500/30'

  return (
    <div className="flex flex-col gap-2">
      <p
        className={cn(
          'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-[11px] leading-relaxed ring-1 ring-inset',
          tone
        )}
      >
        {duration.verdict !== 'OK' && duration.verdict !== 'NO_TARGET' && (
          <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
        )}

        <span>
          {shots.length} 個鏡頭，共 <strong>{formatSeconds(duration.totalSec)}</strong>
          （{duration.totalSec} 秒）
        </span>

        {duration.verdict === 'NO_TARGET' ? (
          <span className="text-ink-500">
            這一集還沒有設定目標片長，所以沒有東西可以對照——在「集數管理」設定後這裡才會校驗。
          </span>
        ) : (
          <>
            <span>
              目標 {duration.targetSec} 秒，容許 {duration.lowSec}–{duration.highSec} 秒
            </span>
            {duration.verdict === 'LONG' && <span>超出 {duration.deltaSec} 秒</span>}
            {duration.verdict === 'SHORT' && <span>還差 {-duration.deltaSec} 秒</span>}
            {duration.verdict === 'OK' && <span>在範圍內</span>}
          </>
        )}
      </p>

      {shots.length > 0 && (
        <div className="flex h-5 w-full overflow-hidden rounded-md ring-1 ring-inset ring-stage-700">
          {shots.map((shot) => (
            <button
              key={shot.id}
              type="button"
              onClick={() => onPick(shot.id)}
              title={`第 ${shot.order} 鏡・${shot.durationSec} 秒・${vocabularyTermLabel('shot_size', shot.shotSize, terms)}`}
              aria-label={`跳到第 ${shot.order} 個鏡頭`}
              style={{
                // 比例用 flex-grow，不用百分比寬度：加起來永遠剛好填滿，不會
                // 因為四捨五入在右邊留一條縫。
                flexGrow: shot.durationSec,
                flexBasis: 0,
              }}
              className={cn(
                'min-w-[3px] border-r border-stage-900/60 transition-opacity last:border-r-0 hover:opacity-100',
                shot.status === 'APPROVED'
                  ? 'bg-emerald-600'
                  : shot.status === 'RETAKE'
                    ? 'bg-rose-600'
                    : shot.status === 'TODO'
                      ? 'bg-stage-700'
                      : 'bg-accent-600',
                selectedId === shot.id ? 'opacity-100' : 'opacity-60'
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ShotCard({
  shot,
  active,
  canWrite,
  busy,
  first,
  last,
  onPick,
  onMove,
  onRemove,
  terms,
}: {
  shot: ShotItem
  terms: VocabularyTerm[]
  active: boolean
  canWrite: boolean
  busy: boolean
  first: boolean
  last: boolean
  onPick: () => void
  onMove: (direction: 'up' | 'down') => void
  onRemove: () => void
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 gap-2 rounded-lg bg-stage-900 p-2.5 ring-1 transition-colors',
        active ? 'ring-accent-500/50' : 'ring-stage-700/60 hover:ring-stage-600'
      )}
    >
      <button
        type="button"
        onClick={onPick}
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[11px] text-ink-300">#{shot.order}</span>
          {shot.sceneCode && (
            <span className="font-mono text-[10px] text-ink-600">{shot.sceneCode}</span>
          )}
          <span className="text-[10px] tabular-nums text-ink-400">{shot.durationSec}s</span>
          <span className="text-[10px] text-ink-500">
            {vocabularyTermLabel('shot_size', shot.shotSize, terms)}
          </span>
          <span className="text-[10px] text-ink-600">
            {vocabularyTermLabel('camera_move', shot.camera, terms)}
          </span>
          <span
            className={cn(
              'rounded px-1 py-0.5 text-[9px] ring-1 ring-inset',
              SHOT_STATUS_STYLE[shot.status]
            )}
          >
            {SHOT_STATUS_LABEL[shot.status]}
          </span>
        </span>

        {shot.action ? (
          <span className="line-clamp-2 text-[11px] leading-relaxed text-ink-200">
            {shot.action}
          </span>
        ) : (
          <span className="text-[11px] text-ink-700">還沒有畫面描述</span>
        )}

        {shot.dialogue && (
          <span className="line-clamp-1 text-[10px] text-ink-500">
            {shot.speakerName ? `${shot.speakerName}：` : ''}
            {shot.dialogue}
          </span>
        )}
      </button>

      {canWrite && (
        <div className="flex shrink-0 flex-col gap-0.5">
          <button
            type="button"
            onClick={() => onMove('up')}
            disabled={first || busy}
            aria-label="往前挪一格"
            className="tap rounded p-0.5 text-ink-600 transition-colors hover:bg-stage-800 hover:text-ink-200 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronUp aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove('down')}
            disabled={last || busy}
            aria-label="往後挪一格"
            className="tap rounded p-0.5 text-ink-600 transition-colors hover:bg-stage-800 hover:text-ink-200 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronDown aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label="刪除這個鏡頭"
            className="tap rounded p-0.5 text-ink-700 transition-colors hover:bg-rose-950 hover:text-rose-300 disabled:opacity-30"
          >
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 鏡頭詳情 (design 13).
 *
 * 一個表單，一顆「儲存」。不做自動儲存：這裡有十個欄位，自動儲存等於每打一
 * 個字送一次 PATCH，而每一次 PATCH 都會把 `version` 加一、寫一筆動態紀錄。
 *
 * 首尾幀與候選圖那一段還沒有——圖片生成供應商還沒接（spec 13：「圖片與影片
 * 生成供應商按實際 API 能力開放」）。所以那一區塊寫明還沒有，不放空按鈕。
 */
function ShotDetail({
  projectId,
  episodeId,
  shot,
  cast,
  canWrite,
  terms,
}: {
  projectId: string
  episodeId: string
  shot: ShotItem
  cast: { id: string; name: string }[]
  canWrite: boolean
  terms: VocabularyTerm[]
}) {
  const router = useRouter()
  const toast = useToast()

  const [form, setForm] = useState({
    sceneCode: shot.sceneCode,
    durationSec: String(shot.durationSec),
    shotSize: shot.shotSize,
    camera: shot.camera,
    location: shot.location,
    timeOfDay: shot.timeOfDay,
    action: shot.action,
    dialogue: shot.dialogue,
    speakerId: shot.speakerId ?? '',
    prompt: shot.prompt,
    negativePrompt: shot.negativePrompt,
    status: shot.status,
    notes: shot.notes,
  })
  const [saving, setSaving] = useState(false)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    if (saving) return

    const durationSec = Number(form.durationSec)
    if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > 120) {
      toast.error('秒數不對', '鏡頭長度要是 1 到 120 之間的整數。')
      return
    }

    setSaving(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/shots/${shot.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sceneCode: form.sceneCode,
          durationSec,
          shotSize: form.shotSize,
          camera: form.camera,
          location: form.location,
          timeOfDay: form.timeOfDay,
          action: form.action,
          dialogue: form.dialogue,
          speakerId: form.speakerId || null,
          prompt: form.prompt,
          negativePrompt: form.negativePrompt,
          status: form.status,
          notes: form.notes,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('已儲存', `第 ${shot.order} 個鏡頭`)
      router.refresh()
    } catch (cause) {
      toast.error('存不起來', cause instanceof Error ? cause.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl bg-stage-900 p-3 ring-1 ring-stage-700/60">
      <header className="flex items-baseline gap-2">
        <h3 className="text-xs font-semibold text-ink-100">第 {shot.order} 個鏡頭</h3>
        <span className="text-[10px] text-ink-600">鏡頭詳情</span>
      </header>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="場次">
          <Input
            value={form.sceneCode}
            maxLength={20}
            placeholder="S03"
            disabled={!canWrite}
            onChange={(event) => set('sceneCode', event.target.value)}
          />
        </Field>
        <Field label="秒數" description="1–120 秒。這一欄進總長校驗。">
          <Input
            type="number"
            min={1}
            max={120}
            value={form.durationSec}
            disabled={!canWrite}
            onChange={(event) => set('durationSec', event.target.value)}
          />
        </Field>
        <Field label="景別">
          {/*
            清單裡沒有的可以自己加 (Z184)。景別與運鏡是純標籤，沒有任何程式
            分支讀它們的值——而那正是一個下拉能不能開放自訂的唯一條件。
          */}
          <VocabularySelect
            kind="shot_size"
            terms={terms}
            value={form.shotSize}
            disabled={!canWrite}
            canManage={canWrite}
            onChange={(next) => set('shotSize', next)}
          />
        </Field>
        <Field label="運鏡">
          <VocabularySelect
            kind="camera_move"
            terms={terms}
            value={form.camera}
            disabled={!canWrite}
            canManage={canWrite}
            onChange={(next) => set('camera', next)}
          />
        </Field>
        <Field label="地點">
          <Input
            value={form.location}
            maxLength={120}
            disabled={!canWrite}
            onChange={(event) => set('location', event.target.value)}
          />
        </Field>
        <Field label="時間">
          <Input
            value={form.timeOfDay}
            maxLength={40}
            placeholder="日 / 夜 / 黃昏"
            disabled={!canWrite}
            onChange={(event) => set('timeOfDay', event.target.value)}
          />
        </Field>
      </div>

      <Field label="畫面描述">
        <Textarea
          value={form.action}
          rows={3}
          maxLength={3000}
          disabled={!canWrite}
          onChange={(event) => set('action', event.target.value)}
        />
      </Field>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="台詞 / 旁白">
          <Textarea
            value={form.dialogue}
            rows={2}
            maxLength={3000}
            disabled={!canWrite}
            onChange={(event) => set('dialogue', event.target.value)}
          />
        </Field>
        <Field label="誰說的" description={cast.length === 0 ? '這部作品還沒有角色。' : undefined}>
          <Select
            value={form.speakerId}
            disabled={!canWrite || cast.length === 0}
            onChange={(event) => set('speakerId', event.target.value)}
            options={[
              { value: '', label: '沒有指定' },
              ...cast.map((member) => ({ value: member.id, label: member.name })),
            ]}
          />
        </Field>
      </div>

      <Field label="生圖提示詞" description="拿去生圖工具用的正向提示詞。">
        <Textarea
          value={form.prompt}
          rows={3}
          maxLength={4000}
          disabled={!canWrite}
          onChange={(event) => set('prompt', event.target.value)}
        />
      </Field>

      <Field label="負面提示詞">
        <Textarea
          value={form.negativePrompt}
          rows={2}
          maxLength={2000}
          disabled={!canWrite}
          onChange={(event) => set('negativePrompt', event.target.value)}
        />
      </Field>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="狀態">
          <Select
            value={form.status}
            disabled={!canWrite}
            onChange={(event) => set('status', event.target.value as ShotStatusValue)}
            options={SHOT_STATUSES.map((value) => ({
              value,
              label: SHOT_STATUS_LABEL[value],
            }))}
          />
        </Field>
        <Field label="備註">
          <Input
            value={form.notes}
            maxLength={2000}
            disabled={!canWrite}
            onChange={(event) => set('notes', event.target.value)}
          />
        </Field>
      </div>

      {/*
        參考圖是人上傳的，所以它不用等圖片 adapter (Z183)。
      */}
      <ReferenceImages
        projectId={projectId}
        episodeId={episodeId}
        shotId={shot.id}
        items={shot.references}
        canWrite={canWrite}
      />

      {/*
        首尾幀與候選圖：spec 13 要求這一區，但圖片**生成**供應商還沒接，
        `adapterFor()` 對 IMAGE 類一律回 null。所以照實說，不放空按鈕
        （spec v2 §4）。上面那一區是人手上已經有的圖，兩件事不一樣。
      */}
      <p className="rounded-lg bg-stage-850/60 px-3 py-2 text-[10px] leading-relaxed text-ink-600 ring-1 ring-inset ring-stage-700/70">
        首尾幀、候選圖與版本比較還沒有做：圖片<strong className="font-semibold text-ink-400">生成</strong>
        供應商尚未接上，所以這裡只先存提示詞與上面那些參考圖。
      </p>

      {canWrite && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="primary"
            onClick={() => void save()}
            loading={saving}
            loadingText="儲存中…"
          >
            儲存這個鏡頭
          </Button>
        </div>
      )}
    </section>
  )
}
