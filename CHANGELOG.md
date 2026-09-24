# Changelog

All notable changes to Favorites for Typora are recorded here. Versions follow
[semantic versioning](https://semver.org/).

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
  [native test checklist](docs/NATIVE-TESTING.md), and a self-contained HTML
  preview that CI keeps in sync with the source.

### Notes

- The plugin ID, install folder and database are
  `prisant-labs.favorite-folders-files`. Pre-release test builds used
  `prisant-labs.quick-access`, and their saved Favorites are not migrated.
- macOS is supported but not yet tested natively, and Recent is Windows-only.
- **Recently opened** sorting needs a date on every entry in Typora's Recent
  list; otherwise each Recent tab keeps Typora's order.
