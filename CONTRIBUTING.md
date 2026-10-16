# Contributing

This guide covers setting up, making a change, and cutting a release.
[ARCHITECTURE.md](ARCHITECTURE.md) explains how the plugin works.
[AGENTS.md](AGENTS.md) holds the repository's rules, which apply to people and
coding agents alike.

## Ground rules

- **Favorites never changes files on disk.** It opens and reveals folders and
  files. It never moves, renames or deletes them.
- **Paths are private.** Never put a real path, user name or Recent entry in a
  commit, a test fixture, a log or a screenshot. Use clearly synthetic names,
  such as `C:/Example/Projects` or `/Projects/Atlas`.
- **Saved data must stay readable by older versions.** Never add a key to the
  Favorites preferences in the `current` record. Version 0.1.4 rejects the
  whole record when it meets one. Put new settings in a record of their own;
  [ARCHITECTURE.md](ARCHITECTURE.md#saved-data) explains how.
- **Say only what was tested.** Describe behavior as working in Typora only
  after a native test has been run and recorded.

## Set up

1. Install Node 22, and the pnpm version named in `package.json`
   (`packageManager`). Corepack can install it for you.
2. Run `pnpm install --frozen-lockfile`.
3. For native testing, install Typora 1.4.0 or newer and Typora Community
   Plugin 2.10.21 on Windows or macOS.
4. `pnpm docs:screenshots` needs Edge or Chrome.

The command table is in the [README](README.md#development).

## Where things go

| Path | Holds |
|---|---|
| `src/` | Plugin source, with each module's tests beside it as `*.test.ts` |
| `prototype/` | The sources of the preview page |
| `docs/` | User-facing material only: the user guide, the README images, and the preview page |
| `test/native/` | Material for testers: the native checklist and DevTools probes |
| `test/vault/`, `test/outside-vault/` | Synthetic folders for native tests |
| `test/support/` | Test stand-ins, such as the Core stub |
| `scripts/` | Build, preview, screenshot, privacy and release scripts, with their tests |
| `_local/` | Private working notes, ignored by Git. Never commit anything from it. |

## Make a change

1. Branch from `main`.
2. Write or update the tests first, then the code. Run `pnpm test:run` and
   `pnpm typecheck`.
3. If the change is visible, run `pnpm prototype:build`. Open
   `docs/prototype/quick-access.html` and try the affected states in light and
   dark themes.
4. Run `pnpm docs:screenshots`, and look at every image it rewrites. The
   privacy check can't see pixels, so this review is the only check on them.
5. Record user-visible changes under `## Unreleased` in
   [CHANGELOG.md](CHANGELOG.md). Update the [user guide](docs/USER-GUIDE.md)
   and the [README](README.md) when behavior changes.
6. For behavior that only Typora can show, add steps to
   [test/native/README.md](test/native/README.md).
7. Stage your changes and run `pnpm privacy:check`. It scans what the commit
   would add for home-folder paths, keys and image metadata.
8. Open a pull request to `main`.

A feature pull request never changes the version. Releases have their own pull
request (see [Release](#release)).

## Pull requests and CI

CI runs on Ubuntu and Windows for every pull request to `main`. The **CI
required** job passes only when both pass. Each run:

1. checks that the committed preview page is current (`pnpm prototype:check`);
2. scans every tracked file for private content (`pnpm privacy:tracked`);
3. runs the tests and the typecheck;
4. builds `plugin.zip` and validates it (`pnpm run pack`, `pnpm release:check`);
5. audits the dependencies (`pnpm audit --audit-level=moderate`).

In the pull request description, say what you verified and how. Say plainly
what has not been tested in Typora.

## Native testing

[test/native/README.md](test/native/README.md) lists the checks that need
Typora itself. Use disposable folders with synthetic names. Until a step has
been run and recorded, the README, the user guide and the release notes must
say that the behavior is not yet tested in Typora.

## Release

A release ships what is already merged on `main`, through its own pull
request.

1. **Choose the version.** Versions follow semantic versioning. Tags are bare
   (`0.1.5`, never `v0.1.5`). Core downloads
   `releases/download/<version>/plugin.zip`, so a prefixed tag breaks updates.
2. **Open a "Release X.Y.Z" pull request** that:
   - sets the version in `package.json` and `src/manifest.json`;
   - updates the expected version in `test/foundation/metadata.test.ts`;
   - updates `INSTALLED` in `prototype/main.ts`;
   - renames `## Unreleased` in the changelog to `## X.Y.Z (YYYY-MM-DD)`;
   - regenerates the preview page and the screenshots, since the settings
     image shows the version.
3. **After it merges**, build from `main`: run `pnpm run pack`, then
   `node scripts/release.mjs --check --tag X.Y.Z`. The check fails if the tag
   and the version differ. It prints the archive's SHA-256.
4. **Tag and publish.** Push the tag `X.Y.Z` on the merge commit. Create a
   GitHub release named `X.Y.Z` with the notes described below, and attach the
   `plugin.zip` that the check validated. Don't build again between checking
   and uploading: two builds of the same commit can differ (see
   [ARCHITECTURE.md](ARCHITECTURE.md#builds-and-the-release-archive)).
5. **Confirm the download.** Fetch `releases/download/X.Y.Z/plugin.zip` and
   compare its SHA-256 with the one in the notes.
6. **Confirm the Plugin Marketplace** offers the new version. Its lists are
   kept outside this repository.

### Release notes

Release notes follow the shape of earlier releases:

1. One sentence that says what the release does.
2. `## Added`, `## Fixed` and `## Changed`, written for users, from the
   changelog.
3. `## Tested so far`, which says what has and has not been tested in Typora.
4. A link for reporting problems, and a link to the changelog at the tag.
5. `## Install or update`: the Plugin Marketplace, or a manual install of
   `plugin.zip`. Say that saved Favorites are kept.
6. `## Checksum`, with the SHA-256 of `plugin.zip`.
