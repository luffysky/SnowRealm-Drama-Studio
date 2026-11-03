/**
 * Project id validation, with no database imports.
 *
 * Postgres rejects a malformed uuid with an error rather than an empty result,
 * so `/projects/garbage` would 500 instead of 404 if the id reached SQL. The
 * check lives in its own module because Client Components need it too, and
 * importing it from `@/lib/project-access` would pull Drizzle and `pg` into
 * the browser bundle.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}
