import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 索引真的在擋嗎 (Z148).
 *
 * 「索引建起來了」跟「它會擋住重複」是兩件事。所以這裡**真的插一筆重複**，
 * 看它報不報錯，然後回復。沒有報錯就是索引沒生效。
 */
async function main() {
  const { Client } = await import('pg')
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('沒有測試庫連線字串')

  const client = new Client({ connectionString: url })
  await client.connect()

  const { rows: idx } = await client.query(`
    select indexname, indexdef from pg_indexes
     where tablename = 'episodes' and indexname = 'episodes_project_number_idx'
  `)
  console.log(`  索引存在：${idx.length === 1 ? '✓' : '✗'}`)
  if (idx[0]) console.log(`    ${idx[0].indexdef}`)

  // 拿一集真的資料來複製它的 (project_id, number)。
  const { rows: one } = await client.query(
    `select id, project_id, arc_id, number from episodes where deleted_at is null limit 1`
  )
  if (!one[0]) throw new Error('測試庫沒有集數')

  try {
    await client.query('begin')
    await client.query(
      `insert into episodes (project_id, arc_id, number) values ($1, $2, $3)`,
      [one[0].project_id, one[0].arc_id, one[0].number]
    )
    console.log('  插入重複集號：✗ 居然成功了——索引沒有在擋')
    await client.query('rollback')
  } catch (cause) {
    await client.query('rollback')
    const message = cause instanceof Error ? cause.message : String(cause)
    const blocked = /episodes_project_number_idx|episodes_arc_number_key|duplicate key/.test(message)
    console.log(`  插入重複集號：${blocked ? '✓ 被擋下來' : '? 被擋但原因不明'}`)
    console.log(`    ${message.split('\n')[0]}`)
  }

  // 另一卷的同號，才是這個索引真正新增的保護。
  const { rows: arc } = await client.query(
    `insert into arcs (project_id, index, title, planned_episodes)
     values ($1, 99, '索引測試用', 0) returning id`,
    [one[0].project_id]
  )
  try {
    await client.query('begin')
    await client.query(
      `insert into episodes (project_id, arc_id, number) values ($1, $2, $3)`,
      [one[0].project_id, arc[0].id, one[0].number]
    )
    console.log('  另一卷的同號：✗ 居然成功了——這正是本來擋不住的那個洞')
    await client.query('rollback')
  } catch (cause) {
    await client.query('rollback')
    const message = cause instanceof Error ? cause.message : String(cause)
    console.log(`  另一卷的同號：${/episodes_project_number_idx/.test(message) ? '✓ 被新索引擋下來' : '? ' + message.split('\n')[0]}`)
  } finally {
    await client.query('delete from arcs where id = $1', [arc[0].id])
  }

  await client.end()
  process.exit(0)
}

void main()
