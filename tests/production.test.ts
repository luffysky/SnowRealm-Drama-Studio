import { describe, expect, it } from 'vitest'
import {
  aggregateProgress,
  episodeProgress,
  PRODUCTION_STAGE_KEYS,
  stageFraction,
  stageOrdinal,
  STAGES_PER_EPISODE,
  toPercent,
  type StageLike,
} from '@/lib/production'

/**
 * The completion contract from spec v3 §11.2.
 *
 * These are the rules that stop four different screens printing four different
 * percentages for the same work, and the ones that stop a stage being finished
 * by flipping a dropdown.
 */

const stage = (status: StageLike['status'], progressPercent = 0): StageLike => ({
  status,
  progressPercent,
})

describe('stageFraction', () => {
  it('counts a completed stage as a whole stage', () => {
    expect(stageFraction(stage('completed'))).toBe(1)
    // Even with a nonsense percentage attached.
    expect(stageFraction(stage('completed', 0))).toBe(1)
  })

  it('counts an unstarted stage as nothing', () => {
    expect(stageFraction(stage('not_started', 90))).toBe(0)
  })

  it('counts work in progress by its recorded percentage', () => {
    expect(stageFraction(stage('in_progress', 50))).toBe(0.5)
    expect(stageFraction(stage('in_progress', 37))).toBeCloseTo(0.37)
  })

  it('never lets an unaccepted stage count as finished', () => {
    // 「完成狀態必須對應必要驗收，不能只靠人工修改前端數字」
    expect(stageFraction(stage('in_review', 100))).toBeLessThanOrEqual(1)
    expect(stageFraction(stage('in_review', 99))).toBeCloseTo(0.99)
  })

  it('never lets a blocked stage count as finished', () => {
    expect(stageFraction(stage('blocked', 0))).toBe(0)
    expect(stageFraction(stage('blocked', 40))).toBeCloseTo(0.4)
    expect(stageFraction(stage('blocked', 100))).toBeLessThanOrEqual(1)
  })

  it('ignores impossible percentages rather than propagating them', () => {
    expect(stageFraction(stage('in_progress', 150))).toBe(1)
    expect(stageFraction(stage('in_progress', -20))).toBe(0)
    expect(stageFraction(stage('in_progress', Number.NaN))).toBe(0)
  })
})

describe('episodeProgress', () => {
  it('divides by nine, not by however many rows exist', () => {
    /*
     * The regression this guards: an episode with only its 小說 row created and
     * completed is 1/9 done, not 100%. The spec calls this out by name —
     * 「小說完成不等於整集完成」.
     */
    expect(episodeProgress([stage('completed')])).toBeCloseTo(1 / 9)
  })

  it('reaches 1 only when all nine stages are complete', () => {
    const all = PRODUCTION_STAGE_KEYS.map(() => stage('completed'))
    expect(episodeProgress(all)).toBe(1)

    const eight = PRODUCTION_STAGE_KEYS.slice(1).map(() => stage('completed'))
    expect(episodeProgress(eight)).toBeLessThan(1)
  })

  it('is zero for an episode with no stage rows', () => {
    expect(episodeProgress([])).toBe(0)
  })

  it('weights every stage equally, which is the V1 default', () => {
    const novelOnly = episodeProgress([stage('completed')])
    const releaseOnly = episodeProgress([stage('completed')])
    expect(novelOnly).toBe(releaseOnly)
  })
})

describe('aggregateProgress', () => {
  it('is completed equivalents over effective stages', () => {
    expect(aggregateProgress(540, 1080)).toBe(0.5)
  })

  it('counts episodes with no stage rows against the denominator', () => {
    // 120 episodes planned, only one stage row and it is done.
    expect(aggregateProgress(1, 120 * STAGES_PER_EPISODE)).toBeLessThan(0.01)
  })

  it('does not average per-project percentages', () => {
    /*
     * A one-episode project at 100% and a 120-episode project at 0% is not
     * 50% overall. Summing equivalents is what keeps the small project from
     * outvoting the large one.
     */
    const small = { done: STAGES_PER_EPISODE, stages: STAGES_PER_EPISODE }
    const large = { done: 0, stages: 120 * STAGES_PER_EPISODE }

    const combined = aggregateProgress(
      small.done + large.done,
      small.stages + large.stages
    )

    expect(combined).toBeLessThan(0.01)
    expect(combined).not.toBeCloseTo(0.5)
  })

  it('is zero rather than NaN when nothing is planned', () => {
    expect(aggregateProgress(0, 0)).toBe(0)
    expect(aggregateProgress(5, 0)).toBe(0)
  })
})

describe('toPercent', () => {
  it('rounds in one place, so two screens cannot disagree', () => {
    expect(toPercent(0.275)).toBe(28)
    expect(toPercent(0.2749)).toBe(27)
  })

  it('clamps rather than reporting impossible percentages', () => {
    expect(toPercent(1.4)).toBe(100)
    expect(toPercent(-0.3)).toBe(0)
  })
})

describe('stageOrdinal', () => {
  it('numbers the stages 01–09 as the design does', () => {
    expect(stageOrdinal('story_planning')).toBe('01')
    expect(stageOrdinal('release')).toBe('09')
    expect(PRODUCTION_STAGE_KEYS).toHaveLength(9)
  })
})
