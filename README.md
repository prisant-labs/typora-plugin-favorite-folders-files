# Favorites for Typora

Keep favorite folders and Markdown files within reach in Typora.

Repository: [prisant-labs/typora-plugin-favorite-folders-files](https://github.com/prisant-labs/typora-plugin-favorite-folders-files).

## Status

The Favorites development candidate provides mixed file/folder groups, search,
Tabs or Stacked layouts, Outline or Filter group views, A–Z and retained Custom
ordering. Add the current document or folder, move a Favorite, or manage and
arrange groups in sidebar editing pages with explicit Save and Cancel. Removing
a Favorite removes its shortcut only and offers Undo.

On Windows, **Import from Typora** loads a session-only Recent snapshot on
request, from the sidebar Recent tab or Settings. Once imported, **Refresh
snapshot** and **Clear snapshot** live in Settings → Recent; Clear forgets the
snapshot without changing Typora history or saved Favorites. It is not live and
is never written to disk. Refresh after clearing native history. Dates that
Typora's own Recent menu can sort enable Recently opened sorts; separate per-kind
lists cannot establish mixed chronology. Native dates are used only as ordering
keys, not displayed as ages. macOS import is not yet supported. There is no
plugin history collector.

The plugin ID, installation folder and database are
`prisant-labs.favorite-folders-files`; the visible installation name is
Favorites. Earlier unpublished candidates used `prisant-labs.quick-access`, and
their saved Favorites are not carried over. Remove that old plugin folder before
installing this candidate. Existing v1 pins in the Favorites database migrate
once into Ungrouped, with the original record kept as a local recovery copy.

This is a development candidate. Native navigation, save/cancel behavior and
persistence still require the [Typora test checklist](docs/NATIVE-TESTING.md)
before platform support is considered verified.

The settings page follows Outline View's compact metadata, grouped controls and
nearby dropdowns, with a synthetic interactive preview. It does not query release
services or read real recent history for that preview.

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

Production artifacts are created with `pnpm run pack`: `plugin.zip` and an
identical `plugin_typora-favorite-folders-files.zip` copy. The release archive is
limited to the public plugin files declared by the release tooling. This
candidate has not yet been published. See [installation and testing](docs/NATIVE-TESTING.md).

## License

[MIT](LICENSE.md) - Copyright (c) 2026 Prisant Labs.
