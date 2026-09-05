import { Encoding, Result, Schema } from "effect"

export const RequestSnapshotSchema = Schema.Struct({
  method: Schema.String,
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
})

export type { RequestSnapshot } from "../api.js"

export const ResponseSnapshotSchema = Schema.Struct({
  status: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 200, maximum: 599 })),
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
  bodyEncoding: Schema.optional(Schema.Literals(["text", "base64"])),
}).check(
  Schema.makeFilter(
    (snapshot) => snapshot.bodyEncoding !== "base64" || Result.isSuccess(Encoding.decodeBase64(snapshot.body)),
    { message: "Invalid base64 response body" },
  ),
)

export interface ResponseSnapshot extends Schema.Schema.Type<typeof ResponseSnapshotSchema> {}

export const HttpInteractionSchema = Schema.Struct({
  transport: Schema.tag("http"),
  request: RequestSnapshotSchema,
  response: ResponseSnapshotSchema,
})

export interface HttpInteraction extends Schema.Schema.Type<typeof HttpInteractionSchema> {}

export * as HttpModel from "./model.js"
