import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 誰是什麼角色，以及刪得了素材嗎。 */
async function main() {
  const { db } = await import('../src/db')
  const { users } = await import('../src/db/schema')
  const { roleCan } = await import('../src/lib/auth/rbac')

  const rows = await db
    .select({ email: users.email, name: users.name, role: users.role })
    .from(users)

  for (const row of rows) {
    console.log(
      `  ${row.name}（${row.email}）  角色 ${row.role}  ` +
        `asset.delete ${roleCan(row.role, 'asset.delete') ? '✓ 可以' : '✗ 不行'}`
    )
  }

  process.exit(0)
}

void main()
