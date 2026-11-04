/**
 * The client-safe half of 卷 (Z128).
 *
 * `./arcs.ts` imports `@/db`; a client component importing a type from it is
 * fine at compile time but one stray value import drags Drizzle into the
 * browser bundle. Same `*-view` convention used elsewhere for exactly this.
 */
export type ArcRow = {
  id: string
  index: number
  title: string
  logline: string
  plannedEpisodes: number
  /** Episodes currently filed under it. */
  episodeCount: number
  /** The range they span, for 「EP001–EP040」. Null when empty. */
  firstNumber: number | null
  lastNumber: number | null
}
