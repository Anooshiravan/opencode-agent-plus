import { expect, test } from "bun:test"
import { findRepetition } from "./repetition"

test("flags a repeated block, ignores normal text", () => {
  expect(findRepetition("parameter=".repeat(10))?.times).toBeGreaterThanOrEqual(5)
  expect(findRepetition("the quick brown fox jumps over the lazy dog")).toBeUndefined()
  expect(findRepetition("ok " .repeat(4))).toBeUndefined() // below min total
})

test("empty and short input", () => {
  expect(findRepetition("")).toBeUndefined()
  expect(findRepetition("a")).toBeUndefined()
  expect(findRepetition("aaaaa")).toBeUndefined() // repeats but below min total
})

test("repetition only at the start is still found", () => {
  expect(findRepetition("xy".repeat(30) + " done")).toBeDefined()
})
