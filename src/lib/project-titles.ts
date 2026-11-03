/**
 * 作品名稱、小說書名、短劇劇名.
 *
 * One production can carry three names: the work itself (what the studio
 * calls it internally), the novel's published title, and the short drama's
 * release title. They are often the same, so `novelTitle` and `dramaTitle`
 * default to empty and mean "same as the work".
 *
 * That fallback lives here rather than in each component, because the
 * alternative — storing a copy of `title` in both columns — looks fine until
 * the work is renamed and two stale copies are left behind.
 *
 * No database imports: Client Components read these too.
 */

export type ProjectTitles = {
  title: string
  novelTitle: string
  dramaTitle: string
}

/** The work's own name. What the studio calls it, and what search indexes. */
export function workTitleOf(project: Pick<ProjectTitles, 'title'>): string {
  return project.title
}

/** The name the novel is published under. */
export function novelTitleOf(project: Pick<ProjectTitles, 'title' | 'novelTitle'>): string {
  return project.novelTitle.trim() || project.title
}

/** The name the short drama is released under. */
export function dramaTitleOf(project: Pick<ProjectTitles, 'title' | 'dramaTitle'>): string {
  return project.dramaTitle.trim() || project.title
}

/**
 * Whether this project actually uses different names.
 *
 * The UI shows the novel/drama line only when there is something to say: on a
 * project where all three match, printing the same name three times is noise.
 */
export function hasDistinctTitles(project: ProjectTitles): boolean {
  return novelTitleOf(project) !== project.title || dramaTitleOf(project) !== project.title
}

/**
 * Every name worth searching for, de-duplicated.
 *
 * A member who remembers only the drama's release title must still find the
 * work, so all three go into the search index.
 */
export function searchableTitles(project: ProjectTitles): string[] {
  return [...new Set([project.title, novelTitleOf(project), dramaTitleOf(project)])]
}
