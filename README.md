# Favorites for Typora

Keep favorite folders and Markdown files within reach in Typora.

Repository: [prisant-labs/typora-plugin-favorite-folders-files](https://github.com/prisant-labs/typora-plugin-favorite-folders-files).

## Status

Favorites 0.1.0 is an early release. It provides mixed file/folder groups, search,
Tabs or Stacked layouts, Outline or Filter group views, A–Z and retained Custom
ordering. Add the current document or folder, move a Favorite, or manage and
arrange groups in sidebar editing pages with explicit Save and Cancel. Removing
a Favorite removes its shortcut only and offers Undo.

On Windows, **Recent** shows Typora's own Recent list (File → Open Recent), with
Files and Folders tabs. Favorites reads it while the panel is visible and when
you open a location or return to the window; it never saves, sends or changes
the list, and there is no plugin history collector. Recently opened sorting
needs a date on every entry; otherwise each list keeps Typora's order. Native
dates are ordering keys only, never shown as ages. macOS Recent is not yet
supported.

Click a Favorite or Recent entry to open it in the current window; Ctrl+click
opens a new window on Windows. See the [user guide](docs/USER-GUIDE.md) for
everyday use and an FAQ.

The plugin ID, installation folder and database are
`prisant-labs.favorite-folders-files`; the visible installation name is
Favorites. Earlier unpublished candidates used `prisant-labs.quick-access`, and
their saved Favorites are not carried over. Remove that old plugin folder before
installing this release. Existing v1 pins in the Favorites database migrate
once into Ungrouped, with the original record kept as a local recovery copy.

Windows is the development platform. The maintainer has installed and
exercised Favorites there; the full [native test checklist](docs/NATIVE-TESTING.md)
is still in progress. macOS is a supported target but has not yet been tested natively.
Please [report problems](https://github.com/prisant-labs/typora-plugin-favorite-folders-files/issues).

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
limited to the public plugin files declared by the release tooling. See
[installation and testing](docs/NATIVE-TESTING.md).

## License

[MIT](LICENSE.md) - Copyright (c) 2026 Prisant Labs.
