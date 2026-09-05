import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { HttpBody, HttpClientRequest } from "effect/unstable/http"
import { redactedErrorRequest } from "../src/http/recorder"
import { make, redactHeaders, redactUrl } from "../src/redaction/redactor"
import { secretFindings } from "../src/redaction/secrets"

describe("redaction", () => {
  it.effect("redacts every duplicate sensitive query value", () =>
    Effect.sync(() => {
      const url = new URL(
        redactUrl("https://example.test/?token=first-secret&token=second-secret&key=third-secret&safe=value"),
      )
      expect(url.searchParams.getAll("token")).toEqual(["[REDACTED]", "[REDACTED]"])
      expect(url.searchParams.get("key")).toBe("[REDACTED]")
      expect(url.searchParams.get("safe")).toBe("value")
    }),
  )

  it.effect("redacts sensitive URL query parameters", () =>
    Effect.sync(() => {
      expect(
        redactUrl(
          "https://example.test/path?key=secret-google-key&api_key=secret-openai-key&safe=value&X-Amz-Signature=secret-signature",
        ),
      ).toBe(
        "https://example.test/path?key=%5BREDACTED%5D&api_key=%5BREDACTED%5D&safe=value&X-Amz-Signature=%5BREDACTED%5D",
      )
    }),
  )

  it.effect("redacts URL credentials", () =>
    Effect.sync(() => {
      expect(redactUrl("https://user:password@example.test/path?safe=value")).toBe(
        "https://%5BREDACTED%5D:%5BREDACTED%5D@example.test/path?safe=value",
      )
    }),
  )

  it.effect("applies custom URL redaction after built-in redaction", () =>
    Effect.sync(() => {
      expect(
        redactUrl("https://example.test/accounts/real-account/path?key=secret-key", undefined, (url) =>
          url.replace("/accounts/real-account/", "/accounts/{account}/"),
        ),
      ).toBe("https://example.test/accounts/{account}/path?key=%5BREDACTED%5D")
    }),
  )

  it.effect("redacts sensitive headers when allow-listed", () =>
    Effect.sync(() => {
      expect(
        redactHeaders(
          {
            authorization: "Bearer secret-token",
            "content-type": "application/json",
            "x-custom-token": "custom-secret",
            "x-api-key": "secret-key",
            "x-goog-api-key": "secret-google-key",
          },
          ["authorization", "content-type", "x-api-key", "x-goog-api-key", "x-custom-token"],
          ["x-custom-token"],
        ),
      ).toEqual({
        authorization: "[REDACTED]",
        "content-type": "application/json",
        "x-api-key": "[REDACTED]",
        "x-custom-token": "[REDACTED]",
        "x-goog-api-key": "[REDACTED]",
      })
    }),
  )

  it.effect("redacts error requests without retaining headers, params, or body", () =>
    Effect.sync(() => {
      const request = HttpClientRequest.post("https://example.test/path", {
        headers: { authorization: "Bearer super-secret" },
        body: HttpBody.text("super-secret-body", "text/plain"),
      }).pipe(HttpClientRequest.setUrlParam("api_key", "super-secret-key"))

      expect(redactedErrorRequest(request).toJSON()).toMatchObject({
        url: "https://example.test/path",
        urlParams: { params: [] },
        headers: {},
        body: { _tag: "Empty" },
      })
    }),
  )

  it.effect("detects secret-looking values without returning the secret", () =>
    Effect.sync(() => {
      expect(
        secretFindings({
          version: 1,
          interactions: [
            {
              transport: "http",
              request: {
                method: "POST",
                url: "https://example.test/path?key=sk-123456789012345678901234",
                headers: {},
                body: JSON.stringify({
                  nested: "AIzaSyDHibiBRvJZLsFnPYPoiTwxY4ztQ55yqCE",
                }),
              },
              response: {
                status: 200,
                headers: {},
                body: "Bearer abcdefghijklmnopqrstuvwxyz",
              },
            },
          ],
        }),
      ).toEqual([
        { path: "interactions[0].request.url", reason: "API key" },
        { path: "interactions[0].request.body", reason: "Google API key" },
        { path: "interactions[0].response.body", reason: "bearer token" },
      ])
    }),
  )

  it.effect("detects secret-looking values inside metadata", () =>
    Effect.sync(() => {
      expect(
        secretFindings({
          version: 1,
          metadata: { token: "sk-123456789012345678901234" },
          interactions: [],
        }),
      ).toEqual([{ path: "metadata.token", reason: "API key" }])
    }),
  )

  it.effect("detects environment secrets from an explicit env parameter", () =>
    Effect.sync(() => {
      expect(
        secretFindings(
          {
            key: "custom-env-secret-value-12345",
          },
          {
            MY_API_KEY: "custom-env-secret-value-12345",
          },
        ),
      ).toEqual([{ path: "key", reason: "environment secret MY_API_KEY" }])
    }),
  )

  it.effect("redacts configured and common sensitive JSON fields", () =>
    Effect.sync(() => {
      const redactor = make({
        jsonFields: ["account_id"],
      })
      const request = redactor.request({
        method: "POST",
        url: "https://example.test/path",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password: "secret-password",
          accessToken: "access-token",
          nested: { account_id: "account-123", safe: "visible" },
        }),
      })

      expect(JSON.parse(request.body)).toEqual({
        password: "[REDACTED]",
        accessToken: "[REDACTED]",
        nested: { account_id: "[REDACTED]", safe: "visible" },
      })
    }),
  )

  it.effect("preserves JSON text when no fields are redacted", () =>
    Effect.sync(() => {
      const body = '{\n  "id": 9007199254740993,\n  "safe": true\n}'

      expect(
        make().request({
          method: "POST",
          url: "https://example.test/path",
          headers: { "content-type": "application/json" },
          body,
        }).body,
      ).toBe(body)
    }),
  )

  it.effect("extends default header redaction and allow lists", () =>
    Effect.sync(() => {
      const redactor = make({
        headers: ["x-custom-token"],
        allowRequestHeaders: ["anthropic-version", "x-custom-token"],
      })

      expect(
        redactor.request({
          method: "GET",
          url: "https://example.test/path",
          headers: {
            authorization: "Bearer secret",
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-custom-token": "secret",
          },
          body: "",
        }).headers,
      ).toEqual({
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-custom-token": "[REDACTED]",
      })
    }),
  )
})
