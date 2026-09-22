# Repository guidance

## Product identity

- Use **Quick Access for Typora** as the public README and repository title.
- Use **Quick Access** for the plugin manifest, settings, commands, ribbon,
  marketplace, and panel labels.
- Keep the plugin ID `prisant-labs.quick-access` stable.

## Scope and safety

- Prefer Typora Community Plugin public APIs over Typora internals.
- Support Windows and macOS paths without assuming one separator or drive
  layout.
- Keep destructive file operations out of the plugin. Quick Access navigates
  to folders and files; it does not move, rename, or delete them.
- Treat paths and recent-item history as local user data. Do not add telemetry
  or include local paths in committed fixtures, logs, or release artifacts.
- Use clearly synthetic fixture names and contents.

## Development expectations

- The current visual anchor is `docs/prototype/quick-access.html`. Open it to
  inspect the current solution before changing visible behavior.
- Render the production panel, model, and styles in that self-contained page.
  Adapt only host services and synthetic fixtures; do not maintain a second UI.
- Run `pnpm prototype:build` after source changes and commit the generated HTML.
  `pnpm prototype:check` must pass in CI without first regenerating the page.
- Add or update tests before implementing behavior.
- Run `pnpm test:run` and `pnpm typecheck` for code changes.
- Run `pnpm run pack` and `pnpm release:check` before preparing a release artifact.
- Do not describe behavior as verified in Typora until a native manual test has
  actually been performed and recorded.
- Keep release archives limited to the allowlisted public plugin files.
