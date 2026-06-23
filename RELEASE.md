# Release

`effect-http-recorder` is published under the npm `beta` tag while it depends on unstable Effect 4 APIs.

## Prepare A Release

1. Add a Changeset for every user-facing package change.
2. Run `bunx changeset status` and review the planned version.
3. Merge the package changes into `dev`.
4. From a branch based on the latest `dev`, run `bun run version`.
5. Review the generated version and `CHANGELOG.md`, then open and merge the release PR.

The initial `0.1.0` import is the only release that does not require a Changeset.

## Verify And Publish

Before merging the release PR, run:

```sh
bun run check
```

After the release PR reaches `dev`, manually dispatch the `release` workflow from the `dev` branch. The workflow repeats the focused tests, builds and verifies the exact tarball in a clean npm consumer, and publishes it with provenance under the `beta` tag.

The bootstrap release requires an `NPM_TOKEN` repository secret because npm trusted publishing cannot be configured for a package that does not exist yet. Do not copy credentials from another repository. After the package exists, configure its npm trusted publisher for repository `anomalyco/effect-http-recorder` and workflow `release.yml`, then remove `NODE_AUTH_TOKEN` from the workflow so later releases authenticate through GitHub OIDC.

Verify the result:

```sh
npm view effect-http-recorder version dist-tags --json
```
