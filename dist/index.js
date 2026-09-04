// src/cassette/store.ts
import { Context, Effect, FileSystem, Layer, Schema as Schema5, Semaphore } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";

// src/redaction/secrets.ts
import { Schema } from "effect";
var SECRET_PATTERNS = [
  { label: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i },
  { label: "API key", pattern: /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{20,}\b/ },
  { label: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/ },
  { label: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { label: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ }
];
var ENV_SECRET_NAMES = /(?:API|AUTH|BEARER|CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN)/i;
var SAFE_ENV_VALUES = new Set(["fixture", "test", "test-key"]);
var envSecrets = () => Object.entries(process.env).flatMap(([name, value]) => {
  if (!value)
    return [];
  if (!ENV_SECRET_NAMES.test(name))
    return [];
  if (value.length < 12)
    return [];
  if (SAFE_ENV_VALUES.has(value.toLowerCase()))
    return [];
  return [{ name, value }];
});
var pathFor = (base, key) => base ? `${base}.${key}` : key;
var stringEntries = (value, base = "") => {
  if (typeof value === "string")
    return [{ path: base, value }];
  if (Array.isArray(value))
    return value.flatMap((item, index) => stringEntries(item, `${base}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => stringEntries(child, pathFor(base, key)));
  }
  return [];
};
var SecretFindingSchema = Schema.Struct({
  path: Schema.String,
  reason: Schema.String
});
var secretFindings = (value) => {
  const environment = envSecrets();
  return stringEntries(value).flatMap((entry) => [
    ...SECRET_PATTERNS.filter((item) => item.pattern.test(entry.value)).map((item) => ({
      path: entry.path,
      reason: item.label
    })),
    ...environment.filter((item) => entry.value.includes(item.value)).map((item) => ({
      path: entry.path,
      reason: `environment secret ${item.name}`
    }))
  ]);
};

// src/cassette/model.ts
import { Schema as Schema4 } from "effect";

// src/http/model.ts
import { Schema as Schema2 } from "effect";
var RequestSnapshotSchema = Schema2.Struct({
  method: Schema2.String,
  url: Schema2.String,
  headers: Schema2.Record(Schema2.String, Schema2.String),
  body: Schema2.String
});
var ResponseSnapshotSchema = Schema2.Struct({
  status: Schema2.Number,
  headers: Schema2.Record(Schema2.String, Schema2.String),
  body: Schema2.String,
  bodyEncoding: Schema2.optional(Schema2.Literals(["text", "base64"]))
});
var HttpInteractionSchema = Schema2.Struct({
  transport: Schema2.tag("http"),
  request: RequestSnapshotSchema,
  response: ResponseSnapshotSchema
});

// src/websocket/model.ts
import { Schema as Schema3 } from "effect";
var WebSocketEventSchema = Schema3.Union([
  Schema3.Struct({
    direction: Schema3.Literals(["client", "server"]),
    kind: Schema3.tag("text"),
    body: Schema3.String
  }),
  Schema3.Struct({
    direction: Schema3.Literals(["client", "server"]),
    kind: Schema3.tag("binary"),
    body: Schema3.String,
    bodyEncoding: Schema3.Literal("base64")
  })
]);
var WebSocketInteractionSchema = Schema3.Struct({
  transport: Schema3.tag("websocket"),
  connection: Schema3.optional(Schema3.Struct({
    sequence: Schema3.Number,
    url: Schema3.String,
    protocols: Schema3.Array(Schema3.String),
    close: Schema3.Struct({
      code: Schema3.Number,
      reason: Schema3.String
    })
  })),
  events: Schema3.Array(WebSocketEventSchema)
});

// src/cassette/model.ts
var JsonValueSchema = Schema4.suspend(() => Schema4.Union([
  Schema4.Null,
  Schema4.Boolean,
  Schema4.Number,
  Schema4.String,
  Schema4.Array(JsonValueSchema),
  Schema4.Record(Schema4.String, JsonValueSchema)
]));
var CassetteMetadataSchema = Schema4.Record(Schema4.String, JsonValueSchema);
var InteractionSchema = Schema4.Union([HttpInteractionSchema, WebSocketInteractionSchema]).pipe(Schema4.toTaggedUnion("transport"));
var isHttpInteraction = InteractionSchema.guards.http;
var isWebSocketInteraction = InteractionSchema.guards.websocket;
var httpInteractions = (interactions) => interactions.filter(isHttpInteraction);
var webSocketInteractions = (interactions) => interactions.filter(isWebSocketInteraction);
var CassetteSchema = Schema4.Struct({
  version: Schema4.Literal(1),
  metadata: Schema4.optional(CassetteMetadataSchema),
  interactions: Schema4.Array(InteractionSchema)
});
var decodeCassette = Schema4.decodeUnknownSync(CassetteSchema);
var encodeCassette = Schema4.encodeSync(CassetteSchema);

// src/cassette/store.ts
var DEFAULT_RECORDINGS_DIR = path.resolve(process.cwd(), "test", "fixtures", "recordings");

class CassetteNotFoundError extends Schema5.TaggedError()("CassetteNotFoundError", {
  cassetteName: Schema5.String
}) {
  get message() {
    return `Cassette "${this.cassetteName}" not found`;
  }
}

class InvalidCassetteError extends Schema5.TaggedError()("InvalidCassetteError", {
  cassetteName: Schema5.String,
  description: Schema5.String
}) {
  get message() {
    return `Cassette "${this.cassetteName}" is invalid: ${this.description}`;
  }
}

class UnsafeCassetteError extends Schema5.TaggedError()("UnsafeCassetteError", {
  cassetteName: Schema5.String,
  findings: Schema5.Array(SecretFindingSchema)
}) {
  get message() {
    return `Refusing to write cassette "${this.cassetteName}" because it contains possible secrets: ${this.findings.map((finding) => `${finding.path} (${finding.reason})`).join(", ")}`;
  }
}

class Service extends Context.Service()("effect-http-recorder/Cassette") {
}
var cassettePath = (directory, name) => {
  if (!name || path.isAbsolute(name) || path.win32.isAbsolute(name) || name.split(/[\\/]/).includes(".."))
    throw new Error(`Invalid cassette name "${name}"`);
  const root = path.resolve(directory);
  const target = path.resolve(root, `${name}.json`);
  const relative2 = path.relative(root, target);
  if (!relative2 || relative2.startsWith("..") || path.isAbsolute(relative2))
    throw new Error(`Invalid cassette name "${name}"`);
  return target;
};
var hasCassetteSync = (name, options = {}) => fs.existsSync(cassettePath(options.directory ?? DEFAULT_RECORDINGS_DIR, name));
var removeCassetteSync = (name, options = {}) => fs.rmSync(cassettePath(options.directory ?? DEFAULT_RECORDINGS_DIR, name), { force: true });
var buildCassette = (name, interactions, metadata) => ({
  version: 1,
  metadata: { ...metadata, name, recordedAt: new Date().toISOString() },
  interactions
});
var formatCassette = (cassette) => `${JSON.stringify(encodeCassette(cassette), null, 2)}
`;
var parseCassette = Schema5.decodeUnknownSync(Schema5.fromJsonString(CassetteSchema));
var invalidCassette = (name, error) => new InvalidCassetteError({
  cassetteName: name,
  description: error instanceof Error ? error.message : String(error)
});
var failIfUnsafe = (name, findings) => findings.length === 0 ? Effect.void : Effect.fail(new UnsafeCassetteError({ cassetteName: name, findings }));
var fileSystem = (options = {}) => Layer.effect(Service, Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = options.directory ?? DEFAULT_RECORDINGS_DIR;
  const recorded = new Map;
  const appendLock = yield* Semaphore.make(1);
  const pathFor = (name) => cassettePath(directory, name);
  const walk = (current) => Effect.gen(function* () {
    const entries = yield* fs.readDirectory(current).pipe(Effect.catch(() => Effect.succeed([])));
    const nested = yield* Effect.forEach(entries, (entry) => {
      const full = path.join(current, entry);
      return fs.stat(full).pipe(Effect.flatMap((stat) => stat.type === "Directory" ? walk(full) : Effect.succeed([full])), Effect.catch(() => Effect.succeed([])));
    });
    return nested.flat();
  });
  return Service.of({
    read: (name) => fs.readFileString(pathFor(name)).pipe(Effect.mapError((error) => error.reason._tag === "NotFound" ? new CassetteNotFoundError({ cassetteName: name }) : invalidCassette(name, error)), Effect.flatMap((raw) => Effect.try({
      try: () => parseCassette(raw).interactions,
      catch: (error) => invalidCassette(name, error)
    }))),
    append: (name, interaction, metadata) => appendLock.withPermit(Effect.gen(function* () {
      const entry = recorded.get(name) ?? {
        interactions: [],
        findings: []
      };
      const interactions = [...entry.interactions, interaction];
      const interactionFindings = [...entry.findings, ...secretFindings(interaction)];
      const cassette = buildCassette(name, interactions, metadata);
      const findings = [...interactionFindings, ...secretFindings(cassette.metadata ?? {})];
      yield* failIfUnsafe(name, findings);
      const target = pathFor(name);
      yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.orDie);
      const temporary = `${target}.${crypto.randomUUID()}.tmp`;
      yield* fs.writeFileString(temporary, formatCassette(cassette)).pipe(Effect.flatMap(() => fs.rename(temporary, target)), Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.catch(() => Effect.void))), Effect.orDie);
      recorded.set(name, {
        interactions,
        findings: interactionFindings
      });
    })),
    exists: (name) => fs.access(pathFor(name)).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false))),
    list: () => walk(directory).pipe(Effect.map((files) => files.filter((file) => file.endsWith(".json")).map((file) => path.relative(directory, file).replace(/\\/g, "/").replace(/\.json$/, "")).toSorted((a, b) => a.localeCompare(b))))
  });
}));

// src/http/recorder.ts
import { NodeFileSystem } from "@effect/platform-node-shared";
import { Deferred, Effect as Effect3, Layer as Layer2, Ref as Ref2 } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse
} from "effect/unstable/http";

// src/redaction/redactor.ts
import { Option, Schema as Schema6 } from "effect";
var REDACTED = "[REDACTED]";
var DEFAULT_REDACT_HEADERS = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "x-amz-security-token",
  "x-goog-api-key"
];
var DEFAULT_REDACT_QUERY = [
  "access_token",
  "api-key",
  "api_key",
  "apikey",
  "code",
  "key",
  "signature",
  "sig",
  "token",
  "x-amz-credential",
  "x-amz-security-token",
  "x-amz-signature"
];
var decodeJson = Schema6.decodeUnknownOption(Schema6.fromJsonString(Schema6.Unknown));
var redactionSet = (values, defaults) => new Set([...defaults, ...values ?? []].map((value) => value.toLowerCase()));
var redactUrl = (raw, query = DEFAULT_REDACT_QUERY, transform) => {
  if (!URL.canParse(raw))
    return transform?.(raw) ?? raw;
  const url = new URL(raw);
  if (url.username)
    url.username = REDACTED;
  if (url.password)
    url.password = REDACTED;
  const redacted = redactionSet(query, DEFAULT_REDACT_QUERY);
  for (const key of url.searchParams.keys()) {
    if (redacted.has(key.toLowerCase()))
      url.searchParams.set(key, REDACTED);
  }
  return transform?.(url.toString()) ?? url.toString();
};
var redactHeaders = (headers, allow, redact = DEFAULT_REDACT_HEADERS) => {
  const allowed = new Set(allow.map((name) => name.toLowerCase()));
  const redacted = redactionSet(redact, DEFAULT_REDACT_HEADERS);
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]).filter(([name]) => allowed.has(name)).map(([name, value]) => [name, redacted.has(name) ? REDACTED : value]).toSorted(([a], [b]) => a.localeCompare(b)));
};
var DEFAULT_REQUEST_HEADERS = ["content-type", "accept", "openai-beta"];
var DEFAULT_RESPONSE_HEADERS = ["content-type"];
var identity = (value) => value;
var compose = (...redactors) => {
  const requests = redactors.map((r) => r.request).filter((fn) => fn !== undefined);
  const responses = redactors.map((r) => r.response).filter((fn) => fn !== undefined);
  return {
    request: requests.length === 0 ? identity : (snapshot) => requests.reduce((acc, fn) => fn(acc), snapshot),
    response: responses.length === 0 ? identity : (snapshot) => responses.reduce((acc, fn) => fn(acc), snapshot)
  };
};
var requestHeaders = (options = {}) => ({
  request: (snapshot) => ({
    ...snapshot,
    headers: redactHeaders(snapshot.headers, options.allow ?? DEFAULT_REQUEST_HEADERS, options.redact)
  })
});
var responseHeaders = (options = {}) => ({
  response: (snapshot) => ({
    ...snapshot,
    headers: redactHeaders(snapshot.headers, options.allow ?? DEFAULT_RESPONSE_HEADERS, options.redact)
  })
});
var url = (options = {}) => ({
  request: (snapshot) => ({
    ...snapshot,
    url: redactUrl(snapshot.url, options.query, options.transform)
  })
});
var DEFAULT_REDACT_JSON_FIELDS = [
  "access_token",
  "api_key",
  "apikey",
  "client_secret",
  "password",
  "refresh_token",
  "secret",
  "token"
];
var normalizeField = (field) => field.replace(/[^a-z0-9]/gi, "").toLowerCase();
var redactJsonFields = (value, fields) => {
  if (Array.isArray(value)) {
    const items = value.map((item) => redactJsonFields(item, fields));
    return {
      value: items.map((item) => item.value),
      changed: items.some((item) => item.changed)
    };
  }
  if (!value || typeof value !== "object")
    return { value, changed: false };
  let changed = false;
  const entries = Object.entries(value).map(([key, child]) => {
    if (fields.has(normalizeField(key))) {
      if (child !== REDACTED)
        changed = true;
      return [key, REDACTED];
    }
    const redacted = redactJsonFields(child, fields);
    if (redacted.changed)
      changed = true;
    return [key, redacted.value];
  });
  return { value: Object.fromEntries(entries), changed };
};
var redactBody = (value, fields, transform) => {
  const redacted = Option.match(decodeJson(value), {
    onNone: () => value,
    onSome: (parsed) => {
      const redacted = redactJsonFields(parsed, fields);
      return redacted.changed ? JSON.stringify(redacted.value) : value;
    }
  });
  return transform?.(redacted) ?? redacted;
};
var make = (options = {}) => {
  const fields = new Set([...DEFAULT_REDACT_JSON_FIELDS, ...options.jsonFields ?? []].map(normalizeField));
  return compose(requestHeaders({
    allow: [...DEFAULT_REQUEST_HEADERS, ...options.allowRequestHeaders ?? [], ...options.headers ?? []],
    redact: options.headers
  }), responseHeaders({
    allow: [...DEFAULT_RESPONSE_HEADERS, ...options.allowResponseHeaders ?? [], ...options.headers ?? []],
    redact: options.headers
  }), url({ query: options.queryParameters, transform: options.url }), {
    request: (snapshot) => ({
      ...snapshot,
      body: redactBody(snapshot.body, fields, options.body)
    }),
    response: (snapshot) => ({
      ...snapshot,
      body: redactBody(snapshot.body, fields, options.body)
    })
  });
};

// src/replay/state.ts
import { Effect as Effect2, Exit, HashSet, Ref, SynchronizedRef } from "effect";
var isCI = () => {
  const value = process.env.CI;
  return value !== undefined && value !== "" && value !== "false" && value !== "0";
};
var resolveAutoMode = (cassette, name) => Effect2.gen(function* () {
  if (isCI())
    return "replay";
  return (yield* cassette.exists(name)) ? "replay" : "record";
});
var makeReplayPoolState = (cassette, name, project) => Effect2.gen(function* () {
  const load = yield* Effect2.cached(cassette.read(name).pipe(Effect2.map(project)));
  const claimed = yield* SynchronizedRef.make(HashSet.empty());
  const attempted = yield* Ref.make(false);
  yield* Effect2.addFinalizer((exit) => Exit.isFailure(exit) ? Effect2.void : Effect2.gen(function* () {
    const used = yield* SynchronizedRef.get(claimed);
    if (HashSet.isEmpty(used) && (yield* Ref.get(attempted)))
      return yield* Effect2.void;
    const interactions = yield* load.pipe(Effect2.catchTag("CassetteNotFoundError", () => Effect2.succeed([])), Effect2.orDie);
    if (HashSet.size(used) < interactions.length)
      return yield* Effect2.die(new Error(`Unused recorded interactions in ${name}: used ${HashSet.size(used)} of ${interactions.length}`));
    return yield* Effect2.void;
  }));
  return {
    claim: (select) => Ref.set(attempted, true).pipe(Effect2.andThen(load), Effect2.flatMap((interactions) => SynchronizedRef.modifyEffect(claimed, (used) => Effect2.gen(function* () {
      const index = yield* select(interactions, used);
      const interaction = interactions[index];
      if (interaction === undefined || HashSet.has(used, index))
        return yield* Effect2.die("Replay selected an unavailable interaction");
      return [{ interaction, index }, HashSet.add(used, index)];
    }))))
  };
});
var makeReplayState = (cassette, name, project) => makeReplayPoolState(cassette, name, project).pipe(Effect2.map((pool) => ({
  claim: (validate) => pool.claim((interactions, used) => {
    const index = HashSet.size(used);
    return validate(interactions[index], index, interactions).pipe(Effect2.as(index));
  })
})));

// src/http/matching.ts
import { HashSet as HashSet2, Option as Option3 } from "effect";

// src/replay/comparison.ts
import { Option as Option2, Schema as Schema7 } from "effect";
var decodeJson2 = Schema7.decodeUnknownOption(Schema7.fromJsonString(Schema7.Unknown));
var isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var canonicalizeJson = (value) => {
  if (Array.isArray(value))
    return value.map(canonicalizeJson);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).toSorted().map((key) => [key, canonicalizeJson(value[key])]));
  }
  return value;
};
var safeText = (value) => {
  if (value === undefined)
    return "undefined";
  if (secretFindings(value).length > 0)
    return JSON.stringify(REDACTED);
  const text = JSON.stringify(value);
  if (!text)
    return typeof value;
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
};
var jsonBody = (body) => Option2.getOrUndefined(decodeJson2(body));
var isJsonRecord = isRecord;

// src/http/matching.ts
var canonicalSnapshot = (snapshot) => JSON.stringify({
  method: snapshot.method,
  url: snapshot.url,
  headers: canonicalizeJson(snapshot.headers),
  body: Option3.match(decodeJson2(snapshot.body), {
    onNone: () => snapshot.body,
    onSome: canonicalizeJson
  })
});
var defaultMatcher = (incoming, recorded) => canonicalSnapshot(incoming) === canonicalSnapshot(recorded);
var valueDiffs = (expected, received, base = "$", limit = 8) => {
  if (Object.is(expected, received))
    return [];
  if (isJsonRecord(expected) && isJsonRecord(received)) {
    return [...new Set([...Object.keys(expected), ...Object.keys(received)])].toSorted().flatMap((key) => valueDiffs(expected[key], received[key], `${base}.${key}`, limit)).slice(0, limit);
  }
  if (Array.isArray(expected) && Array.isArray(received)) {
    return Array.from({ length: Math.max(expected.length, received.length) }, (_, index) => index).flatMap((index) => valueDiffs(expected[index], received[index], `${base}[${index}]`, limit)).slice(0, limit);
  }
  return [`${base} expected ${safeText(expected)}, received ${safeText(received)}`];
};
var headerDiffs = (expected, received) => [...new Set([...Object.keys(expected), ...Object.keys(received)])].toSorted().flatMap((key) => {
  if (expected[key] === received[key])
    return [];
  if (expected[key] === undefined)
    return [`  ${key} unexpected ${safeText(received[key])}`];
  if (received[key] === undefined)
    return [`  ${key} missing expected ${safeText(expected[key])}`];
  return [`  ${key} expected ${safeText(expected[key])}, received ${safeText(received[key])}`];
});
var requestDiff = (expected, received) => {
  const lines = [];
  if (expected.method !== received.method) {
    lines.push("method:", `  expected ${expected.method}, received ${received.method}`);
  }
  if (expected.url !== received.url) {
    lines.push("url:", `  expected ${expected.url}`, `  received ${received.url}`);
  }
  const headers = headerDiffs(expected.headers, received.headers);
  if (headers.length > 0)
    lines.push("headers:", ...headers.slice(0, 8));
  const expectedBody = jsonBody(expected.body);
  const receivedBody = jsonBody(received.body);
  const body = expectedBody !== undefined && receivedBody !== undefined ? valueDiffs(expectedBody, receivedBody).map((line) => `  ${line}`) : expected.body === received.body ? [] : [`  expected ${safeText(expected.body)}, received ${safeText(received.body)}`];
  if (body.length > 0)
    lines.push("body:", ...body);
  return lines;
};
var selectFirstMatching = (interactions, incoming, match, used) => {
  let firstUnused;
  for (let index = 0;index < interactions.length; index++) {
    if (HashSet2.has(used, index))
      continue;
    const interaction = interactions[index];
    firstUnused ??= interaction;
    if (match(incoming, interaction.request))
      return { _tag: "Matched", index };
  }
  if (firstUnused === undefined)
    return { _tag: "Unmatched", detail: `all ${interactions.length} recorded interactions have already been consumed` };
  return {
    _tag: "Unmatched",
    detail: requestDiff(firstUnused.request, incoming).join(`
`)
  };
};

// src/http/recorder.ts
var TEXT_CONTENT_TYPES = new Set([
  "application/graphql",
  "application/javascript",
  "application/json",
  "application/sql",
  "application/x-www-form-urlencoded",
  "application/xml",
  "application/yaml",
  "image/svg+xml"
]);
var isTextContentType = (contentType) => {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mediaType)
    return false;
  return mediaType.startsWith("text/") || mediaType.endsWith("+json") || mediaType.endsWith("+xml") || TEXT_CONTENT_TYPES.has(mediaType);
};
var captureResponseBody = (response, contentType) => response.arrayBuffer.pipe(Effect3.map((bytes) => isTextContentType(contentType) ? { body: new TextDecoder().decode(bytes) } : {
  body: Buffer.from(bytes).toString("base64"),
  bodyEncoding: "base64"
}));
var decodeResponseBody = (snapshot) => snapshot.bodyEncoding === "base64" ? Buffer.from(snapshot.body, "base64") : snapshot.body;
var responseFromSnapshot = (request, snapshot) => HttpClientResponse.fromWeb(request, new Response(request.method === "HEAD" || snapshot.status === 204 || snapshot.status === 205 || snapshot.status === 304 ? null : decodeResponseBody(snapshot), snapshot));
var redactedErrorRequest = (request, redactedUrl = redactUrl(request.url)) => HttpClientRequest.make(request.method)(redactedUrl);
var transportError = (request, description, redactedUrl) => new HttpClientError.HttpClientError({
  reason: new HttpClientError.TransportError({
    request: redactedErrorRequest(request, redactedUrl),
    description
  })
});
var recordingLayer = (name, options = {}) => Layer2.effect(HttpClient.HttpClient, Effect3.gen(function* () {
  const upstream = yield* HttpClient.HttpClient;
  const cassetteService = yield* Service;
  const redactor = options.redactor ?? make();
  const match = options.match ?? defaultMatcher;
  const requested = options.mode ?? "auto";
  const mode = requested === "auto" ? yield* resolveAutoMode(cassetteService, name) : requested;
  const snapshotRequest = (request) => Effect3.gen(function* () {
    const web = yield* HttpClientRequest.toWeb(request).pipe(Effect3.orDie);
    return redactor.request({
      method: web.method,
      url: web.url,
      headers: Object.fromEntries(web.headers.entries()),
      body: yield* Effect3.promise(() => web.text())
    });
  });
  if (mode === "passthrough")
    return upstream;
  if (mode === "record") {
    const initial = yield* Deferred.make();
    yield* Deferred.succeed(initial, undefined);
    const tail = yield* Ref2.make(initial);
    return HttpClient.make((request) => Effect3.gen(function* () {
      const completed = yield* Deferred.make();
      const previous = yield* Ref2.modify(tail, (current) => [current, completed]);
      return yield* Effect3.gen(function* () {
        const incoming = yield* snapshotRequest(request);
        const requestError = (description) => transportError(request, description, incoming.url);
        const response = yield* upstream.execute(request);
        const captured = yield* captureResponseBody(response, response.headers["content-type"]);
        const responseSnapshot = {
          status: response.status,
          headers: response.headers,
          ...captured
        };
        const interaction = {
          transport: "http",
          request: incoming,
          response: redactor.response(responseSnapshot)
        };
        yield* Deferred.await(previous);
        yield* cassetteService.append(name, interaction, options.metadata).pipe(Effect3.catchTag("UnsafeCassetteError", (error) => Effect3.fail(requestError(error.message))));
        return responseFromSnapshot(request, responseSnapshot);
      }).pipe(Effect3.ensuring(Deferred.succeed(completed, undefined)));
    }));
  }
  const replay = yield* makeReplayPoolState(cassetteService, name, httpInteractions);
  return HttpClient.make((request) => Effect3.gen(function* () {
    const incoming = yield* snapshotRequest(request);
    const requestError = (description) => transportError(request, description, incoming.url);
    const claimed = yield* replay.claim((interactions, used) => {
      const result = selectFirstMatching(interactions, incoming, match, used);
      if (result._tag === "Matched")
        return Effect3.succeed(result.index);
      return Effect3.fail(requestError(`Fixture "${name}" does not match the current request: ${result.detail}.`));
    }).pipe(Effect3.mapError((error) => error._tag === "CassetteNotFoundError" ? requestError(`Fixture "${name}" not found. Run locally to record it (CI=true forces replay).`) : requestError(error.message)));
    return responseFromSnapshot(request, claimed.interaction.response);
  }));
}));
var layer = (name, options = {}) => recordingLayer(name, {
  metadata: options.metadata,
  redactor: make(options.redact),
  match: options.match
}).pipe(Layer2.provide(fileSystem({ directory: options.directory })), Layer2.provide(NodeFileSystem.layer));
var layerFetch = (name, options = {}) => layer(name, options).pipe(Layer2.provide(FetchHttpClient.layer));

// src/websocket/recorder.ts
import { NodeFileSystem as NodeFileSystem2 } from "@effect/platform-node-shared";
import { Deferred as Deferred2, Effect as Effect4, Exit as Exit2, FiberSet, Layer as Layer3, Option as Option4, Ref as Ref3, Semaphore as Semaphore2 } from "effect";
import { Socket } from "effect/unstable/socket";
var normalizeProtocols = (protocols) => protocols === undefined ? [] : typeof protocols === "string" ? [protocols] : [...protocols];
var frameFromWebSocketData = async (data) => {
  if (typeof data === "string")
    return data;
  if (data instanceof Blob)
    return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer)
    return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  throw new Error(`Unsupported WebSocket frame: ${Object.prototype.toString.call(data)}`);
};
var closeEvent = (code, reason) => {
  if (typeof globalThis.CloseEvent === "function")
    return new globalThis.CloseEvent("close", { code, reason, wasClean: code === 1000 });
  const event = new Event("close");
  Object.defineProperties(event, {
    code: { value: code },
    reason: { value: reason },
    wasClean: { value: code === 1000 }
  });
  return event;
};
var errorEvent = (error) => {
  if (typeof globalThis.ErrorEvent === "function")
    return new globalThis.ErrorEvent("error", {
      error,
      message: error instanceof Error ? error.message : String(error)
    });
  const event = new Event("error");
  Object.defineProperties(event, {
    error: { value: error },
    message: { value: error instanceof Error ? error.message : String(error) }
  });
  return event;
};
var webSocketFacade = (target, properties) => {
  Object.defineProperties(target, {
    url: { get: properties.url },
    readyState: { get: properties.readyState },
    protocol: { get: properties.protocol },
    extensions: { get: properties.extensions },
    bufferedAmount: { get: properties.bufferedAmount },
    binaryType: { value: "blob", writable: true },
    send: { value: properties.send },
    close: { value: properties.close },
    CONNECTING: { value: 0 },
    OPEN: { value: 1 },
    CLOSING: { value: 2 },
    CLOSED: { value: 3 }
  });
  for (const name of ["open", "message", "error", "close"]) {
    let handler = null;
    Object.defineProperty(target, `on${name}`, {
      get: () => handler,
      set: (next) => {
        if (handler)
          target.removeEventListener(name, handler);
        handler = typeof next === "function" ? next : null;
        if (handler)
          target.addEventListener(name, handler);
      }
    });
  }
  return target;
};
var encodeEvent = (direction, message) => typeof message === "string" ? { direction, kind: "text", body: message } : {
  direction,
  kind: "binary",
  body: Buffer.from(message).toString("base64"),
  bodyEncoding: "base64"
};
var decodeEvent = (event) => event.kind === "text" ? event.body : new Uint8Array(Buffer.from(event.body, "base64"));
var redactEvent = (event, redactor) => {
  if (event.kind === "binary")
    return event;
  const body = event.direction === "client" ? redactor.request({
    method: "WEBSOCKET",
    url: "",
    headers: {},
    body: event.body
  }).body : redactor.response({ status: 101, headers: {}, body: event.body }).body;
  return { ...event, body };
};
var comparable = (event, asJson) => {
  if (!asJson || event.kind === "binary")
    return JSON.stringify(canonicalizeJson(event));
  const decoded = decodeJson2(event.body);
  return JSON.stringify(canonicalizeJson({
    ...event,
    body: decoded._tag === "None" ? event.body : canonicalizeJson(decoded.value)
  }));
};
var assertEvent = (actual, expected, index, asJson) => Effect4.sync(() => {
  if (expected && comparable(actual, asJson) === comparable(expected, asJson))
    return;
  throw new Error(`WebSocket event ${index + 1}: expected ${safeText(expected)}, received ${safeText(actual)}`);
});
var runHandler = (handler, value) => Effect4.suspend(() => {
  const result = handler(value);
  return Effect4.isEffect(result) ? Effect4.asVoid(result) : Effect4.void;
});
var runReplay = (state, handler, decode, onOpen) => Effect4.scoped(Effect4.gen(function* () {
  const handlers = yield* FiberSet.make();
  const run = yield* FiberSet.runtime(handlers)();
  if (onOpen)
    yield* onOpen;
  const drive = Effect4.gen(function* () {
    while (true) {
      const current = yield* Ref3.get(state.progress);
      const event = state.interaction.events[current.position];
      if (!event)
        return;
      if (yield* Ref3.get(state.closed))
        return yield* Effect4.die(new Error(`WebSocket closed with unconsumed events: used ${current.position} of ${state.interaction.events.length}`));
      if (event.direction === "server") {
        yield* Ref3.set(state.progress, {
          position: current.position + 1,
          changed: yield* Deferred2.make()
        });
        run(runHandler(handler, decode(event)));
        continue;
      }
      yield* Deferred2.await(current.changed);
    }
  });
  yield* drive.pipe(Effect4.raceFirst(FiberSet.join(handlers)));
  yield* FiberSet.awaitEmpty(handlers).pipe(Effect4.raceFirst(FiberSet.join(handlers)));
}));
var makeRecordingSocket = (upstream, cassette, name, options, redactor) => Effect4.gen(function* () {
  const active = yield* Ref3.make(undefined);
  const writeLock = yield* Semaphore2.make(1);
  return Socket.make({
    runRaw: (handler, runOptions) => Effect4.gen(function* () {
      const state = {
        events: [],
        eventLock: yield* Semaphore2.make(1),
        accepting: yield* Ref3.make(true),
        opened: false,
        valid: true
      };
      const occupied = yield* Ref3.modify(active, (current) => [current !== undefined, current ?? state]);
      if (occupied)
        return yield* Effect4.die("Concurrent runs of a recorded WebSocket are not supported");
      yield* upstream.runRaw((message) => {
        if (!Ref3.getUnsafe(state.accepting))
          throw new Error("WebSocket received a frame after closing");
        state.events.push(redactEvent(encodeEvent("server", message), redactor));
        return handler(message);
      }, {
        ...runOptions,
        onOpen: Effect4.gen(function* () {
          state.opened = true;
          if (runOptions?.onOpen)
            yield* runOptions.onOpen;
        })
      }).pipe(Effect4.onExit((exit) => writeLock.withPermit(state.eventLock.withPermit(Effect4.gen(function* () {
        yield* Ref3.set(state.accepting, false);
        yield* Ref3.set(active, undefined);
        if (!Exit2.isSuccess(exit) || !state.opened || !state.valid)
          return;
        yield* cassette.append(name, {
          transport: "websocket",
          events: [...state.events]
        }, options.metadata).pipe(Effect4.orDie);
      })))));
    }),
    writer: upstream.writer.pipe(Effect4.map((write) => (message) => writeLock.withPermit(Effect4.gen(function* () {
      if (Socket.isCloseEvent(message))
        return yield* write(message);
      const state = yield* Ref3.get(active);
      if (!state || !(yield* Ref3.get(state.accepting)))
        return yield* Effect4.die("WebSocket writer used without an active socket run");
      const event = redactEvent(encodeEvent("client", message), redactor);
      yield* state.eventLock.withPermit(Effect4.sync(() => state.events.push(event)));
      return yield* write(message).pipe(Effect4.onError(() => Effect4.sync(() => state.valid = false)));
    }))))
  });
});
var makeReplaySocket = (cassette, name, options, redactor) => Effect4.gen(function* () {
  const replay = yield* makeReplayState(cassette, name, webSocketInteractions);
  const active = yield* Ref3.make(undefined);
  const runLock = yield* Semaphore2.make(1);
  return Socket.make({
    runRaw: (handler, runOptions) => runLock.withPermitsIfAvailable(1)(Effect4.gen(function* () {
      const claimed = yield* replay.claim((interaction) => interaction ? Effect4.void : Effect4.die("Missing recorded WebSocket interaction")).pipe(Effect4.orDie);
      const state = {
        interaction: claimed.interaction,
        progress: yield* Ref3.make({
          position: 0,
          changed: yield* Deferred2.make()
        }),
        writeLock: yield* Semaphore2.make(1),
        closed: yield* Ref3.make(false)
      };
      yield* Ref3.set(active, state);
      yield* runReplay(state, handler, decodeEvent, runOptions?.onOpen).pipe(Effect4.ensuring(Ref3.set(active, undefined)));
    })).pipe(Effect4.flatMap(Option4.match({
      onNone: () => Effect4.die("Concurrent runs of a replayed WebSocket are not supported"),
      onSome: () => Effect4.void
    }))),
    writer: Effect4.succeed((message) => {
      return Ref3.get(active).pipe(Effect4.flatMap((state) => state ? state.writeLock.withPermit(Effect4.gen(function* () {
        const current = yield* Ref3.get(state.progress);
        if (Socket.isCloseEvent(message)) {
          yield* Ref3.set(state.closed, true);
          yield* Deferred2.succeed(current.changed, undefined);
          if (current.position === state.interaction.events.length)
            return;
          return yield* Effect4.die(new Error(`WebSocket closed with unconsumed events: used ${current.position} of ${state.interaction.events.length}`));
        }
        const actual = redactEvent(encodeEvent("client", message), redactor);
        yield* assertEvent(actual, state.interaction.events[current.position], current.position, options.compareClientMessagesAsJson === true);
        yield* Ref3.set(state.progress, {
          position: current.position + 1,
          changed: yield* Deferred2.make()
        });
        yield* Deferred2.succeed(current.changed, undefined);
      })) : Effect4.die("WebSocket writer used without an active socket run")));
    })
  });
});
var recordingLayer2 = (name, options, forcedMode) => Layer3.effect(Socket.Socket, Effect4.gen(function* () {
  const upstream = yield* Socket.Socket;
  const cassette = yield* Service;
  const redactor = make(options.redact);
  if ((forcedMode ?? (yield* resolveAutoMode(cassette, name))) === "record")
    return yield* makeRecordingSocket(upstream, cassette, name, options, redactor);
  return yield* makeReplaySocket(cassette, name, options, redactor);
}));
var layerSocket = (name, options = {}) => provideCassette(recordingLayer2(name, { ...options, compareClientMessagesAsJson: true }), options);
var provideCassette = (layer, options) => layer.pipe(Layer3.provide(fileSystem({ directory: options.directory })), Layer3.provide(NodeFileSystem2.layer));
var makeRecordingWebSocketConstructor = (upstream, cassette, name, metadata, redactor, pending) => {
  let nextSequence = 0;
  return (url, protocols) => {
    const sequence = nextSequence++;
    const requestedProtocols = normalizeProtocols(protocols);
    const native = upstream(url, requestedProtocols);
    const events = [];
    let opened = false;
    let failed = false;
    let closed = false;
    let queue = Promise.resolve();
    const appendEvent = (direction, data) => {
      queue = queue.then(async () => {
        if (failed || closed)
          return;
        try {
          events.push(redactEvent(encodeEvent(direction, await frameFromWebSocketData(data)), redactor));
        } catch {
          failed = true;
        }
      });
    };
    const onOpen = () => {
      opened = true;
    };
    const onMessage = (event) => {
      appendEvent("server", event.data);
    };
    const onError = () => {
      failed = true;
    };
    const onClose = (event) => {
      native.removeEventListener("open", onOpen);
      native.removeEventListener("message", onMessage);
      native.removeEventListener("error", onError);
      native.removeEventListener("close", onClose);
      const completion = queue.then(async () => {
        closed = true;
        if (opened && !failed) {
          const request = redactor.request({ method: "WEBSOCKET", url, headers: {}, body: "" });
          const interaction = {
            transport: "websocket",
            connection: {
              sequence,
              url: request.url,
              protocols: requestedProtocols,
              close: { code: event.code, reason: event.reason }
            },
            events: [...events]
          };
          events.length = 0;
          await Effect4.runPromise(cassette.append(name, interaction, metadata).pipe(Effect4.orDie));
        }
      });
      pending.promises.add(completion);
      completion.then(() => pending.promises.delete(completion), (error) => {
        pending.promises.delete(completion);
        pending.errors.push(error);
      });
    };
    native.addEventListener("open", onOpen);
    native.addEventListener("message", onMessage);
    native.addEventListener("error", onError);
    native.addEventListener("close", onClose);
    return new Proxy(native, {
      get: (target, property) => {
        if (property === "send")
          return (data) => {
            target.send(data);
            appendEvent("client", data);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set: (target, property, value) => Reflect.set(target, property, value, target)
    });
  };
};
var constructorWebSocketInteractions = (interactions) => webSocketInteractions(interactions).filter((interaction) => interaction.connection !== undefined).map((interaction, index) => ({ interaction, index })).toSorted((a, b) => a.interaction.connection.sequence - b.interaction.connection.sequence).map(({ interaction }) => interaction);
var makeReplayWebSocketConstructor = (cassette, name, redactor) => Effect4.gen(function* () {
  const replay = yield* makeReplayState(cassette, name, constructorWebSocketInteractions);
  return (url, protocols) => {
    const target = new EventTarget;
    const requestedProtocols = normalizeProtocols(protocols);
    const request = redactor.request({ method: "WEBSOCKET", url, headers: {}, body: "" });
    let readyState = 0;
    let interaction;
    let position = 0;
    let finished = false;
    let closeRequested = false;
    let operations = Promise.resolve();
    const fail = (error) => {
      if (finished)
        return;
      finished = true;
      readyState = 3;
      target.dispatchEvent(errorEvent(error));
    };
    const finish = () => {
      if (finished || !interaction || position !== interaction.events.length)
        return;
      finished = true;
      readyState = 3;
      const terminal = interaction.connection?.close ?? { code: 1000, reason: "" };
      target.dispatchEvent(closeEvent(terminal.code, terminal.reason));
    };
    const drive = () => {
      if (!interaction || finished)
        return;
      while (interaction.events[position]?.direction === "server") {
        const event = interaction.events[position++];
        if (!event)
          break;
        target.dispatchEvent(new MessageEvent("message", { data: decodeEvent(event) }));
      }
      if (position === interaction.events.length)
        setTimeout(finish, 0);
    };
    Effect4.runPromise(replay.claim((recorded, index) => Effect4.sync(() => {
      if (!recorded)
        throw new Error(`Missing recorded WebSocket connection ${index + 1}`);
      const connection = recorded.connection;
      if (!connection)
        throw new Error(`WebSocket interaction ${index + 1} has no connection metadata`);
      if (connection.url !== request.url)
        throw new Error(`WebSocket connection ${index + 1}: expected URL ${safeText(connection.url)}, received ${safeText(request.url)}`);
      if (connection.protocols.length !== requestedProtocols.length || connection.protocols.some((protocol, protocolIndex) => protocol !== requestedProtocols[protocolIndex]))
        throw new Error(`WebSocket connection ${index + 1}: expected protocols ${safeText(connection.protocols)}, received ${safeText(requestedProtocols)}`);
    })).pipe(Effect4.orDie)).then((claimed) => {
      if (closeRequested)
        return fail(new Error("WebSocket closed before it opened"));
      interaction = claimed.interaction;
      readyState = 1;
      target.dispatchEvent(new Event("open"));
      drive();
    }, fail);
    return webSocketFacade(target, {
      url: () => url,
      readyState: () => readyState,
      protocol: () => requestedProtocols[0] ?? "",
      extensions: () => "",
      bufferedAmount: () => 0,
      send: (data) => {
        if (!interaction || readyState !== 1 || closeRequested)
          throw new Error("WebSocket is not open");
        operations = operations.then(async () => {
          try {
            const frame = await frameFromWebSocketData(data);
            const actual = redactEvent(encodeEvent("client", frame), redactor);
            const expected = interaction?.events[position];
            Effect4.runSync(assertEvent(actual, expected, position, true));
            position += 1;
            drive();
          } catch (error) {
            fail(error);
          }
        });
      },
      close: () => {
        if (closeRequested || readyState === 3)
          return;
        closeRequested = true;
        readyState = 2;
        operations = operations.then(() => {
          if (!interaction)
            return;
          if (position !== interaction.events.length)
            return fail(new Error(`WebSocket closed with unconsumed events: used ${position} of ${interaction.events.length}`));
          finish();
        });
      }
    });
  };
});
var layerWebSocketConstructor = (name, options = {}) => provideCassette(Layer3.effect(Socket.WebSocketConstructor, Effect4.gen(function* () {
  const upstream = yield* Socket.WebSocketConstructor;
  const cassette = yield* Service;
  const redactor = make(options.redact);
  if ((yield* resolveAutoMode(cassette, name)) === "replay")
    return yield* makeReplayWebSocketConstructor(cassette, name, redactor);
  const pending = { promises: new Set, errors: [] };
  yield* Effect4.addFinalizer(() => Effect4.promise(() => Promise.all(pending.promises)).pipe(Effect4.flatMap(() => pending.errors.length === 0 ? Effect4.void : Effect4.die(pending.errors[0]))));
  return makeRecordingWebSocketConstructor(upstream, cassette, name, options.metadata, redactor, pending);
})), options);

// src/index.ts
var HttpRecorder = { hasCassetteSync, layer, layerFetch, layerSocket, layerWebSocketConstructor, removeCassetteSync };
export {
  HttpRecorder
};
