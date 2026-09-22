# Quick Access for Typora

Keep pinned and recent folders and files within reach in Typora.

## Status

This repository currently contains the plugin foundation: public metadata,
build and packaging safeguards, and a lifecycle-only entrypoint. User-facing
navigation behavior has not been implemented or verified in Typora yet.

## Requirements

- Typora 1.4.0 or newer
- Typora Community Plugin 2.10.21 or newer
- Windows or macOS

## Development

Install dependencies with `pnpm install`, run automated checks with
`pnpm test:run`, and validate types with `pnpm typecheck`.

Use `pnpm build:dev` for a development build. `pnpm install:dev` additionally
installs that build into the repository's synthetic `test/vault` fixture; it
does not launch Typora or access real documents.

Production artifacts are created with `pnpm run pack`. The release archive is
limited to the public plugin files declared by the release tooling. This
foundation has not yet been published.

## License

[MIT](LICENSE.md) - Copyright (c) 2026 Prisant Labs.
