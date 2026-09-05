import { ConfigProvider, Effect, Schema } from "effect";
/** Enumerates the active provider, including values on non-leaf configuration nodes. */
export declare const configuredSecrets: Effect.Effect<Record<string, string>, ConfigProvider.SourceError, never>;
export declare const SecretFindingSchema: Schema.Struct<{
    readonly path: Schema.String;
    readonly reason: Schema.String;
}>;
export type SecretFinding = Schema.Schema.Type<typeof SecretFindingSchema>;
export declare const secretFindings: (value: unknown, env?: Record<string, string | undefined>) => ReadonlyArray<SecretFinding>;
