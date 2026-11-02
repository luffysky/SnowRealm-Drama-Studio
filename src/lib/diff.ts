/**
 * Line-level diff, used by the version history view and by the AI candidate
 * comparison dialogs (spec 08 / 30 / 41).
 *
 * Plain LCS over lines: O(n·m), which is fine for one episode of a short drama
 * (a few hundred lines) and avoids a dependency for the one place it is needed.
 */

export type DiffOp = { type: 'same' | 'add' | 'remove'; text: string }

export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split('\n')
  const b = after.split('\n')

  // table[i][j] = length of the LCS of a[i..] and b[j..]
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }

  const ops: DiffOp[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', text: a[i]! })
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ type: 'remove', text: a[i]! })
      i++
    } else {
      ops.push({ type: 'add', text: b[j]! })
      j++
    }
  }

  while (i < a.length) ops.push({ type: 'remove', text: a[i++]! })
  while (j < b.length) ops.push({ type: 'add', text: b[j++]! })

  return ops
}

export function diffStats(ops: readonly DiffOp[]): { added: number; removed: number } {
  return {
    added: ops.filter((o) => o.type === 'add').length,
    removed: ops.filter((o) => o.type === 'remove').length,
  }
}
