import { Effect, Schema } from "effect"
import type { JsonValue } from "../api.js"
import { HttpInteractionSchema } from "../http/model.js"
import { WebSocketInteractionSchema } from "../websocket/model.js"

export type { CassetteMetadata, JsonValue } from "../api.js"

const JsonValueSchema = Schema.suspend((): Schema.Codec<JsonValue> =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(JsonValueSchema),
    Schema.Record(Schema.String, JsonValueSchema),
  ]),
)

export const CassetteMetadataSchema = Schema.Record(Schema.String, JsonValueSchema)

export const InteractionSchema = Schema.Union([HttpInteractionSchema, WebSocketInteractionSchema]).pipe(
  Schema.toTaggedUnion("transport"),
)
export type Interaction = Schema.Schema.Type<typeof InteractionSchema>

export const isHttpInteraction = InteractionSchema.guards.http

export const isWebSocketInteraction = InteractionSchema.guards.websocket

export const httpInteractions = (interactions: ReadonlyArray<Interaction>) => interactions.filter(isHttpInteraction)

export const webSocketInteractions = (interactions: ReadonlyArray<Interaction>) =>
  interactions.filter(isWebSocketInteraction)

export const CassetteSchema = Schema.Struct({
  version: Schema.Literal(1),
  metadata: Schema.optionalKey(CassetteMetadataSchema),
  interactions: Schema.Array(InteractionSchema),
})
export type Cassette = Schema.Schema.Type<typeof CassetteSchema>

export const decodeCassette = Schema.decodeUnknownEffect(CassetteSchema)
export const encodeCassette = Schema.encodeEffect(CassetteSchema)

export const RecordedAt = Schema.DateTimeUtcFromString

export class MissingRecordedAtError extends Schema.TaggedError<MissingRecordedAtError>()("MissingRecordedAtError", {
  cassetteName: Schema.String,
}) {
  override get message() {
    return `Cassette "${this.cassetteName}" does not have a recordedAt timestamp. Re-record the cassette to enable clock anchoring.`
  }
}

const decodeRecordedAt = Schema.decodeUnknownEffect(
  Schema.Struct({ recordedAt: Schema.OptionFromOptionalKey(RecordedAt) }),
)

export const getRecordedAt = Effect.fn("Cassette.getRecordedAt")(function* (cassette: Cassette) {
  const metadata = yield* decodeRecordedAt(cassette.metadata ?? {})
  return metadata.recordedAt
})

export * as CassetteModel from "./model.js"
