import { Schema } from "effect"

export const WebSocketEventSchema = Schema.Union([
  Schema.Struct({
    direction: Schema.Literals(["client", "server"]),
    kind: Schema.tag("text"),
    body: Schema.String,
  }),
  Schema.Struct({
    direction: Schema.Literals(["client", "server"]),
    kind: Schema.tag("binary"),
    body: Schema.String,
    bodyEncoding: Schema.Literal("base64"),
  }),
])

export type WebSocketEvent = Schema.Schema.Type<typeof WebSocketEventSchema>

export const WebSocketInteractionSchema = Schema.Struct({
  transport: Schema.tag("websocket"),
  events: Schema.Array(WebSocketEventSchema),
})

export interface WebSocketInteraction extends Schema.Schema.Type<typeof WebSocketInteractionSchema> {}
