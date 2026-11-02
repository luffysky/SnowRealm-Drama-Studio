/**
 * Seeds the two studio accounts and the real production skeleton:
 * 《一灶見山河》→ 第一部《萬家燈火》→ 120 empty episodes, each with its nine
 * production stages.
 *
 * It deliberately creates **no** sample characters, shots, tasks or costs. The
 * UI spec is explicit that figures in the design mockups are illustrative and
 * must not become seed data, so every number the dashboard shows comes from
 * real rows the team enters themselves.
 *
 * Idempotent: re-running updates the two accounts' details and tops up any
 * missing episodes without duplicating anything.
 *
 *   npm run db:seed
 */
import { eq, inArray } from 'drizzle-orm'
import { closeDb, db } from '../src/db'
import { arcs, episodeStages, episodes, projects, users } from '../src/db/schema'
import { hashPassword, describePasswordProblem } from '../src/lib/auth/password'
import { FLAGSHIP, STAGES } from '../src/lib/constants'
import { loadEnv } from '../src/lib/load-env'

type SeedAccount = {
  email: string
  name: string
  title: string
  password: string
  color: string
}

function readAccounts(): SeedAccount[] {
  const missing: string[] = []

  function required(key: string): string {
    const value = process.env[key]?.trim()
    if (!value) missing.push(key)
    return value ?? ''
  }

  const accounts: SeedAccount[] = [
    {
      email: required('SEED_OWNER_EMAIL'),
      name: required('SEED_OWNER_NAME'),
      title: process.env.SEED_OWNER_TITLE?.trim() || 'CEO',
      password: required('SEED_OWNER_PASSWORD'),
      color: '#f0b429',
    },
    {
      email: required('SEED_COLLABORATOR_EMAIL'),
      name: required('SEED_COLLABORATOR_NAME'),
      title: process.env.SEED_COLLABORATOR_TITLE?.trim() || '技術總監',
      password: required('SEED_COLLABORATOR_PASSWORD'),
      color: '#a78bfa',
    },
  ]

  if (missing.length > 0) {
    throw new Error(
      `缺少以下環境變數，無法建立帳號：\n  ${missing.join('\n  ')}\n\n` +
        `請在 .env.local 填入後重試。說明見 docs/ENVIRONMENT.md`
    )
  }

  for (const account of accounts) {
    const problem = describePasswordProblem(account.password)
    if (problem) {
      throw new Error(`${account.email} 的密碼不符合要求：${problem}`)
    }
  }

  if (accounts[0]!.email === accounts[1]!.email) {
    throw new Error('兩個帳號不可使用相同的 email')
  }

  return accounts
}

async function seedUsers(accounts: SeedAccount[]) {
  for (const account of accounts) {
    const passwordHash = await hashPassword(account.password)

    // Both members are OWNER; the role column exists for future narrowing.
    await db
      .insert(users)
      .values({
        email: account.email,
        name: account.name,
        title: account.title,
        passwordHash,
        role: 'OWNER',
        color: account.color,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          name: account.name,
          title: account.title,
          passwordHash,
          role: 'OWNER',
          color: account.color,
          active: true,
          updatedAt: new Date(),
        },
      })

    console.log(`  user  ${account.email.padEnd(32)} ${account.name}（${account.title}）`)
  }
}

async function seedProject() {
  const [project] = await db
    .insert(projects)
    .values({
      title: FLAGSHIP.projectTitle,
      slug: FLAGSHIP.projectSlug,
      status: 'IN_PRODUCTION',
      targetMinSec: FLAGSHIP.targetMinSec,
      targetMaxSec: FLAGSHIP.targetMaxSec,
    })
    .onConflictDoUpdate({
      target: projects.slug,
      set: {
        title: FLAGSHIP.projectTitle,
        targetMinSec: FLAGSHIP.targetMinSec,
        targetMaxSec: FLAGSHIP.targetMaxSec,
        updatedAt: new Date(),
      },
    })
    .returning({ id: projects.id, title: projects.title })

  if (!project) throw new Error('Failed to upsert project')
  console.log(`  project 《${project.title}》`)

  const [arc] = await db
    .insert(arcs)
    .values({
      projectId: project.id,
      index: FLAGSHIP.arcIndex,
      title: FLAGSHIP.arcTitle,
      plannedEpisodes: FLAGSHIP.plannedEpisodes,
    })
    .onConflictDoUpdate({
      target: [arcs.projectId, arcs.index],
      set: {
        title: FLAGSHIP.arcTitle,
        plannedEpisodes: FLAGSHIP.plannedEpisodes,
        updatedAt: new Date(),
      },
    })
    .returning({ id: arcs.id, title: arcs.title })

  if (!arc) throw new Error('Failed to upsert arc')
  console.log(`  arc     第${FLAGSHIP.arcIndex}部《${arc.title}》 — ${FLAGSHIP.plannedEpisodes} 集`)

  return { projectId: project.id, arcId: arc.id }
}

async function seedEpisodes(projectId: string, arcId: string) {
  const existing = await db
    .select({ number: episodes.number })
    .from(episodes)
    .where(eq(episodes.arcId, arcId))

  const have = new Set(existing.map((e) => e.number))
  const wanted = Array.from({ length: FLAGSHIP.plannedEpisodes }, (_, i) => i + 1)
  const toCreate = wanted.filter((n) => !have.has(n))

  if (toCreate.length === 0) {
    console.log(`  episodes ${have.size} 集已存在，無需新增`)
  } else {
    // One transaction: 120 episodes and their 1,080 stage rows land together.
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(episodes)
        .values(
          toCreate.map((number) => ({
            projectId,
            arcId,
            number,
            // Title and synopsis stay empty — the team writes them.
            targetSec: Math.round((FLAGSHIP.targetMinSec + FLAGSHIP.targetMaxSec) / 2),
            status: 'PLANNED' as const,
          }))
        )
        .returning({ id: episodes.id, number: episodes.number })

      const stageRows = inserted.flatMap((ep) =>
        STAGES.map((stage) => ({ episodeId: ep.id, stage, state: 'TODO' as const }))
      )

      // Chunked: a single 1,080-row insert exceeds the parameter limit.
      for (let i = 0; i < stageRows.length; i += 500) {
        await tx.insert(episodeStages).values(stageRows.slice(i, i + 500))
      }
    })

    console.log(
      `  episodes 新增 ${toCreate.length} 集（第 ${toCreate[0]} ~ ${toCreate.at(-1)} 集）` +
        `，共 ${toCreate.length * STAGES.length} 筆階段紀錄`
    )
  }

  // Backfill stages for any episode that somehow lacks them.
  const allEpisodes = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.arcId, arcId))

  const episodeIds = allEpisodes.map((e) => e.id)
  if (episodeIds.length === 0) return

  const stageCounts = await db
    .select({ episodeId: episodeStages.episodeId, stage: episodeStages.stage })
    .from(episodeStages)
    .where(inArray(episodeStages.episodeId, episodeIds))

  const byEpisode = new Map<string, Set<string>>()
  for (const row of stageCounts) {
    const set = byEpisode.get(row.episodeId) ?? new Set<string>()
    set.add(row.stage)
    byEpisode.set(row.episodeId, set)
  }

  const backfill = episodeIds.flatMap((id) => {
    const have2 = byEpisode.get(id) ?? new Set<string>()
    return STAGES.filter((s) => !have2.has(s)).map((stage) => ({
      episodeId: id,
      stage,
      state: 'TODO' as const,
    }))
  })

  if (backfill.length > 0) {
    for (let i = 0; i < backfill.length; i += 500) {
      await db.insert(episodeStages).values(backfill.slice(i, i + 500))
    }
    console.log(`  stages  補齊 ${backfill.length} 筆缺少的階段紀錄`)
  }
}

async function main() {
  loadEnv()

  console.log('\n[seed] SnowRealm Drama Studio\n')

  const accounts = readAccounts()
  await seedUsers(accounts)

  const { projectId, arcId } = await seedProject()
  await seedEpisodes(projectId, arcId)

  console.log('\n[seed] 完成。可用上述帳號登入。\n')
  console.log('注意：未建立任何示範角色、分鏡或成本資料。')
  console.log('      所有統計數字都來自實際輸入的內容。\n')
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\n[seed] 失敗：', err instanceof Error ? err.message : err, '\n')
    await closeDb().catch(() => {})
    process.exit(1)
  })
