var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/cassette/store.ts
var exports_store = {};
__export(exports_store, {
  CassetteNotFoundError: () => CassetteNotFoundError,
  InvalidCassetteError: () => InvalidCassetteError,
  MissingRecordedAtError: () => MissingRecordedAtError,
  Service: () => Service,
  UnsafeCassetteError: () => UnsafeCassetteError,
  fileSystem: () => fileSystem,
  hasCassette: () => hasCassette,
  memory: () => memory,
  readCassette: () => readCassette,
  recordedAt: () => recordedAt,
  removeCassette: () => removeCassette
});
import { NodeFileSystem, NodePath } from "@effect/platform-node-shared";
import {
  Context,
  DateTime,
  Effect as Effect3,
  FileSystem,
  Layer,
  Match as Match2,
  Option,
  Path,
  Schema as Schema5,
  Semaphore
} from "effect";

// src/redaction/secrets.ts
import { ConfigProvider, Effect, Encoding, Match, Result, Schema } from "effect";
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
var configuredSecrets = Effect.gen(function* () {
  const provider = yield* ConfigProvider.ConfigProvider;
  const values = {};
  const paths = [[]];
  while (paths.length > 0) {
    const path = paths.pop();
    if (path === undefined)
      break;
    const node = yield* provider.load(path);
    if (node === undefined)
      continue;
    const name = path.join("_");
    if (node.value !== undefined && ENV_SECRET_NAMES.test(name)) {
      values[JSON.stringify(path)] = node.value;
    }
    Match.value(node).pipe(Match.tagsExhaustive({
      Record: (record) => {
        for (const key of record.keys)
          paths.push([...path, key]);
      },
      Array: (array) => {
        for (let index = 0;index < array.length; index++)
          paths.push([...path, index]);
      },
      Value: () => {}
    }));
  }
  return values;
});
var envSecrets = (env) => Object.entries(env).flatMap(([name, value]) => {
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
    const entries = Object.entries(value).flatMap(([key, child]) => stringEntries(child, pathFor(base, key)));
    if ("bodyEncoding" in value && value.bodyEncoding === "base64" && "body" in value && typeof value.body === "string") {
      const decoded = Encoding.decodeBase64String(value.body);
      if (Result.isSuccess(decoded))
        entries.push({ path: pathFor(base, "body"), value: decoded.success });
    }
    return entries;
  }
  return [];
};
var SecretFindingSchema = Schema.Struct({
  path: Schema.String,
  reason: Schema.String
});
var secretFindings = (value, env = {}) => {
  const environment = envSecrets(env);
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
import { Effect as Effect2, Schema as Schema4 } from "effect";

// src/http/model.ts
import { Encoding as Encoding2, Result as Result2, Schema as Schema2 } from "effect";
var RequestSnapshotSchema = Schema2.Struct({
  method: Schema2.String,
  url: Schema2.String,
  headers: Schema2.Record(Schema2.String, Schema2.String),
  body: Schema2.String
});
var ResponseSnapshotSchema = Schema2.Struct({
  status: Schema2.Number.check(Schema2.isInt(), Schema2.isBetween({ minimum: 200, maximum: 599 })),
  headers: Schema2.Record(Schema2.String, Schema2.String),
  body: Schema2.String,
  bodyEncoding: Schema2.optional(Schema2.Literals(["text", "base64"]))
}).check(Schema2.makeFilter((snapshot) => snapshot.bodyEncoding !== "base64" || Result2.isSuccess(Encoding2.decodeBase64(snapshot.body)), { message: "Invalid base64 response body" }));
var HttpInteractionSchema = Schema2.Struct({
  transport: Schema2.tag("http"),
  request: RequestSnapshotSchema,
  response: ResponseSnapshotSchema
});

// src/websocket/model.ts
import { Encoding as Encoding3, Result as Result3, Schema as Schema3 } from "effect";
var WebSocketEventSchema = Schema3.Union([
  Schema3.Struct({
    direction: Schema3.Literals(["client", "server"]),
    kind: Schema3.tag("text"),
    body: Schema3.String
  }),
  Schema3.Struct({
    direction: Schema3.Literals(["client", "server"]),
    kind: Schema3.tag("binary"),
    body: Schema3.String.check(Schema3.makeFilter((body) => Result3.isSuccess(Encoding3.decodeBase64(body)), { message: "Invalid base64 frame" })),
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
  metadata: Schema4.optionalKey(CassetteMetadataSchema),
  interactions: Schema4.Array(InteractionSchema)
});
var decodeCassette = Schema4.decodeUnknownEffect(CassetteSchema);
var encodeCassette = Schema4.encodeEffect(CassetteSchema);
var RecordedAt = Schema4.DateTimeUtcFromString;

class MissingRecordedAtError extends Schema4.TaggedError()("MissingRecordedAtError", {
  cassetteName: Schema4.String
}) {
  get message() {
    return `Cassette "${this.cassetteName}" does not have a recordedAt timestamp. Re-record the cassette to enable clock anchoring.`;
  }
}
var decodeRecordedAt = Schema4.decodeUnknownEffect(Schema4.Struct({ recordedAt: Schema4.OptionFromOptionalKey(RecordedAt) }));
var getRecordedAt = Effect2.fn("Cassette.getRecordedAt")(function* (cassette) {
  const metadata = yield* decodeRecordedAt(cassette.metadata ?? {});
  return metadata.recordedAt;
});

// src/cassette/store.ts
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
var invalidCassette = (name, error) => new InvalidCassetteError({
  cassetteName: name,
  description: error instanceof Error ? error.message : String(error)
});
var validateCassetteName = Effect3.fn("Cassette.validateName")(function* (name) {
  if (!name || name.includes("\x00") || name.startsWith("/") || name.startsWith("\\") || /^[a-zA-Z]:/.test(name) || name.split(/[\\/]/).includes("..")) {
    return yield* Effect3.fail(invalidCassette(name, `Invalid cassette name "${name}"`));
  }
});
var cassettePath = Effect3.fn("Cassette.path")(function* (path, directory, name) {
  yield* validateCassetteName(name);
  const target = path.resolve(directory, `${name}.json`);
  const relative = path.relative(directory, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return yield* Effect3.fail(invalidCassette(name, `Invalid cassette name "${name}"`));
  }
  return target;
});
var parseCassette = Schema5.decodeUnknownEffect(Schema5.fromJsonString(CassetteSchema));
var formatCassette = (cassette) => encodeCassette(cassette).pipe(Effect3.map((encoded) => `${JSON.stringify(encoded, null, 2)}
`));
var buildCassette = (name, interactions, metadata, recordedAt2) => ({
  version: 1,
  metadata: { ...metadata, name, recordedAt: recordedAt2 },
  interactions
});
var validateRecordedAt = (name, cassette) => getRecordedAt(cassette).pipe(Effect3.mapError((error) => invalidCassette(name, error)));
var cassetteRecordedAt = Effect3.fn("Cassette.timestamp")(function* (name, cassette) {
  const at = yield* validateRecordedAt(name, cassette);
  return yield* Option.match(at, {
    onNone: () => Effect3.fail(new MissingRecordedAtError({ cassetteName: name })),
    onSome: Effect3.succeed
  });
});
var catchMissingOrInvalid = (name) => (error) => Match2.value(error.reason).pipe(Match2.tag("NotFound", () => Effect3.fail(new CassetteNotFoundError({ cassetteName: name }))), Match2.orElse(() => Effect3.fail(invalidCassette(name, error))));
var ignoreMissing = (name) => (error) => Match2.value(error.reason).pipe(Match2.tag("NotFound", () => Effect3.void), Match2.orElse(() => Effect3.fail(invalidCassette(name, error))));
var failIfUnsafe = (name, findings) => findings.length === 0 ? Effect3.void : Effect3.fail(new UnsafeCassetteError({ cassetteName: name, findings }));
var fileSystem = (options = {}) => Layer.effect(Service, Effect3.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.resolve(options.directory ?? "test/fixtures/recordings");
  const recorded = new Map;
  const lock = yield* Semaphore.make(1);
  const pathFor = (name) => cassettePath(path, directory, name);
  const walk = Effect3.fn("Cassette.walk")(function* (current) {
    const entries = yield* fs.readDirectory(current);
    const nested = yield* Effect3.forEach(entries, (entry) => {
      const full = path.join(current, entry);
      return fs.stat(full).pipe(Effect3.flatMap((stat) => stat.type === "Directory" ? walk(full) : Effect3.succeed([full])));
    });
    return nested.flat();
  });
  const readCassette2 = Effect3.fn("Cassette.readCassette")(function* (name) {
    const target = yield* pathFor(name);
    const raw = yield* fs.readFileString(target).pipe(Effect3.catchTag("PlatformError", catchMissingOrInvalid(name)));
    const cassette = yield* parseCassette(raw).pipe(Effect3.mapError((error) => invalidCassette(name, error)));
    yield* validateRecordedAt(name, cassette);
    return cassette;
  });
  return Service.of({
    read: Effect3.fn("Cassette.read")(function* (name) {
      return (yield* readCassette2(name)).interactions;
    }),
    readCassette: readCassette2,
    recordedAt: Effect3.fn("Cassette.recordedAt")(function* (name) {
      return yield* cassetteRecordedAt(name, yield* readCassette2(name));
    }),
    append: Effect3.fn("Cassette.append")(function* (name, interaction, metadata) {
      yield* lock.withPermit(Effect3.gen(function* () {
        const target = yield* pathFor(name);
        const entry = recorded.get(target);
        const secrets = yield* configuredSecrets.pipe(Effect3.mapError((error) => invalidCassette(name, error)));
        const interactions = [...entry?.interactions ?? [], interaction];
        const interactionFindings = [...entry?.findings ?? [], ...secretFindings(interaction, secrets)];
        const recordedAt2 = entry?.recordedAt ?? DateTime.formatIso(yield* DateTime.now);
        const cassette = buildCassette(name, interactions, metadata, recordedAt2);
        yield* failIfUnsafe(name, [...interactionFindings, ...secretFindings(cassette.metadata ?? {}, secrets)]);
        const formatted = yield* formatCassette(cassette).pipe(Effect3.mapError((error) => invalidCassette(name, error)));
        yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect3.mapError((error) => invalidCassette(name, error)));
        yield* Effect3.acquireUseRelease(Effect3.succeed(`${target}.${crypto.randomUUID()}.tmp`), (temporary) => fs.writeFileString(temporary, formatted).pipe(Effect3.flatMap(() => Effect3.gen(function* () {
          yield* fs.rename(temporary, target);
          recorded.set(target, { interactions, findings: interactionFindings, recordedAt: recordedAt2 });
        }).pipe(Effect3.uninterruptible)), Effect3.mapError((error) => invalidCassette(name, error))), (temporary) => fs.remove(temporary, { force: true }).pipe(Effect3.catch((error) => Effect3.logWarning("Unable to remove temporary cassette", error))));
      }));
    }),
    exists: Effect3.fn("Cassette.exists")(function* (name) {
      const target = yield* pathFor(name);
      return yield* fs.access(target).pipe(Effect3.as(true), Effect3.catchTag("PlatformError", (error) => Match2.value(error.reason).pipe(Match2.tag("NotFound", () => Effect3.succeed(false)), Match2.orElse(() => Effect3.fail(invalidCassette(name, error))))));
    }),
    remove: Effect3.fn("Cassette.remove")(function* (name) {
      yield* lock.withPermit(Effect3.gen(function* () {
        const target = yield* pathFor(name);
        yield* Effect3.gen(function* () {
          yield* fs.remove(target).pipe(Effect3.catchTag("PlatformError", ignoreMissing(name)));
          recorded.delete(target);
        }).pipe(Effect3.uninterruptible);
      }));
    }),
    list: Effect3.fn("Cassette.list")(function* () {
      const present = yield* fs.access(directory).pipe(Effect3.as(true), Effect3.catchTag("PlatformError", (error) => Match2.value(error.reason).pipe(Match2.tag("NotFound", () => Effect3.succeed(false)), Match2.orElse(() => Effect3.fail(invalidCassette(directory, error))))));
      if (!present)
        return [];
      const files = yield* walk(directory).pipe(Effect3.mapError((error) => invalidCassette(directory, error)));
      return files.filter((file) => file.endsWith(".json")).map((file) => path.relative(directory, file).replace(/\\/g, "/").replace(/\.json$/, "")).toSorted();
    })
  });
}));
var memory = (initial = {}) => Layer.effect(Service, Effect3.gen(function* () {
  const stored = new Map(Object.entries(initial).map(([name, interactions]) => [
    name,
    { version: 1, metadata: { name }, interactions: [...interactions] }
  ]));
  const recorded = new Map;
  const lock = yield* Semaphore.make(1);
  const readCassette2 = Effect3.fn("Cassette.memory.readCassette")(function* (name) {
    yield* validateCassetteName(name);
    const cassette = stored.get(name);
    if (!cassette)
      return yield* Effect3.fail(new CassetteNotFoundError({ cassetteName: name }));
    yield* validateRecordedAt(name, cassette);
    return cassette;
  });
  return Service.of({
    read: Effect3.fn("Cassette.memory.read")(function* (name) {
      return (yield* readCassette2(name)).interactions;
    }),
    readCassette: readCassette2,
    recordedAt: Effect3.fn("Cassette.memory.recordedAt")(function* (name) {
      return yield* cassetteRecordedAt(name, yield* readCassette2(name));
    }),
    append: Effect3.fn("Cassette.memory.append")(function* (name, interaction, metadata) {
      yield* lock.withPermit(Effect3.gen(function* () {
        yield* validateCassetteName(name);
        const entry = recorded.get(name);
        const previous = stored.get(name);
        const secrets = yield* configuredSecrets.pipe(Effect3.mapError((error) => invalidCassette(name, error)));
        const interactions = [...previous?.interactions ?? [], interaction];
        const findings = [
          ...entry?.findings ?? secretFindings(previous?.interactions ?? [], secrets),
          ...secretFindings(interaction, secrets)
        ];
        const recordedAt2 = entry?.recordedAt ?? DateTime.formatIso(yield* DateTime.now);
        const cassette = buildCassette(name, interactions, metadata, recordedAt2);
        yield* failIfUnsafe(name, [...findings, ...secretFindings(cassette.metadata ?? {}, secrets)]);
        yield* encodeCassette(cassette).pipe(Effect3.mapError((error) => invalidCassette(name, error)));
        stored.set(name, cassette);
        recorded.set(name, { interactions, findings, recordedAt: recordedAt2 });
      }));
    }),
    exists: Effect3.fn("Cassette.memory.exists")(function* (name) {
      yield* validateCassetteName(name);
      return stored.has(name);
    }),
    remove: Effect3.fn("Cassette.memory.remove")(function* (name) {
      yield* lock.withPermit(Effect3.gen(function* () {
        yield* validateCassetteName(name);
        stored.delete(name);
        recorded.delete(name);
      }));
    }),
    list: Effect3.fn("Cassette.memory.list")(() => Effect3.sync(() => Array.from(stored.keys()).toSorted()))
  });
}));
var nodeFileSystem = Layer.provide(fileSystem(), Layer.merge(NodeFileSystem.layer, NodePath.layer));
var withCassette = (options, use) => Effect3.gen(function* () {
  if (options?.directory === undefined) {
    const service = yield* Effect3.serviceOption(Service);
    if (Option.isSome(service))
      return yield* use(service.value);
  }
  const layer = options?.directory === undefined ? nodeFileSystem : fileSystem(options).pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));
  return yield* Effect3.flatMap(Service, use).pipe(Effect3.provide(layer));
});
var recordedAt = Effect3.fn("Cassette.recordedAt")(function* (name, options) {
  return yield* withCassette(options, (service) => service.recordedAt(name));
});
var readCassette = Effect3.fn("Cassette.readCassette")(function* (name, options) {
  return yield* withCassette(options, (service) => service.readCassette(name));
});
var hasCassette = Effect3.fn("Cassette.hasCassette")(function* (name, options) {
  return yield* withCassette(options, (service) => service.exists(name));
});
var removeCassette = Effect3.fn("Cassette.removeCassette")(function* (name, options) {
  return yield* withCassette(options, (service) => service.remove(name));
});

// src/clock.ts
import { DateTime as DateTime2, Effect as Effect4 } from "effect";
import { TestClock } from "effect/testing";
var setTestClockToRecordedAt = Effect4.fn("effect-http-recorder/setTestClockToRecordedAt")(function* (name, options) {
  const at = yield* recordedAt(name, options).pipe(Effect4.catchTag("CassetteNotFoundError", () => TestClock.withLive(DateTime2.now)));
  yield* TestClock.setTime(DateTime2.toEpochMillis(at));
  return at;
});

// src/http/recorder.ts
import { NodeFileSystem as NodeFileSystem2, NodePath as NodePath2 } from "@effect/platform-node-shared";
import { Deferred, Effect as Effect6, Encoding as Encoding4, Exit as Exit2, FiberSet, Layer as Layer2, Match as Match3, Ref as Ref2, Result as Result4 } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse
} from "effect/unstable/http";

// src/redaction/redactor.ts
import { Option as Option2, Schema as Schema6 } from "effect";
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
  const parameters = new URLSearchParams;
  for (const [key, value] of url.searchParams) {
    parameters.append(key, redacted.has(key.toLowerCase()) ? REDACTED : value);
  }
  url.search = parameters.toString();
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
  const redacted = Option2.match(decodeJson(value), {
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
import { Config, Effect as Effect5, Exit, HashSet, Option as Option3, Ref, SynchronizedRef } from "effect";
var isCI = Effect5.gen(function* () {
  const value = yield* Config.string("CI").pipe(Config.option, Effect5.orElseSucceed(() => Option3.none()));
  return Option3.isSome(value) && value.value !== "" && value.value !== "false" && value.value !== "0";
});
var resolveAutoMode = (cassette, name) => Effect5.gen(function* () {
  if (yield* isCI)
    return "replay";
  return (yield* cassette.exists(name)) ? "replay" : "record";
});
var makeReplayPoolState = (cassette, name, project) => Effect5.gen(function* () {
  const interactions = project(yield* cassette.read(name));
  const claimed = yield* SynchronizedRef.make(HashSet.empty());
  const attempted = yield* Ref.make(false);
  yield* Effect5.addFinalizer((exit) => Exit.isFailure(exit) ? Effect5.void : Effect5.gen(function* () {
    const used = yield* SynchronizedRef.get(claimed);
    if (HashSet.isEmpty(used) && (yield* Ref.get(attempted)))
      return yield* Effect5.void;
    if (HashSet.size(used) < interactions.length)
      return yield* Effect5.die(new Error(`Unused recorded interactions in ${name}: used ${HashSet.size(used)} of ${interactions.length}`));
    return yield* Effect5.void;
  }));
  return {
    claim: (select) => Ref.set(attempted, true).pipe(Effect5.andThen(SynchronizedRef.modifyEffect(claimed, (used) => Effect5.gen(function* () {
      const index = yield* select(interactions, used);
      const interaction = interactions[index];
      if (interaction === undefined || HashSet.has(used, index))
        return yield* Effect5.die("Replay selected an unavailable interaction");
      return [{ interaction, index }, HashSet.add(used, index)];
    }))))
  };
});
var makeReplayState = (cassette, name, project) => makeReplayPoolState(cassette, name, project).pipe(Effect5.map((pool) => ({
  claim: (validate) => pool.claim((interactions, used) => {
    const index = HashSet.size(used);
    return validate(interactions[index], index, interactions).pipe(Effect5.as(index));
  })
})));

// src/http/matching.ts
import { HashSet as HashSet2, Option as Option5 } from "effect";

// src/replay/comparison.ts
import { Option as Option4, Schema as Schema7 } from "effect";
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
var safeText = (value, env) => {
  if (value === undefined)
    return "undefined";
  if (secretFindings(value, env).length > 0)
    return JSON.stringify(REDACTED);
  const text = JSON.stringify(value);
  if (!text)
    return typeof value;
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
};
var jsonBody = (body) => Option4.getOrUndefined(decodeJson2(body));
var isJsonRecord = isRecord;

// src/http/matching.ts
var canonicalSnapshot = (snapshot) => JSON.stringify({
  method: snapshot.method,
  url: snapshot.url,
  headers: canonicalizeJson(snapshot.headers),
  body: Option5.match(decodeJson2(snapshot.body), {
    onNone: () => snapshot.body,
    onSome: canonicalizeJson
  })
});
var defaultMatcher = (incoming, recorded) => canonicalSnapshot(incoming) === canonicalSnapshot(recorded);
var valueDiffs = (expected, received, format, base = "$", limit = 8) => {
  if (Object.is(expected, received))
    return [];
  if (isJsonRecord(expected) && isJsonRecord(received)) {
    return [...new Set([...Object.keys(expected), ...Object.keys(received)])].toSorted().flatMap((key) => valueDiffs(expected[key], received[key], format, `${base}.${key}`, limit)).slice(0, limit);
  }
  if (Array.isArray(expected) && Array.isArray(received)) {
    return Array.from({ length: Math.max(expected.length, received.length) }, (_, index) => index).flatMap((index) => valueDiffs(expected[index], received[index], format, `${base}[${index}]`, limit)).slice(0, limit);
  }
  return [`${base} expected ${format(expected)}, received ${format(received)}`];
};
var headerDiffs = (expected, received, format) => [...new Set([...Object.keys(expected), ...Object.keys(received)])].toSorted().flatMap((key) => {
  if (expected[key] === received[key])
    return [];
  if (expected[key] === undefined)
    return [`  ${key} unexpected ${format(received[key])}`];
  if (received[key] === undefined)
    return [`  ${key} missing expected ${format(expected[key])}`];
  return [`  ${key} expected ${format(expected[key])}, received ${format(received[key])}`];
});
var requestDiff = (expected, received, env) => {
  const format = (value) => safeText(value, env);
  const lines = [];
  if (expected.method !== received.method) {
    lines.push("method:", `  expected ${format(expected.method)}, received ${format(received.method)}`);
  }
  if (expected.url !== received.url) {
    lines.push("url:", `  expected ${format(expected.url)}`, `  received ${format(received.url)}`);
  }
  const headers = headerDiffs(expected.headers, received.headers, format);
  if (headers.length > 0)
    lines.push("headers:", ...headers.slice(0, 8));
  const expectedBody = jsonBody(expected.body);
  const receivedBody = jsonBody(received.body);
  const body = expectedBody !== undefined && receivedBody !== undefined ? valueDiffs(expectedBody, receivedBody, format).map((line) => `  ${line}`) : expected.body === received.body ? [] : [`  expected ${format(expected.body)}, received ${format(received.body)}`];
  if (body.length > 0)
    lines.push("body:", ...body);
  return lines;
};
var selectFirstMatching = (interactions, incoming, match, used, env) => {
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
    detail: requestDiff(firstUnused.request, incoming, env).join(`
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
var captureResponseBody = (response, contentType) => response.arrayBuffer.pipe(Effect6.map((bytes) => ({
  bytes,
  snapshot: isTextContentType(contentType) ? { body: new TextDecoder().decode(bytes) } : {
    body: Encoding4.encodeBase64(new Uint8Array(bytes)),
    bodyEncoding: "base64"
  }
})));
var decodeResponseBody = (snapshot) => {
  if (snapshot.bodyEncoding !== "base64")
    return snapshot.body;
  const bytes = Result4.getOrThrow(Encoding4.decodeBase64(snapshot.body));
  if (!(bytes.buffer instanceof ArrayBuffer))
    throw new Error("Unsupported shared response buffer");
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
};
var responseFromSnapshot = (request, snapshot, capturedBody) => Effect6.try({
  try: () => HttpClientResponse.fromWeb(request, new Response(request.method === "HEAD" || snapshot.status === 204 || snapshot.status === 205 || snapshot.status === 304 ? null : capturedBody ?? decodeResponseBody(snapshot), snapshot)),
  catch: () => transportError(request, "Invalid recorded HTTP response")
});
var redactedErrorRequest = (request, redactedUrl = redactUrl(request.url)) => HttpClientRequest.make(request.method)(redactedUrl);
var transportError = (request, description, redactedUrl) => new HttpClientError.HttpClientError({
  reason: new HttpClientError.TransportError({
    request: redactedErrorRequest(request, redactedUrl),
    description
  })
});
var recordingLayer = (name, options = {}) => Layer2.effect(HttpClient.HttpClient, Effect6.gen(function* () {
  const upstream = yield* HttpClient.HttpClient;
  const cassetteService = yield* Service;
  const redactor = options.redactor ?? make();
  const match = options.match ?? defaultMatcher;
  const requested = options.mode ?? "auto";
  const mode = requested === "auto" ? yield* resolveAutoMode(cassetteService, name) : requested;
  if (mode === "passthrough")
    return upstream;
  const secrets = yield* configuredSecrets.pipe(Effect6.mapError(() => new InvalidCassetteError({
    cassetteName: name,
    description: "Could not load configuration for secret protection"
  })));
  const snapshotRequest = Effect6.fn("HttpRecorder.snapshotRequest")(function* (request, signal) {
    const web = yield* HttpClientRequest.toWeb(request, { signal }).pipe(Effect6.mapError(() => transportError(request, "Could not encode request")));
    return redactor.request({
      method: web.method,
      url: web.url,
      headers: Object.fromEntries(web.headers.entries()),
      body: yield* Effect6.tryPromise({
        try: () => web.text(),
        catch: () => transportError(request, "Could not read request body")
      })
    });
  });
  if (mode === "record") {
    const completions = yield* FiberSet.make();
    const initial = yield* Deferred.make();
    yield* Deferred.succeed(initial, undefined);
    const tail = yield* Ref2.make(initial);
    return HttpClient.make((request, _url, signal) => Effect6.uninterruptibleMask((restore) => Effect6.gen(function* () {
      const completed = yield* Deferred.make();
      const previous = yield* Ref2.modify(tail, (current) => [current, completed]);
      return yield* restore(Effect6.gen(function* () {
        const incoming = yield* snapshotRequest(request, signal);
        const requestError = (description) => transportError(request, description, incoming.url);
        const response = yield* upstream.execute(request);
        const captured = yield* captureResponseBody(response, response.headers["content-type"]);
        const responseSnapshot = {
          status: response.status,
          headers: response.headers,
          ...captured.snapshot
        };
        const interaction = {
          transport: "http",
          request: incoming,
          response: redactor.response(responseSnapshot)
        };
        yield* Deferred.await(previous);
        yield* cassetteService.append(name, interaction, options.metadata).pipe(Effect6.mapError((error) => requestError(error.message)));
        return yield* responseFromSnapshot(request, responseSnapshot, captured.bytes);
      })).pipe(Effect6.onExit((exit) => Exit2.isSuccess(exit) ? Deferred.succeed(completed, undefined) : FiberSet.run(completions, Deferred.await(previous).pipe(Effect6.andThen(Deferred.succeed(completed, undefined)), Effect6.asVoid, Effect6.interruptible)).pipe(Effect6.asVoid)));
    })));
  }
  const replay = yield* makeReplayPoolState(cassetteService, name, httpInteractions);
  return HttpClient.make((request, _url, signal) => Effect6.gen(function* () {
    const incoming = yield* snapshotRequest(request, signal);
    const requestError = (description) => transportError(request, description, incoming.url);
    const claimed = yield* replay.claim((interactions, used) => Match3.value(selectFirstMatching(interactions, incoming, match, used, secrets)).pipe(Match3.tagsExhaustive({
      Matched: ({ index }) => Effect6.succeed(index),
      Unmatched: ({ detail }) => Effect6.fail(requestError(`Fixture "${name}" does not match the current request: ${detail}.`))
    })));
    return yield* responseFromSnapshot(request, claimed.interaction.response);
  }));
}));
var layer = (name, options = {}) => recordingLayer(name, {
  metadata: options.metadata,
  redactor: make(options.redact),
  match: options.match
}).pipe(Layer2.provide(fileSystem({ directory: options.directory })), Layer2.provide(NodeFileSystem2.layer), Layer2.provide(NodePath2.layer));
var layerFetch = (name, options = {}) => layer(name, options).pipe(Layer2.provide(FetchHttpClient.layer));

// src/websocket/recorder.ts
import { NodeFileSystem as NodeFileSystem3, NodePath as NodePath3 } from "@effect/platform-node-shared";
import { Effect as Effect10, Layer as Layer3 } from "effect";
import { Socket as Socket4 } from "effect/unstable/socket";

// src/websocket/constructor.ts
import { Cause, Deferred as Deferred3, Effect as Effect8, FiberSet as FiberSet2 } from "effect";
import { Socket as Socket2 } from "effect/unstable/socket";

// src/websocket/transcript.ts
import { Deferred as Deferred2, Effect as Effect7, Encoding as Encoding5, Option as Option6, Ref as Ref3, Result as Result5, Semaphore as Semaphore2 } from "effect";
import { Socket } from "effect/unstable/socket";
var socketReadError = (cause) => new Socket.SocketError({ reason: new Socket.SocketReadError({ cause }) });
var socketWriteError = (cause) => new Socket.SocketError({ reason: new Socket.SocketWriteError({ cause }) });
var encodeEvent = (direction, message) => typeof message === "string" ? { direction, kind: "text", body: message } : { direction, kind: "binary", body: Encoding5.encodeBase64(message), bodyEncoding: "base64" };
var decodeEvent = (event) => event.kind === "text" ? event.body : Result5.getOrThrow(Encoding5.decodeBase64(event.body));
var redactEvent = (event, redactor) => {
  if (event.kind === "binary")
    return event;
  const body = event.direction === "client" ? redactor.request({ method: "WEBSOCKET", url: "", headers: {}, body: event.body }).body : redactor.response({ status: 101, headers: {}, body: event.body }).body;
  return { ...event, body };
};
var comparable = (event, asJson) => {
  if (!asJson || event.kind === "binary")
    return JSON.stringify(canonicalizeJson(event));
  const decoded = decodeJson2(event.body);
  return JSON.stringify(canonicalizeJson({
    ...event,
    body: Option6.match(decoded, { onNone: () => event.body, onSome: canonicalizeJson })
  }));
};
var makeReplayTranscript = Effect7.fn("WebSocket.makeReplayTranscript")(function* (interaction, options) {
  const progress = yield* Ref3.make({
    position: 0,
    changed: yield* Deferred2.make(),
    writeReady: yield* Deferred2.make(),
    closed: false
  });
  const lock = yield* Semaphore2.make(1);
  const unconsumed = (position) => new Error(`WebSocket closed with unconsumed events: used ${position} of ${interaction.events.length}`);
  const advance = (current, writeReady = current.writeReady) => Effect7.gen(function* () {
    yield* Ref3.set(progress, {
      position: current.position + 1,
      changed: yield* Deferred2.make(),
      writeReady,
      closed: false
    });
    yield* Deferred2.succeed(current.changed, undefined);
  });
  const read = Effect7.gen(function* () {
    while (true) {
      const next = yield* lock.withPermit(Effect7.uninterruptible(Effect7.gen(function* () {
        const current = yield* Ref3.get(progress);
        const event = interaction.events[current.position];
        if (!event) {
          yield* Deferred2.succeed(current.writeReady, undefined);
          return { frame: undefined };
        }
        if (current.closed)
          return yield* Effect7.fail(socketReadError(unconsumed(current.position)));
        if (event.direction === "client") {
          yield* Deferred2.succeed(current.writeReady, undefined);
          return { wait: current.changed };
        }
        const frame = decodeEvent(event);
        yield* advance(current);
        return { frame };
      })));
      if ("frame" in next)
        return next.frame;
      yield* Deferred2.await(next.wait);
    }
  });
  const awaitWriteReady = Effect7.flatMap(Ref3.get(progress), (current) => Deferred2.await(current.writeReady));
  const write = Effect7.fn("WebSocket.writeTranscript")((message) => lock.withPermit(Effect7.uninterruptible(Effect7.gen(function* () {
    const current = yield* Ref3.get(progress);
    if (current.closed)
      return yield* Effect7.fail(socketWriteError("WebSocket is closed"));
    if (Socket.isCloseEvent(message)) {
      yield* Ref3.set(progress, { ...current, closed: true });
      yield* Deferred2.succeed(current.changed, undefined);
      yield* Deferred2.succeed(current.writeReady, undefined);
      if (current.position !== interaction.events.length)
        return yield* Effect7.fail(socketWriteError(unconsumed(current.position)));
      return;
    }
    const actual = redactEvent(encodeEvent("client", message), options.redactor);
    const expected = interaction.events[current.position];
    if (!expected || comparable(actual, options.compareClientMessagesAsJson) !== comparable(expected, options.compareClientMessagesAsJson))
      return yield* Effect7.fail(socketWriteError(new Error(`WebSocket event ${current.position + 1}: expected ${safeText(expected, options.secrets)}, received ${safeText(actual, options.secrets)}`)));
    yield* advance(current, yield* Deferred2.make());
  }))));
  return { read, awaitWriteReady, write };
});

// src/websocket/constructor.ts
var normalizeProtocols = (protocols) => protocols === undefined ? [] : typeof protocols === "string" ? [protocols] : [...protocols];
var captureFrame = (data) => {
  if (typeof data === "string")
    return Effect8.succeed(data);
  if (data instanceof Blob)
    return Effect8.tryPromise(() => data.arrayBuffer()).pipe(Effect8.map((buffer) => new Uint8Array(buffer)));
  if (data instanceof ArrayBuffer)
    return Effect8.succeed(new Uint8Array(data.slice(0)));
  if (ArrayBuffer.isView(data))
    return Effect8.succeed(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
  return Effect8.fail(new Error(`Unsupported WebSocket frame: ${Object.prototype.toString.call(data)}`));
};

class RecordedCloseEvent extends Event {
  code;
  reason;
  wasClean;
  constructor(code, reason) {
    super("close");
    this.code = code;
    this.reason = reason;
    this.wasClean = code === 1000;
  }
}

class RecordedErrorEvent extends Event {
  error;
  filename = "";
  lineno = 0;
  colno = 0;
  message;
  constructor(error) {
    super("error");
    this.error = error;
    this.message = error instanceof Error ? error.message : String(error);
  }
}
var closeEvent = (code, reason) => typeof globalThis.CloseEvent === "function" ? new globalThis.CloseEvent("close", { code, reason, wasClean: code === 1000 }) : new RecordedCloseEvent(code, reason);
var errorEvent = (error) => typeof globalThis.ErrorEvent === "function" ? new globalThis.ErrorEvent("error", { error, message: error instanceof Error ? error.message : String(error) }) : new RecordedErrorEvent(error);

class ReplayWebSocket extends EventTarget {
  url;
  protocol;
  send;
  close;
  CONNECTING = 0;
  OPEN = 1;
  CLOSING = 2;
  CLOSED = 3;
  extensions = "";
  bufferedAmount = 0;
  binaryType = "blob";
  readyState = 0;
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  constructor(url, protocol, send, close) {
    super();
    this.url = url;
    this.protocol = protocol;
    this.send = send;
    this.close = close;
    this.addEventListener("open", (event) => this.onopen?.call(this, event));
    this.addEventListener("message", (event) => {
      if (event instanceof MessageEvent)
        this.onmessage?.call(this, event);
    });
    this.addEventListener("error", (event) => this.onerror?.call(this, event));
    this.addEventListener("close", (event) => {
      if (event instanceof RecordedCloseEvent || typeof globalThis.CloseEvent === "function" && event instanceof globalThis.CloseEvent)
        this.onclose?.call(this, event);
    });
  }
}
var makeCallbacks = Effect8.fn("WebSocket.makeCallbacks")(function* (drain = false) {
  const fibers = yield* FiberSet2.make();
  const run = yield* FiberSet2.runtime(fibers)();
  const resources = new Set;
  let disposed = false;
  let failure;
  yield* Effect8.addFinalizer(() => Effect8.gen(function* () {
    disposed = true;
    for (const dispose of resources)
      dispose();
    resources.clear();
    if (drain)
      yield* FiberSet2.awaitEmpty(fibers);
    if (failure !== undefined)
      yield* Effect8.die(Cause.squash(failure));
  }));
  return {
    run,
    resources,
    isDisposed: () => disposed,
    serial: (fail) => {
      let previous = Effect8.void;
      const pending = new Set;
      let cancelled = false;
      const enqueue = (operation) => {
        if (disposed || cancelled)
          return;
        const before = previous;
        const complete = Deferred3.makeUnsafe();
        previous = Deferred3.await(complete);
        const fiber = run(before.pipe(Effect8.andThen(operation), Effect8.catchCause((cause) => Effect8.sync(() => {
          if (cancelled)
            return;
          if (drain && failure === undefined)
            failure = cause;
          fail(Cause.squash(cause));
        })), Effect8.ensuring(Deferred3.succeed(complete, undefined))));
        pending.add(fiber);
        fiber.addObserver(() => pending.delete(fiber));
      };
      return {
        enqueue,
        cancel: () => {
          cancelled = true;
          for (const fiber of pending)
            fiber.interruptUnsafe();
        }
      };
    }
  };
});
var makeRecordingWebSocketConstructor = Effect8.fn("WebSocket.makeRecordingConstructor")(function* (upstream, cassette, name, metadata, redactor) {
  const callbacks = yield* makeCallbacks(true);
  let nextSequence = 0;
  return (url, protocols) => {
    if (callbacks.isDisposed())
      throw new Error("WebSocket recorder scope is closed");
    const sequence = nextSequence++;
    const requestedProtocols = normalizeProtocols(protocols);
    const native = upstream(url, requestedProtocols);
    const events = [];
    let opened = false;
    let failed = false;
    let closed = false;
    const fail = (cause) => {
      if (failed)
        return;
      failed = true;
      native.dispatchEvent(errorEvent(cause));
      if (native.readyState < 2)
        native.close();
    };
    const { enqueue, cancel } = callbacks.serial(fail);
    const appendEvent = (direction, frame) => {
      enqueue(Effect8.gen(function* () {
        if (failed)
          return;
        events.push(redactEvent(encodeEvent(direction, yield* frame), redactor));
      }));
    };
    const onOpen = () => {
      opened = true;
    };
    const onMessage = (event) => {
      if (!closed)
        appendEvent("server", captureFrame(event.data));
    };
    const onError = () => {
      failed = true;
    };
    const detach = () => {
      native.removeEventListener("open", onOpen);
      native.removeEventListener("message", onMessage);
      native.removeEventListener("error", onError);
      native.removeEventListener("close", onClose);
      callbacks.resources.delete(dispose);
    };
    const dispose = () => {
      closed = true;
      failed = true;
      cancel();
      detach();
      if (native.readyState < 2)
        native.close();
    };
    const onClose = (event) => {
      if (closed)
        return;
      closed = true;
      detach();
      enqueue(Effect8.gen(function* () {
        if (!opened || failed)
          return;
        const request = redactor.request({ method: "WEBSOCKET", url, headers: {}, body: "" });
        yield* cassette.append(name, {
          transport: "websocket",
          connection: {
            sequence,
            url: request.url,
            protocols: requestedProtocols,
            close: { code: event.code, reason: event.reason }
          },
          events
        }, metadata);
      }));
    };
    callbacks.resources.add(dispose);
    native.addEventListener("open", onOpen);
    native.addEventListener("message", onMessage);
    native.addEventListener("error", onError);
    native.addEventListener("close", onClose);
    return new Proxy(native, {
      get: (target, property) => {
        if (property === "send")
          return (data) => {
            const frame = captureFrame(data);
            target.send(data);
            if (!closed)
              appendEvent("client", frame);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set: (target, property, value) => Reflect.set(target, property, value, target)
    });
  };
});
var constructorWebSocketInteractions = (interactions) => webSocketInteractions(interactions).flatMap((interaction) => interaction.connection === undefined ? [] : [{ interaction, sequence: interaction.connection.sequence }]).sort((a, b) => a.sequence - b.sequence).map(({ interaction }) => interaction);
var makeReplayWebSocketConstructor = Effect8.fn("WebSocket.makeReplayConstructor")(function* (cassette, name, redactor, secrets) {
  const replay = yield* makeReplayState(cassette, name, constructorWebSocketInteractions);
  const callbacks = yield* makeCallbacks();
  return (url, protocols) => {
    if (callbacks.isDisposed())
      throw new Error("WebSocket recorder scope is closed");
    const requestedProtocols = normalizeProtocols(protocols);
    const request = redactor.request({ method: "WEBSOCKET", url, headers: {}, body: "" });
    let transcript;
    let terminal = { code: 1000, reason: "" };
    let finished = false;
    let closeRequested = false;
    let driver;
    let timer;
    const clearTimer = () => {
      if (timer !== undefined)
        clearTimeout(timer);
      timer = undefined;
    };
    const stop = () => {
      finished = true;
      clearTimer();
      cancel();
      driver?.interruptUnsafe();
      callbacks.resources.delete(dispose);
      target.readyState = 3;
    };
    const dispose = () => {
      if (finished)
        return;
      stop();
      target.dispatchEvent(closeEvent(1001, "Recorder scope closed"));
    };
    const fail = (error) => {
      if (finished)
        return;
      stop();
      target.dispatchEvent(errorEvent(error));
      target.dispatchEvent(closeEvent(1006, ""));
    };
    const finish = () => {
      if (finished)
        return;
      stop();
      target.dispatchEvent(closeEvent(terminal.code, terminal.reason));
    };
    const { enqueue, cancel } = callbacks.serial(fail);
    const drive = (active) => Effect8.gen(function* () {
      while (!finished) {
        const frame = yield* active.read;
        if (finished)
          return;
        if (frame === undefined) {
          timer = setTimeout(() => enqueue(Effect8.sync(finish)), 0);
          return;
        }
        const data = typeof frame === "string" ? frame : target.binaryType === "blob" ? new Blob([frame.buffer instanceof ArrayBuffer ? frame.buffer : new Uint8Array(frame).buffer]) : frame.buffer;
        target.dispatchEvent(new MessageEvent("message", { data }));
      }
    }).pipe(Effect8.catchCause((cause) => Effect8.sync(() => fail(Cause.squash(cause)))));
    const target = new ReplayWebSocket(url, requestedProtocols[0] ?? "", (data) => {
      const active = transcript;
      if (!active || target.readyState !== 1 || closeRequested)
        throw new Error("WebSocket is not open");
      const frame = captureFrame(data);
      enqueue(Effect8.gen(function* () {
        if (finished)
          return;
        yield* active.write(yield* frame);
        yield* active.awaitWriteReady;
      }));
    }, (code, reason) => {
      if (closeRequested || target.readyState === 3)
        return;
      closeRequested = true;
      target.readyState = 2;
      enqueue(Effect8.gen(function* () {
        if (finished)
          return;
        if (!transcript)
          return fail(new Error("WebSocket closed before it opened"));
        yield* transcript.write(new Socket2.CloseEvent(code, reason));
        finish();
      }));
    });
    callbacks.resources.add(dispose);
    enqueue(Effect8.yieldNow.pipe(Effect8.andThen(Effect8.gen(function* () {
      const claimed = yield* replay.claim((recorded, index) => Effect8.try(() => {
        if (!recorded)
          throw new Error(`Missing recorded WebSocket connection ${index + 1}`);
        const connection = recorded.connection;
        if (!connection)
          throw new Error(`WebSocket interaction ${index + 1} has no connection metadata`);
        if (connection.url !== request.url)
          throw new Error(`WebSocket connection ${index + 1}: expected URL ${safeText(connection.url, secrets)}, received ${safeText(request.url, secrets)}`);
        if (connection.protocols.length !== requestedProtocols.length || connection.protocols.some((protocol, index) => protocol !== requestedProtocols[index]))
          throw new Error(`WebSocket connection ${index + 1}: expected protocols ${safeText(connection.protocols, secrets)}, received ${safeText(requestedProtocols, secrets)}`);
      }));
      if (finished)
        return;
      if (closeRequested)
        return fail(new Error("WebSocket closed before it opened"));
      const active = yield* makeReplayTranscript(claimed.interaction, {
        redactor,
        compareClientMessagesAsJson: true,
        secrets
      });
      transcript = active;
      terminal = claimed.interaction.connection?.close ?? terminal;
      target.readyState = 1;
      target.dispatchEvent(new Event("open"));
      driver = callbacks.run(drive(active));
      yield* active.awaitWriteReady;
    }))));
    return target;
  };
});

// src/websocket/socket.ts
import { Effect as Effect9, FiberSet as FiberSet3, Option as Option7, Ref as Ref4, Semaphore as Semaphore3 } from "effect";
import { Socket as Socket3 } from "effect/unstable/socket";
var runHandler = (handler, value) => Effect9.suspend(() => {
  const result = handler(value);
  return Effect9.isEffect(result) ? Effect9.asVoid(result) : Effect9.void;
});
var makeRecordingSocket = Effect9.fn("WebSocket.makeRecordingSocket")((upstream, cassette, name, options, redactor) => Effect9.gen(function* () {
  const active = yield* Ref4.make(undefined);
  const writeLock = yield* Semaphore3.make(1);
  return Socket3.make({
    runRaw: (handler, runOptions) => Effect9.gen(function* () {
      const state = {
        events: [],
        accepting: yield* Ref4.make(true),
        opened: false,
        valid: true
      };
      const occupied = yield* Ref4.modify(active, (current) => [current !== undefined, current ?? state]);
      if (occupied)
        return yield* Effect9.fail(socketReadError("Concurrent runs of a recorded WebSocket are not supported"));
      yield* upstream.runRaw((message) => {
        const accepting = Ref4.getUnsafe(state.accepting);
        if (accepting)
          state.events.push(redactEvent(encodeEvent("server", message), redactor));
        return Effect9.gen(function* () {
          if (!accepting)
            return yield* Effect9.fail(socketReadError("WebSocket received a frame after closing"));
          yield* runHandler(handler, message);
        });
      }, {
        ...runOptions,
        onOpen: Effect9.gen(function* () {
          state.opened = true;
          if (runOptions?.onOpen)
            yield* runOptions.onOpen;
        })
      }).pipe(Effect9.andThen(writeLock.withPermit(Effect9.gen(function* () {
        yield* Ref4.set(state.accepting, false);
        if (!state.opened || !state.valid)
          return;
        yield* cassette.append(name, { transport: "websocket", events: state.events }, options.metadata).pipe(Effect9.mapError(socketReadError));
      }))), Effect9.ensuring(writeLock.withPermit(Ref4.set(state.accepting, false).pipe(Effect9.andThen(Ref4.set(active, undefined))))));
    }),
    writer: upstream.writer.pipe(Effect9.map((write) => (message) => writeLock.withPermit(Effect9.gen(function* () {
      if (Socket3.isCloseEvent(message))
        return yield* write(message);
      const state = yield* Ref4.get(active);
      if (!state || !(yield* Ref4.get(state.accepting)))
        return yield* Effect9.fail(socketWriteError("WebSocket writer used without an active socket run"));
      const event = redactEvent(encodeEvent("client", message), redactor);
      state.events.push(event);
      return yield* write(message).pipe(Effect9.onError(() => Effect9.sync(() => state.valid = false)));
    }))))
  });
}));
var runReplay = Effect9.fn("WebSocket.runReplay")(function* (transcript, handler, onOpen) {
  return yield* Effect9.scoped(Effect9.gen(function* () {
    const handlers = yield* FiberSet3.make();
    const run = yield* FiberSet3.runtime(handlers)();
    if (onOpen)
      yield* onOpen;
    const drive = Effect9.gen(function* () {
      while (true) {
        const frame = yield* transcript.read;
        if (frame === undefined)
          return;
        run(runHandler(handler, frame));
      }
    });
    yield* drive.pipe(Effect9.raceFirst(FiberSet3.join(handlers)));
    yield* FiberSet3.awaitEmpty(handlers).pipe(Effect9.raceFirst(FiberSet3.join(handlers)));
  }));
});
var makeReplaySocket = Effect9.fn("WebSocket.makeReplaySocket")(function* (cassette, name, options, redactor, secrets) {
  const replay = yield* makeReplayState(cassette, name, webSocketInteractions);
  const active = yield* Ref4.make(undefined);
  const runLock = yield* Semaphore3.make(1);
  return Socket3.make({
    runRaw: (handler, runOptions) => runLock.withPermitsIfAvailable(1)(Effect9.gen(function* () {
      const claimed = yield* replay.claim((interaction) => interaction ? Effect9.void : Effect9.fail(socketReadError("Missing recorded WebSocket interaction")));
      const transcript = yield* makeReplayTranscript(claimed.interaction, {
        redactor,
        compareClientMessagesAsJson: options.compareClientMessagesAsJson === true,
        secrets
      });
      yield* Ref4.set(active, transcript);
      yield* runReplay(transcript, handler, runOptions?.onOpen).pipe(Effect9.ensuring(Ref4.set(active, undefined)));
    })).pipe(Effect9.flatMap(Option7.match({
      onNone: () => Effect9.fail(socketReadError("Concurrent runs of a replayed WebSocket are not supported")),
      onSome: () => Effect9.void
    }))),
    writer: Effect9.succeed((message) => Ref4.get(active).pipe(Effect9.flatMap((transcript) => transcript ? transcript.write(message) : Effect9.fail(socketWriteError("WebSocket writer used without an active socket run")))))
  });
});

// src/websocket/recorder.ts
var recordingLayer2 = (name, options, forcedMode) => Layer3.effect(Socket4.Socket, Effect10.gen(function* () {
  const upstream = yield* Socket4.Socket;
  const cassette = yield* Service;
  const redactor = make(options.redact);
  const env = yield* configuredSecrets.pipe(Effect10.mapError(() => new InvalidCassetteError({
    cassetteName: name,
    description: "Unable to read secret configuration"
  })));
  if ((forcedMode ?? (yield* resolveAutoMode(cassette, name))) === "record")
    return yield* makeRecordingSocket(upstream, cassette, name, options, redactor);
  return yield* makeReplaySocket(cassette, name, options, redactor, env);
}));
var layerSocket = (name, options = {}) => provideCassette(recordingLayer2(name, { ...options, compareClientMessagesAsJson: true }), options);
var provideCassette = (layer, options) => layer.pipe(Layer3.provide(fileSystem({ directory: options.directory })), Layer3.provide(NodeFileSystem3.layer), Layer3.provide(NodePath3.layer));
var layerWebSocketConstructor = (name, options = {}) => provideCassette(Layer3.effect(Socket4.WebSocketConstructor, Effect10.gen(function* () {
  const upstream = yield* Socket4.WebSocketConstructor;
  const cassette = yield* Service;
  const redactor = make(options.redact);
  const env = yield* configuredSecrets.pipe(Effect10.mapError(() => new InvalidCassetteError({
    cassetteName: name,
    description: "Unable to read secret configuration"
  })));
  if ((yield* resolveAutoMode(cassette, name)) === "replay")
    return yield* makeReplayWebSocketConstructor(cassette, name, redactor, env);
  return yield* makeRecordingWebSocketConstructor(upstream, cassette, name, options.metadata, redactor);
})), options);

// src/index.ts
var HttpRecorder = {
  layer,
  layerFetch,
  layerSocket,
  layerWebSocketConstructor,
  hasCassette,
  removeCassette,
  recordedAt,
  readCassette,
  setTestClockToRecordedAt
};
export {
  CassetteNotFoundError,
  exports_store as CassetteService,
  HttpRecorder,
  InvalidCassetteError,
  MissingRecordedAtError,
  UnsafeCassetteError,
  hasCassette,
  readCassette,
  recordedAt,
  removeCassette,
  setTestClockToRecordedAt
};
