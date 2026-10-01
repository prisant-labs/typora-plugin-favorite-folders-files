# Changelog

All notable changes to Favorites for Typora are recorded here. Versions follow
[semantic versioning](https://semver.org/).

## Unreleased

### Added

- **Recent** on macOS. It shows Typora's Recent folders, from the same call as
  Typora's sidebar folder menu, and Typora's Recent Markdown files, from the
  list Typora sends to Quick Open. As on Windows, it is read only while the
  panel is visible, kept in memory, and never saved. Typora passes its macOS
  Recent files without dates, so on macOS each tab keeps Typora's order and
  **Recently opened** sorting is unavailable.
- Both macOS channels were found in Typora's page code. Neither has been
  tested in Typora on macOS yet.

### Changed

- When Recent is unavailable, the panel now says "Typora's Recent list isn't
  available in this version of Typora." instead of naming Windows.
- The settings page's Recent section now says Recent is available in Typora for
  Windows, and for macOS, where it has not yet been tested.

## 0.1.2 (2026-09-30)

### Fixed

- On macOS, the **Favorites** panel now fills the sidebar. It had been
  squeezed into the right-hand part of the sidebar, with the header buttons
  overlapping the title and the toolbar cut off. Typora lays out the sidebar
  as a row on macOS and a column on Windows, and the panel now fills it either
  way.
- On macOS, Typora's own sidebar header row no longer shows above Favorites.
  That row kept its last title (for example "Outline") while Favorites was
  open. It returns when you switch to Files or Outline, and the ribbon keeps
  the Files, Outline and Search buttons.
- Both macOS fixes were checked in a browser reproduction of Typora's macOS
  sidebar layout. They have not yet been re-tested in Typora on macOS.
- In the menu that opens when you right-click the ribbon, **Favorites** now
  shows a small star beside its name, like the other entries, instead of a
  large star above it. Checked in a browser reproduction of Core's menu; not
  yet re-tested in Typora.

### Changed

- Favorites is now listed in Typora's **Plugin Marketplace**
  ([typora-plugin-releases#13](https://github.com/typora-community-plugin/typora-plugin-releases/pull/13),
  merged 2026-09-25), so it can be installed from there as well as manually.

## 0.1.1 (2026-09-24)

### Fixed

- **Recent** on Windows now orders files and folders together. Typora stores
  folder dates as ISO 8601 text but file dates as numbers, and folder dates were
  being read as missing. That also re-enables **Recently opened** sorting and
  the **Most recent first** label. Only full ISO 8601 timestamps are accepted;
  looser date text still counts as missing, so no order is guessed.

## 0.1.0 (2026-09-24)

First public release.

### Added

- A **Favorites** sidebar panel, opened from the star in Typora's ribbon or with
  the **Favorites: Toggle panel** command, plus a **Favorites: Settings**
  command.
- Favorites for Markdown files and folders, saved from the current document or
  folder, or with the star on any row.
- Groups: create, rename, delete and reorder them (drag or arrows), and arrange
  the Favorites inside each group. **Ungrouped** always comes last. Editing
  pages apply changes only on **Save**.
- Removing a Favorite offers **Undo**. Favorites whose file or folder has moved
  are marked **Unavailable** and kept until you remove them.
- **Recent** (Windows): a live, read-only view of Typora's own Recent list, with
  **Files** and **Folders** tabs. It is read only while the panel is visible and
  is never saved or changed.
- **Views**: Tabs or Stacked layout, Outline or Filter group view, and Custom,
  A–Z or Recently opened sorting for groups and items. Search matches names and
  paths across Favorites and Recent.
- Opening: a click opens in this window, and the folder already open is marked
  **Current**. **Ctrl+click** opens a new window (Windows). A reveal button
  shows files and folders in Explorer or Finder.
- A settings page aligned with Outline View, with a live preview that uses
  sample data only.
- A [user guide](docs/USER-GUIDE.md) with an FAQ, a
  [native test checklist](test/native/README.md), and a self-contained HTML
  preview that CI keeps in sync with the source.

### Notes

- The plugin ID, install folder and database are
  `prisant-labs.favorite-folders-files`. Pre-release test builds used
  `prisant-labs.quick-access`, and their saved Favorites are not migrated.
- macOS is supported but not yet tested natively, and Recent is Windows-only.
- **Recently opened** sorting needs a date on every entry in Typora's Recent
  list; otherwise each Recent tab keeps Typora's order.
