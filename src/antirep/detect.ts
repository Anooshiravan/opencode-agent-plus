// Pure repetition detection: finds a short piece of text repeated back-to-back
// many times, like "parameter=parameter=parameter=...".
// No streams, no state, no opencode types here — easy to test on its own.

export interface RepetitionHit {
  /** The repeated piece, e.g. "parameter=". */
  unit: string
  /** How many times it appeared back-to-back. */
  times: number
}

export interface DetectOptions {
  /** Longest repeated piece to look for. Default 64 characters. */
  maxUnit?: number
  /** Minimum back-to-back repeats to call it repetition. Default 5. */
  minTimes?: number
  /** Minimum total characters (unit x times) to call it repetition. Default 40. */
  minTotal?: number
  /** Only the last this-many characters are examined. Default 4096. */
  window?: number
}

// Looks at the tail of `text` for a block of length `unit` repeated `minTimes`
// or more times in a row. Returns the longest/most repeated block found.
export function findRepetition(text: string, options: DetectOptions = {}): RepetitionHit | undefined {
  const maxUnit = options.maxUnit ?? 64
  const minTimes = options.minTimes ?? 5
  const minTotal = options.minTotal ?? 40
  const window = options.window ?? 4096

  const tail = text.length > window ? text.slice(-window) : text
  let best: RepetitionHit | undefined

  for (let unit = 1; unit <= maxUnit; unit++) {
    // Need room for minTimes copies ending at (or near) the tail's end.
    // Start scanning from every position where a run could reach the minimum.
    const limit = tail.length - unit * minTimes
    if (limit < 0) break
    for (let start = 0; start <= limit; start++) {
      const block = tail.slice(start, start + unit)
      let times = 1
      let at = start + unit
      while (at + unit <= tail.length && tail.startsWith(block, at)) {
        times++
        at += unit
      }
      if (times >= minTimes && times * unit >= minTotal) {
        const hit = { unit: block, times }
        if (!best || times * unit > best.times * best.unit.length) best = hit
      }
      // Skip ahead: a run of `times` blocks cannot hide another qualifying
      // run that starts inside it and ends later than `at`.
      if (times > 1) start = at - unit
    }
  }
  return best
}
