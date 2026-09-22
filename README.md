# Quick Access for Typora

Keep pinned and recent folders and files within reach in Typora.

## Status

The initial implementation provides a left-sidebar panel for pinned and recent
folders and Markdown files. Pin the current location, search names and paths,
sort pins, filter files to the current folder, and open or reveal a location.
Groups are outside this initial version.

Recent-history collection is implemented but inactive pending the history-source
decision. The preview uses synthetic recents. The installed candidate currently
supports pins and observed Current locations without collecting visit history.

This is a development candidate. Native navigation, save/cancel behavior and
persistence still require the [Typora test checklist](docs/NATIVE-TESTING.md)
before platform support is considered verified.

## Current solution

Open [the self-contained HTML visual anchor](docs/prototype/quick-access.html)
directly in a browser. It renders the production panel, model and styles with
fictional data and simulated host actions. Theme, width and scenario controls
sit outside the plugin UI.

CI runs `pnpm prototype:check` and fails if the committed HTML differs from
the current source. Every visible change must include its updated anchor.

## Candidate requirements

- Typora 1.4.0 or newer
- Typora Community Plugin 2.10.21 or newer
- Windows or macOS

These are declared targets; see the native checklist for validation status.

## Development

Install dependencies with `pnpm install`, run automated checks with
`pnpm test:run`, and validate types with `pnpm typecheck`.

Use `pnpm build:dev` for a development build. `pnpm install:dev` additionally
installs that build into the repository's synthetic `test/vault` fixture; it
does not launch Typora or access real documents.

Use `pnpm prototype:build` after source changes, then `pnpm prototype:check`.
Keep the generated HTML with the code change. Do not regenerate it in CI before
the freshness check, since that would conceal drift.

Production artifacts are created with `pnpm run pack`. The release archive is
limited to the public plugin files declared by the release tooling. This
candidate has not yet been published. See [installation and testing](docs/NATIVE-TESTING.md).

## License

[MIT](LICENSE.md) - Copyright (c) 2026 Prisant Labs.
