/**
 * Myers diff (An O(ND) Difference Algorithm and Its Variations, Myers 1986),
 * with backtracking over the recorded V arrays. Segments hold at most a few
 * dozen tokens, so the O(D²) space of the snapshot form is irrelevant here and
 * the implementation stays readable.
 */

export type DiffOpKind = "equal" | "delete" | "insert";

export interface DiffOp {
  kind: DiffOpKind;
  /** index into the old sequence, -1 for inserts */
  oldIndex: number;
  /** index into the new sequence, -1 for deletes */
  newIndex: number;
}

export function myersDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) {
    return b.map((_, j) => ({ kind: "insert" as const, oldIndex: -1, newIndex: j }));
  }
  if (m === 0) {
    return a.map((_, i) => ({ kind: "delete" as const, oldIndex: i, newIndex: -1 }));
  }

  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  let reachedD = -1;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      const down =
        k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset]);
      if (down) {
        x = v[k + 1 + offset];
      } else {
        x = v[k - 1 + offset] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) {
        reachedD = d;
        break outer;
      }
    }
  }

  // Backtrack through the recorded V arrays, emitting ops in reverse order.
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;

  for (let d = reachedD; d >= 0; d--) {
    const vPrev = trace[d];
    const k = x - y;
    const kPrev =
      k === -d || (k !== d && vPrev[k - 1 + offset] < vPrev[k + 1 + offset])
        ? k + 1
        : k - 1;
    const prevX = vPrev[kPrev + offset];
    const prevY = prevX - kPrev;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ kind: "equal", oldIndex: x, newIndex: y });
    }

    if (d > 0) {
      if (x === prevX) {
        y--;
        ops.push({ kind: "insert", oldIndex: -1, newIndex: y });
      } else {
        x--;
        ops.push({ kind: "delete", oldIndex: x, newIndex: -1 });
      }
    }

    x = prevX;
    y = prevY;
  }

  ops.reverse();
  return ops;
}
