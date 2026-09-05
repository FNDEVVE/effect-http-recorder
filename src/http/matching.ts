import { HashSet, Option } from "effect"
import type { RequestMatcher, RequestSnapshot } from "../api.js"
import { canonicalizeJson, decodeJson, isJsonRecord, jsonBody, safeText } from "../replay/comparison.js"
import type { HttpInteraction } from "./model.js"

export type { RequestMatcher } from "../api.js"

export const canonicalSnapshot = (snapshot: RequestSnapshot): string =>
  JSON.stringify({
    method: snapshot.method,
    url: snapshot.url,
    headers: canonicalizeJson(snapshot.headers),
    body: Option.match(decodeJson(snapshot.body), {
      onNone: () => snapshot.body,
      onSome: canonicalizeJson,
    }),
  })

export const defaultMatcher: RequestMatcher = (incoming, recorded) =>
  canonicalSnapshot(incoming) === canonicalSnapshot(recorded)

const valueDiffs = (
  expected: unknown,
  received: unknown,
  format: (value: unknown) => string,
  base = "$",
  limit = 8,
): ReadonlyArray<string> => {
  if (Object.is(expected, received)) return []
  if (isJsonRecord(expected) && isJsonRecord(received)) {
    return [...new Set([...Object.keys(expected), ...Object.keys(received)])]
      .toSorted()
      .flatMap((key) => valueDiffs(expected[key], received[key], format, `${base}.${key}`, limit))
      .slice(0, limit)
  }
  if (Array.isArray(expected) && Array.isArray(received)) {
    return Array.from({ length: Math.max(expected.length, received.length) }, (_, index) => index)
      .flatMap((index) => valueDiffs(expected[index], received[index], format, `${base}[${index}]`, limit))
      .slice(0, limit)
  }
  return [`${base} expected ${format(expected)}, received ${format(received)}`]
}

const headerDiffs = (
  expected: Record<string, string>,
  received: Record<string, string>,
  format: (value: unknown) => string,
) =>
  [...new Set([...Object.keys(expected), ...Object.keys(received)])].toSorted().flatMap((key) => {
    if (expected[key] === received[key]) return []
    if (expected[key] === undefined) return [`  ${key} unexpected ${format(received[key])}`]
    if (received[key] === undefined) return [`  ${key} missing expected ${format(expected[key])}`]
    return [`  ${key} expected ${format(expected[key])}, received ${format(received[key])}`]
  })

export const requestDiff = (
  expected: RequestSnapshot,
  received: RequestSnapshot,
  env: Record<string, string | undefined>,
): ReadonlyArray<string> => {
  const format = (value: unknown) => safeText(value, env)
  const lines: string[] = []
  if (expected.method !== received.method) {
    lines.push("method:", `  expected ${format(expected.method)}, received ${format(received.method)}`)
  }
  if (expected.url !== received.url) {
    lines.push("url:", `  expected ${format(expected.url)}`, `  received ${format(received.url)}`)
  }
  const headers = headerDiffs(expected.headers, received.headers, format)
  if (headers.length > 0) lines.push("headers:", ...headers.slice(0, 8))
  const expectedBody = jsonBody(expected.body)
  const receivedBody = jsonBody(received.body)
  const body =
    expectedBody !== undefined && receivedBody !== undefined
      ? valueDiffs(expectedBody, receivedBody, format).map((line) => `  ${line}`)
      : expected.body === received.body
        ? []
        : [`  expected ${format(expected.body)}, received ${format(received.body)}`]
  if (body.length > 0) lines.push("body:", ...body)
  return lines
}

export const selectFirstMatching = (
  interactions: ReadonlyArray<HttpInteraction>,
  incoming: RequestSnapshot,
  match: RequestMatcher,
  used: HashSet.HashSet<number>,
  env: Record<string, string | undefined>,
): { readonly _tag: "Matched"; readonly index: number } | { readonly _tag: "Unmatched"; readonly detail: string } => {
  let firstUnused: HttpInteraction | undefined
  for (let index = 0; index < interactions.length; index++) {
    if (HashSet.has(used, index)) continue
    const interaction = interactions[index]
    firstUnused ??= interaction
    if (match(incoming, interaction.request)) return { _tag: "Matched", index }
  }
  if (firstUnused === undefined)
    return { _tag: "Unmatched", detail: `all ${interactions.length} recorded interactions have already been consumed` }
  return {
    _tag: "Unmatched",
    detail: requestDiff(firstUnused.request, incoming, env).join("\n"),
  }
}

export * as HttpMatching from "./matching.js"
