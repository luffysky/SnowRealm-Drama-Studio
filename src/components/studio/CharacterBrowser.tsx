'use client'

import { Crown, Loader2, Network, Pencil, Plus, Search, Trash2, UserRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ImagePicker } from '@/components/studio/ImagePicker'
import { VoicePicker } from '@/components/studio/VoicePicker'
import { EmptyState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import {
  CHARACTER_TIER_LABEL,
  CHARACTER_TIERS,
  type CharacterTierValue,
} from '@/lib/constants'
import { cn, formatRelativeZh } from '@/lib/utils'
import { assetPreviewUrl } from '@/lib/asset-url'

/**
 * 角色資料庫 (designs 10, 11).
 *
 * Master and detail on one page, because the pair work through a cast by
 * comparing: who is a lead, who already has a locked look, who has no voice
 * yet. Opening a separate page per character would make that a dozen
 * round-trips.
 *
 * The fields are the ones later stages consume — `visualPrompt` keeps a face
 * consistent across 120 episodes, `voiceId` keeps the voice consistent — so
 * they are edited here rather than retyped into the storyboard each time.
 */

export type CharacterItem = {
  id: string
  name: string
  alias: string
  tier: CharacterTierValue
  age: string
  gender: string
  appearance: string
  personality: string
  background: string
  growth: string
  visualPrompt: string
  negativePrompt: string
  voiceProvider: string
  voiceId: string
  voiceStyle: string
  voiceNote: string
  keyVisualAssetId: string | null
  episodeCount: number
  novelEpisodeCount: number
  scriptEpisodeCount: number
  updatedAt: string
}

export type RelationshipItem = {
  id: string
  fromCharacterId: string
  toCharacterId: string
  fromName: string
  toName: string
  kind: string
  description: string
  sentiment: number
}

export type CharacterBrowserProps = {
  projectId: string
  characters: CharacterItem[]
  relationships: RelationshipItem[]
  countsByTier: Record<string, number>
  total: number
  /** `character.write`; checked on the server, repeated here for the controls. */
  canWrite: boolean
}

type DetailTab = 'profile' | 'appearance' | 'voice' | 'relations'

export function CharacterBrowser({
  projectId,
  characters,
  relationships,
  countsByTier,
  total,
  canWrite,
}: CharacterBrowserProps) {
  const router = useRouter()
  const toast = useToast()

  const [tier, setTier] = useState<CharacterTierValue | 'ALL'>('ALL')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(characters[0]?.id ?? null)
  const [tab, setTab] = useState<DetailTab>('profile')
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<CharacterItem | null>(null)
  const [busy, setBusy] = useState(false)

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return characters.filter((character) => {
      if (tier !== 'ALL' && character.tier !== tier) return false
      if (!term) return true
      return (
        character.name.toLowerCase().includes(term) ||
        character.alias.toLowerCase().includes(term) ||
        character.personality.toLowerCase().includes(term)
      )
    })
  }, [characters, tier, search])

  const selected = characters.find((c) => c.id === selectedId) ?? null

  const selectedRelations = useMemo(
    () =>
      selected
        ? relationships.filter(
            (r) => r.fromCharacterId === selected.id || r.toCharacterId === selected.id
          )
        : [],
    [relationships, selected]
  )

  async function remove(character: CharacterItem) {
    setBusy(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/characters/${character.id}`,
        { method: 'DELETE' }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('已移除', `「${character.name}」已從角色庫移除`)
      setRemoving(null)
      setSelectedId(null)
      router.refresh()
    } catch (error) {
      toast.error('移除失敗', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <UserRound aria-hidden className="size-4 text-accent-400" />
          角色資料庫
        </h2>
        <p className="text-[11px] text-ink-500">
          共 {total} 位角色
          {CHARACTER_TIERS.map(
            (t) => `・${CHARACTER_TIER_LABEL[t]} ${countsByTier[t] ?? 0}`
          ).join('')}
        </p>

        <button
          type="button"
          onClick={() => setCreating(true)}
          className="bg-brand-gradient glow-accent-sm ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          <Plus aria-hidden className="size-3.5" />
          新增角色
        </button>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        {/* ---- cast list --------------------------------------------------- */}
        <section className="panel flex flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <div className="flex flex-col gap-2 border-b border-stage-700/60 p-3">
            <div className="flex flex-wrap gap-1">
              {(['ALL', ...CHARACTER_TIERS] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTier(option)}
                  aria-pressed={tier === option}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] transition-colors',
                    tier === option
                      ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
                      : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
                  )}
                >
                  {option === 'ALL' ? '全部' : CHARACTER_TIER_LABEL[option]}
                  <span className="text-ink-600 tabular-nums">
                    {option === 'ALL' ? total : (countsByTier[option] ?? 0)}
                  </span>
                </button>
              ))}
            </div>

            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-600"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜尋角色（名稱 / 身分 / 關鍵字）"
                aria-label="搜尋角色"
                className="h-8 w-full rounded-lg bg-stage-850 pr-2 pl-8 text-[11px] text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title={total === 0 ? '還沒有角色' : '沒有符合的角色'}
              description={
                total === 0
                  ? '角色卡會被分鏡與配音重複使用——定妝提示詞鎖在這裡，120 集的臉才會是同一張。'
                  : '換個分類或關鍵字試試。'
              }
              icon={<UserRound aria-hidden className="size-5 text-ink-500" />}
              className="py-14"
            />
          ) : (
            <ul className="max-h-[40rem] overflow-y-auto p-2">
              {visible.map((character) => (
                <li key={character.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(character.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors',
                      character.id === selectedId
                        ? 'bg-accent-600/20 ring-1 ring-inset ring-accent-500/40'
                        : 'hover:bg-stage-800'
                    )}
                  >
                    <Portrait character={character} size="sm" />

                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate text-xs font-medium text-ink-100">
                        {character.name}
                      </span>
                      <span className="truncate text-[10px] text-ink-500">
                        {character.alias || '—'}
                      </span>
                    </span>

                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[9px] ring-1 ring-inset',
                        character.tier === 'LEAD'
                          ? 'bg-gilt-400/15 text-gilt-300 ring-gilt-500/50'
                          : 'bg-stage-800 text-ink-400 ring-stage-700'
                      )}
                    >
                      {CHARACTER_TIER_LABEL[character.tier]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- detail ------------------------------------------------------ */}
        {selected ? (
          <section className="panel flex min-w-0 flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
            <header className="flex flex-wrap items-start gap-3 border-b border-stage-700/60 p-4">
              {/*
                The portrait is the upload target. 角色設定 had no way to set
                one at all: the column, the validator and this renderer all
                existed, and the PATCH silently dropped the field.
              */}
              <PortraitPicker
                key={selected.id}
                projectId={projectId}
                character={selected}
                canWrite={canWrite}
              />

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <IdentityEditor
                  key={selected.id}
                  projectId={projectId}
                  character={selected}
                />

                {selected.alias && (
                  <p className="text-[11px] text-ink-400">{selected.alias}</p>
                )}

                <p className="text-[10px] text-ink-600">
                  {/*
                    小說與劇本分開寫 (P0-1)。「寫進小說了」跟「進了劇本」
                    不是同一件事，合成一個數字正好把值得看見的落差藏起來。
                  */}
                  出現於 {selected.episodeCount} 集
                  {selected.episodeCount > 0 && (
                    <>
                      （小說 {selected.novelEpisodeCount}
                      ・劇本 {selected.scriptEpisodeCount}）
                    </>
                  )}
                  ・更新於 {formatRelativeZh(selected.updatedAt)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setRemoving(selected)}
                className="shrink-0 rounded-lg px-2 py-1.5 text-[11px] text-ink-600 transition-colors hover:text-rose-300"
              >
                <Trash2 aria-hidden className="size-3.5" />
              </button>
            </header>

            <nav aria-label="角色資料分頁" className="flex gap-1 border-b border-stage-700/60 px-3">
              {(
                [
                  ['profile', '角色設定'],
                  ['appearance', '外觀設定'],
                  ['voice', '配音設定'],
                  ['relations', '關係網'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-current={tab === key ? 'page' : undefined}
                  className={cn(
                    'border-b-2 px-3 py-2 text-xs transition-all',
                    tab === key
                      ? 'border-accent-500 font-medium text-ink-50'
                      : 'border-transparent text-ink-400 hover:text-ink-100'
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="min-w-0 p-4">
              {tab === 'relations' ? (
                <RelationList
                  projectId={projectId}
                  character={selected}
                  characters={characters}
                  relationships={selectedRelations}
                />
              ) : (
                <CharacterFields
                  key={`${selected.id}:${tab}`}
                  projectId={projectId}
                  character={selected}
                  tab={tab}
                />
              )}
            </div>
          </section>
        ) : (
          <section className="panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
            <EmptyState
              title="選一位角色以檢視與編輯"
              icon={<UserRound aria-hidden className="size-5 text-ink-500" />}
              className="py-24"
            />
          </section>
        )}
      </div>

      {creating && (
        <CreateDialog
          projectId={projectId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            router.refresh()
          }}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title="移除這位角色？"
        tone="danger"
        busy={busy}
        message={
          removing
            ? `「${removing.name}」會從角色庫移除。這是軟刪除，設定與定妝提示詞仍留在資料庫中，但不會再出現在角色庫與 AI 參考範圍內。`
            : ''
        }
        confirmLabel={busy ? '移除中…' : '確定移除'}
        onConfirm={() => {
          if (removing) void remove(removing)
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * 角色名稱與定位，就地編輯.
 *
 * These two were display-only while everything else on the page was editable,
 * which is how a project ends up with a lead called 「沈知夏」 when the prose
 * says 「沈知味」 — the typo was visible on every screen and fixable on none.
 *
 * It matters more than an ordinary field: the character list is sent as
 * context with every AI request, so a wrong name is repeated back by the model
 * or stops it to ask, and either way costs a paid call.
 */
function IdentityEditor({
  projectId,
  character,
}: {
  projectId: string
  character: CharacterItem
}) {
  const toast = useToast()
  const router = useRouter()

  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(character.name)
  const [saving, setSaving] = useState(false)

  async function patch(body: Record<string, string>, label: string) {
    setSaving(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/characters/${character.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      router.refresh()
    } catch (error) {
      toast.error(`${label}儲存失敗`, error instanceof Error ? error.message : undefined)
      // Put the field back, so the screen never shows a value that was not saved.
      setName(character.name)
    } finally {
      setSaving(false)
    }
  }

  function commitName() {
    const next = name.trim()
    setEditingName(false)

    if (!next) {
      setName(character.name)
      return
    }
    if (next === character.name) return

    void patch({ name: next }, '名稱')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {editingName ? (
        <input
          autoFocus
          value={name}
          maxLength={60}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setName(character.name)
              setEditingName(false)
            }
          }}
          aria-label="角色名稱"
          className="min-w-0 flex-1 rounded-md bg-stage-950 px-2 py-1 text-base font-semibold text-ink-50 ring-1 ring-inset ring-accent-500 focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditingName(true)}
          title="點一下改名"
          className="group flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-stage-800"
        >
          <span className="truncate text-base font-semibold text-ink-50">{character.name}</span>
          <Pencil
            aria-hidden
            className="size-3 shrink-0 text-ink-700 opacity-0 transition-opacity group-hover:opacity-100"
          />
        </button>
      )}

      <label className="flex shrink-0 items-center gap-1">
        <span className="sr-only">角色定位</span>
        {character.tier === 'LEAD' && (
          <Crown aria-hidden className="size-3 text-gilt-300" />
        )}
        <select
          value={character.tier}
          disabled={saving}
          onChange={(event) => void patch({ tier: event.target.value }, '定位')}
          className={cn(
            'cursor-pointer rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset transition-colors',
            'focus:ring-2 focus:ring-accent-500 focus:outline-none disabled:opacity-60',
            character.tier === 'LEAD'
              ? 'bg-gilt-400/15 text-gilt-300 ring-gilt-500/50'
              : 'bg-stage-800 text-ink-400 ring-stage-700 hover:text-ink-200'
          )}
        >
          {CHARACTER_TIERS.map((tier) => (
            <option key={tier} value={tier} className="bg-stage-850 text-ink-200">
              {CHARACTER_TIER_LABEL[tier]}
            </option>
          ))}
        </select>
      </label>

      {saving && <Loader2 aria-hidden className="size-3 animate-spin text-ink-500" />}
    </div>
  )
}

function Portrait({
  character,
  size,
}: {
  character: CharacterItem
  size: 'sm' | 'lg'
}) {
  const dimension = size === 'sm' ? 'size-9' : 'h-28 w-20'

  if (character.keyVisualAssetId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={assetPreviewUrl(character.keyVisualAssetId)}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn('shrink-0 rounded-lg object-cover ring-1 ring-stage-700', dimension)}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-lg bg-stage-800 text-ink-600 ring-1 ring-stage-700',
        dimension
      )}
    >
      {size === 'sm' ? (
        character.name.trim().charAt(0) || '?'
      ) : (
        <span className="flex flex-col items-center gap-1 text-[9px]">
          <UserRound aria-hidden className="size-5" />
          尚無定妝照
        </span>
      )}
    </span>
  )
}

/** Editable text fields for one tab, saved on blur. */
function CharacterFields({
  projectId,
  character,
  tab,
}: {
  projectId: string
  character: CharacterItem
  tab: DetailTab
}) {
  const toast = useToast()
  const router = useRouter()
  const [saving, setSaving] = useState<string | null>(null)

  async function save(field: string, value: string) {
    if (value === (character as unknown as Record<string, string>)[field]) return

    setSaving(field)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/characters/${character.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [field]: value }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))
      router.refresh()
    } catch (error) {
      toast.error('儲存失敗', error instanceof Error ? error.message : undefined)
    } finally {
      setSaving(null)
    }
  }

  const fields: { key: keyof CharacterItem; label: string; rows?: number; hint?: string }[] =
    tab === 'profile'
      ? [
          { key: 'alias', label: '身分 / 別名' },
          { key: 'age', label: '年齡' },
          { key: 'gender', label: '性別' },
          { key: 'personality', label: '性格', rows: 3 },
          { key: 'background', label: '人物簡介', rows: 5 },
          { key: 'growth', label: '角色成長弧線', rows: 5, hint: '跨集的轉變，寫得出來才排得進劇本' },
        ]
      : tab === 'appearance'
        ? [
            { key: 'appearance', label: '外型 / 服裝 / 髮型', rows: 4 },
            {
              key: 'visualPrompt',
              label: '定妝提示詞',
              rows: 4,
              hint: '每一張這個角色的圖都會沿用，120 集的臉才會是同一張',
            },
            { key: 'negativePrompt', label: '負面提示詞', rows: 3 },
          ]
        : [
            { key: 'voiceProvider', label: '配音供應商' },
            { key: 'voiceNote', label: '配音備註', rows: 3 },
          ]

  return (
    <div className="flex flex-col gap-3">
      {/*
       * 音色跟風格不是純文字欄位 (Z140).
       *
       * 它們本來是。要填對得憑記憶打出 `zh-CN-XiaoxiaoNeural`（556 個音色裡
       * 的一個）跟 `disgruntled`（而且沒有任何地方說得出哪些音色收這個字）。
       * 結果是一個都沒有被填過——一個填不出來的欄位跟一個不存在的欄位，在
       * 資料庫裡是同一件事。
       */}
      {tab === 'voice' && (
        <VoicePicker
          voiceId={character.voiceId}
          voiceStyle={character.voiceStyle}
          onSave={save}
        />
      )}

      {fields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1">
          <span className="flex items-baseline gap-2 text-[11px] text-ink-400">
            {field.label}
            {saving === field.key && <span className="text-[10px] text-ink-600">儲存中…</span>}
            {field.hint && (
              <span className="ml-auto text-[10px] text-ink-600">{field.hint}</span>
            )}
          </span>

          {field.rows ? (
            <textarea
              defaultValue={String(character[field.key] ?? '')}
              onBlur={(event) => void save(field.key, event.target.value)}
              rows={field.rows}
              className="resize-none rounded-lg bg-stage-850 p-2 text-xs leading-relaxed text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            />
          ) : (
            <input
              defaultValue={String(character[field.key] ?? '')}
              onBlur={(event) => void save(field.key, event.target.value)}
              className="h-9 rounded-lg bg-stage-850 px-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            />
          )}
        </label>
      ))}

      <p className="text-[10px] text-ink-700">離開欄位時自動儲存。</p>
    </div>
  )
}

function RelationList({
  projectId,
  character,
  characters,
  relationships,
}: {
  projectId: string
  character: CharacterItem
  characters: CharacterItem[]
  relationships: RelationshipItem[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [targetId, setTargetId] = useState('')
  const [kind, setKind] = useState('')
  const [busy, setBusy] = useState(false)

  const others = characters.filter((c) => c.id !== character.id)

  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (!targetId || !kind.trim() || busy) return

    setBusy(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/relationships`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromCharacterId: character.id,
          toCharacterId: targetId,
          kind: kind.trim(),
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      setKind('')
      setTargetId('')
      router.refresh()
    } catch (error) {
      toast.error('新增關係失敗', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    try {
      const response = await apiFetch(`/api/projects/${projectId}/relationships/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await readApiError(response))
      router.refresh()
    } catch (error) {
      toast.error('移除失敗', error instanceof Error ? error.message : undefined)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {relationships.length === 0 ? (
        <EmptyState
          title="還沒有建立關係"
          description="關係是有方向的：「誰對誰」。同一對角色可以兩邊各記一條，因為感覺本來就不一定對等。"
          icon={<Network aria-hidden className="size-5 text-ink-500" />}
          className="py-8"
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {relationships.map((relation) => {
            const outgoing = relation.fromCharacterId === character.id
            return (
              <li
                key={relation.id}
                className="flex items-center gap-2 rounded-lg bg-stage-850 px-3 py-2 ring-1 ring-inset ring-stage-700"
              >
                <span className="text-[10px] text-ink-600">{outgoing ? '對' : '來自'}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-100">
                  {outgoing ? relation.toName : relation.fromName}
                </span>
                <span className="shrink-0 rounded bg-stage-800 px-1.5 py-0.5 text-[10px] text-ink-300 ring-1 ring-inset ring-stage-700">
                  {relation.kind}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(relation.id)}
                  aria-label="移除關係"
                  className="shrink-0 text-ink-700 transition-colors hover:text-rose-300"
                >
                  <Trash2 aria-hidden className="size-3" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {others.length > 0 && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-stage-700/60 pt-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] text-ink-400">
            對象
            <select
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              className="h-9 rounded-lg bg-stage-850 px-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            >
              <option value="">選擇角色</option>
              {others.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] text-ink-400">
            關係（例：兄妹、師徒、競爭對手）
            <input
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              className="h-9 rounded-lg bg-stage-850 px-2 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={busy || !targetId || !kind.trim()}
            className="h-9 rounded-lg bg-stage-800 px-3 text-xs text-ink-200 ring-1 ring-inset ring-stage-700 transition-colors hover:text-ink-50 disabled:opacity-50"
          >
            新增
          </button>
        </form>
      )}
    </div>
  )
}

function CreateDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [alias, setAlias] = useState('')
  const [tier, setTier] = useState<CharacterTierValue>('SUPPORTING')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || busy) return

    setBusy(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/characters`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), alias: alias.trim(), tier }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('已新增角色', name.trim())
      onCreated()
    } catch (error) {
      toast.error('新增失敗', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div
        aria-hidden
        className="absolute inset-0 bg-stage-990/80 backdrop-blur-sm"
        onClick={onClose}
      />

      <form
        onSubmit={submit}
        className="panel relative z-10 flex w-full max-w-md animate-rise flex-col gap-3 rounded-xl bg-stage-900 p-5 ring-1 ring-stage-700"
      >
        <h3 className="text-sm font-semibold text-ink-50">新增角色</h3>

        <label className="flex flex-col gap-1 text-[11px] text-ink-400">
          角色名稱
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
            className="h-9 rounded-lg bg-stage-850 px-2 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-ink-400">
          身分 / 別名
          <input
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            className="h-9 rounded-lg bg-stage-850 px-2 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-ink-400">
          重要度
          <select
            value={tier}
            onChange={(event) => setTier(event.target.value as CharacterTierValue)}
            className="h-9 rounded-lg bg-stage-850 px-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          >
            {CHARACTER_TIERS.map((option) => (
              <option key={option} value={option}>
                {CHARACTER_TIER_LABEL[option]}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-xs text-ink-400 transition-colors hover:text-ink-100"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="bg-brand-gradient glow-accent-sm rounded-lg px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? '新增中…' : '新增'}
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * 角色定妝照 — the portrait, with upload attached.
 *
 * Saved immediately rather than batched into a form: there is no form here,
 * the rest of this panel saves on blur, and an image that uploads and then
 * waits for a 儲存 button is an image people assume is already saved.
 *
 * The asset is linked to the character as well as written to
 * `key_visual_asset_id`, so deleting it later can tell what still points at it.
 */
function PortraitPicker({
  projectId,
  character,
  canWrite,
}: {
  projectId: string
  character: CharacterItem
  canWrite: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [saving, setSaving] = useState(false)

  async function commit(assetId: string | null) {
    setSaving(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/characters/${character.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ keyVisualAssetId: assetId }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success(assetId ? '定妝照已更新' : '已移除定妝照')
      router.refresh()
    } catch (error) {
      toast.error('定妝照儲存失敗', error instanceof Error ? error.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  if (!canWrite) return <Portrait character={character} size="lg" />

  return (
    <ImagePicker
      projectId={projectId}
      assetId={character.keyVisualAssetId}
      onChange={(assetId) => void commit(assetId)}
      shape="portrait"
      label="定妝照"
      hint="分鏡與 AI 生圖會拿這張當角色的樣貌參考。直式、臉部清楚最好。"
      linkTo={{ entityType: 'character', entityId: character.id, slot: 'key_visual' }}
      disabled={saving}
    />
  )
}
