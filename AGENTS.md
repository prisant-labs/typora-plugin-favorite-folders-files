# Repository guidance

## Orientation

- Read `ARCHITECTURE.md` for the module map, the saved records and how the
  plugin talks to Typora. Read `CONTRIBUTING.md` for the change workflow, CI
  and the release steps.
- `docs/` is user-facing only: the user guide, the README images and the
  preview page. Put tester material, such as native checklists and probes,
  under `test/native/`.
- `_local/` is private and ignored by Git. Never stage anything from it.

## Product identity

- Use **Favorites for Typora** as the public README title.
- Use **Favorites** for the plugin manifest, settings, commands, ribbon,
  marketplace, and panel labels.
- Keep the plugin ID `prisant-labs.favorite-folders-files` stable. It replaced
  `prisant-labs.quick-access` before first publication by maintainer decision on
  2026-09-23; saved data from that earlier ID is intentionally not migrated.
- Use `typora-plugin-favorite-folders-files` as the repository and package slug.
- Keep the database and installation folder `prisant-labs.favorite-folders-files`
  stable across display branding and repository renames.

## Scope and safety

- Prefer Typora Community Plugin public APIs over Typora internals.
- Support Windows and macOS paths without assuming one separator or drive
  layout.
- Keep destructive file operations out of the plugin. Favorites navigates
  to folders and files; it does not move, rename, or delete them.
- Treat paths and recent-item history as local user data. Do not add telemetry
  or include local paths in committed fixtures, logs, or release artifacts.
- Use clearly synthetic fixture names and contents.
- Never add a key to the Favorites preferences in the `current` record. Version
  0.1.4 rejects the whole record when it meets an unknown key. Keep new
  settings and view state in a record of their own through `SharedRecordStore`
  (`src/record-store.ts`), as `updates` and `browse` do.
- Do not use `structuredClone` in code that runs in Typora; older macOS WebKit
  lacks it. Copy explicitly, as `cloneBrowseRecord` does.
- Browse only reads. On macOS its single shell command is a quoted `/bin/ls`;
  do not add other shell commands, and always quote paths with `shellQuote`.

## Development expectations

- The current visual anchor is `docs/prototype/quick-access.html`. Open it to
  inspect the current solution before changing visible behavior.
- Render the production panel, model, and styles in that self-contained page.
  Adapt only host services and synthetic fixtures; do not maintain a second UI.
- Run `pnpm prototype:build` after source changes and commit the generated HTML.
  `pnpm prototype:check` must pass in CI without first regenerating the page.
- After visible changes, run `pnpm docs:screenshots` to regenerate the README
  images from the visual anchor, and review every image for private content
  before committing it. Only metadata-free PNGs under `docs/images/` pass the
  privacy check.
- Record user-visible changes in `CHANGELOG.md`.
- Add or update tests before implementing behavior.
- Run `pnpm test:run` and `pnpm typecheck` for code changes.
- Stage changes and run `pnpm privacy:check` before committing. CI runs
  `pnpm privacy:tracked` over every tracked file.
- Run `pnpm run pack` and `pnpm release:check` before preparing a release artifact.
- Do not describe behavior as verified in Typora until a native manual test has
  actually been performed and recorded.
- Keep release archives limited to the allowlisted public plugin files.
- Feature pull requests never change the version. A release is its own
  "Release X.Y.Z" pull request. Tags are bare (`0.1.5`, never `v0.1.5`).
  Publish the exact `plugin.zip` that `release.mjs --check --tag` validated.
