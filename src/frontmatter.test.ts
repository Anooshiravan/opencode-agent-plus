import { expect, test } from "bun:test"
import { frontmatter, problems, requestValue } from "./frontmatter"

test("parses keys and | blocks", () => {
  const keys = frontmatter("---\ntemperature: 1\nreminder: |\n  a\n  b\n---\nbody")
  expect(keys.temperature).toBe("1")
  expect(keys.reminder).toBe("a\nb")
})

test("validates request values", () => {
  expect(requestValue("enable_thinking", "true")).toEqual({ value: true })
  expect(requestValue("reasoning_effort", "bad")).toEqual({ error: "reasoning_effort: must be one of none, minimal, low, medium, high, xhigh" })
})

test("no frontmatter, empty, and unknown keys", () => {
  expect(frontmatter("no dashes here")).toEqual({})
  expect(frontmatter("---\n---\n")).toEqual({})
  expect(frontmatter("---\nsomekey: v\n---").somekey).toBe("v")
})

test("reports misspelled keys and wrong values", async () => {
  const found = await problems("f", { temprature: "1", max_word_repeat: "maybe" })
  expect(found).toContain("temprature → temperature")
  expect(found).toContain("max_word_repeat: must be on or off")
})
