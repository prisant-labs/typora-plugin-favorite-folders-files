# Favorites for Typora: user guide

Favorites adds a sidebar panel to [Typora](https://typora.io) that keeps the
folders and Markdown files you use most one click away. You can organize them
into groups, and see Typora's own Recent list alongside them.

Favorites is an early release. If something behaves differently from what this
guide describes, please [open an issue](https://github.com/prisant-labs/typora-plugin-favorite-folders-files/issues).

## Contents

- [Install](#install)
- [Open the panel](#open-the-panel)
- [Favorites and groups](#favorites-and-groups)
- [Recent](#recent)
- [Opening files and folders](#opening-files-and-folders)
- [Views, sorting and search](#views-sorting-and-search)
- [Settings](#settings)
- [Where your data lives](#where-your-data-lives)
- [Folders, vaults and scopes](#folders-vaults-and-scopes)
- [FAQ](#faq)

## Install

Favorites is a plugin for [Typora Community Plugin](https://github.com/typora-community-plugin/typora-community-plugin)
("Core"). You need:

- Typora 1.4.0 or newer
- Typora Community Plugin 2.10.21 or newer
- Windows or macOS (the Recent list is Windows-only for now)

**From the marketplace** (once listed; the listing is
[pending review](https://github.com/typora-community-plugin/typora-plugin-releases/pull/13)):
open Typora's settings, go to **Plugin Marketplace**, search for **Favorites**,
and install it. Then go to **Installed Plugins** and tick **Favorites** to
enable it. Until then, install it manually.

**Manually:** download `plugin.zip` from the
[latest release](https://github.com/prisant-labs/typora-plugin-favorite-folders-files/releases/latest).
Extract it into a folder named `prisant-labs.favorite-folders-files` inside the
`plugins` folder of your Community Plugin installation (the folder that already
holds your other community plugins). Restart Typora, then enable **Favorites**
under **Installed Plugins**. Manually installed plugins show a small drive icon
there and never appear in the Plugin Marketplace tab.

## Open the panel

Click the **star** in Typora's left ribbon. You can also run
**Favorites: Toggle panel** from the command palette.

The header has three buttons:

| Button | What it does |
|---|---|
| **+** | Add the current document or folder to Favorites |
| **Grid** | Manage groups |
| **Sliders** | Open the Favorites settings |

## Favorites and groups

A Favorite is a shortcut to a Markdown file or a folder. Favorites never moves,
renames or deletes anything on disk.

- **Add a Favorite:** click **+**, choose the current document or folder, pick a
  group, then **Save**. You can also click the **star** on any row, including
  rows in Recent.
- **Move or remove a Favorite:** use the row's **⋯** menu. Removing only removes
  the shortcut, and an **Undo** button appears.
- **Manage groups:** click the grid button to create, rename, delete and reorder
  groups. Deleting a group moves its Favorites to **Ungrouped**, which always
  stays last. To reorder groups by dragging, set **Group order** to **Custom**,
  then drag the dotted grip or use the arrows.
- **Arrange Favorites inside a group:** open the group's **⋯** menu and choose
  **Arrange Favorites**.

Editing pages never save as you go. Changes apply only when you press **Save**;
**Cancel**, **Back** and **Escape** ask before discarding unsaved changes.

## Recent

Recent shows **Typora's own Recent list**, the same one as **File → Open
Recent**, split into **Files** and **Folders**.

- Favorites reads the list while the Favorites panel is visible, and again when
  you open a file or folder, or switch back to the Typora window.
- It is the same in every Typora window, and it survives restarts, because
  Typora keeps it.
- Favorites never saves the list, sends it anywhere, or changes it. To clear
  it, use Typora's own **File → Open Recent → Clear Items**.
- The label next to **Views** says **Most recent first** when every entry has a
  date. If Typora left some entries without a date, it says **Typora's order**
  and each list keeps Typora's own order.
- Recent is available in Typora for Windows only for now.

## Opening files and folders

Clicking works the same way in Favorites and in Recent.

| Action | File | Folder |
|---|---|---|
| **Click** | Opens in this window (Typora and Core tabs decide whether it opens as a tab) | Switches this window's folder (the file tree) |
| **Ctrl+click** (Windows) | Opens in a new window | Opens in a new window |
| **Reveal button** | Shows the file in Explorer or Finder | Opens the folder in Explorer or Finder |

Clicking the folder that is already open in this window does nothing. It is
marked **Current**.

If a Favorite's file or folder has moved or been deleted, the row is marked
**Unavailable** and the shortcut is kept until you remove it.

## Views, sorting and search

- **Views** chooses the layout: **Tabs** shows Favorites and Recent one at a
  time, and **Stacked** shows both in one list. It also chooses how groups
  appear: **Outline** lists every group, and **Filter** shows one group at a
  time.
- **Groups** and **Items** set the sort order: **Custom** (your arranged order),
  **A–Z**, or **Recently opened**. Recently opened follows Typora's Recent list,
  so it is only available when every entry in that list has a date.
- **Search** matches names and paths across your Favorites and Recent.

## Settings

Open Typora's settings, then **Community Plugins → Favorites**, or click the
sliders button in the panel header. The settings page has the same layout and
sorting options as the panel, plus a live preview. The preview uses made-up
sample data and never shows your real Favorites or Recent list.

## Where your data lives

- Favorites are saved on this computer, in Typora's local browser storage (an
  IndexedDB database named `prisant-labs.favorite-folders-files`). They are
  shared by every Typora window on this computer.
- Favorites makes no network requests and collects no telemetry.
- Clearing Typora's application data also removes your Favorites.
- Favorites do not sync between computers.

## Folders, vaults and scopes

Typora opens one folder per window, shown in its file tree. Typora Community
Plugin adds its own idea on top: a folder that contains a `.typora` subfolder
is a **vault**, with its own plugin settings.

| Term | Comes from | Meaning |
|---|---|---|
| Folder | Typora | The folder open in a window's file tree |
| Vault | Community Plugin | A folder that contains a `.typora` subfolder |
| Global Settings | Community Plugin | Plugin settings used for folders that are not vaults |
| Vault Settings | Community Plugin | Plugin settings stored inside that vault |

When you open a vault, the settings title changes to **Vault Settings**, and
plugins are enabled or disabled according to that vault's settings. If
Favorites disappears after you open a particular folder, enable it again under
**Installed Plugins** while that folder is open.

Your Favorites themselves are not stored per vault, so the same Favorites
appear whichever folder is open.

## FAQ

**Why can't I find Favorites in the Plugin Marketplace?**
The marketplace listing may still be
[pending review](https://github.com/typora-community-plugin/typora-plugin-releases/pull/13).
Also, if you installed it manually, it only appears under **Installed
Plugins**; the Marketplace tab lists plugins from the online catalog only.

**Why is "Recently opened" greyed out?**
It follows Typora's Recent list. It is unavailable when that list is
unavailable (for example, on macOS), or when some entries in it have no date.
Until then, Favorites keeps your Custom order.

**Why does Recent say "Typora's order" instead of "Most recent first"?**
Some entries in Typora's Recent list have no date, so Favorites can't be sure
of the order across all of them. Each list keeps the order Typora gave it.

**Why is Recent empty?**
Typora's own list may be empty (check **File → Open Recent**), or you may be on
macOS, where Recent isn't available yet. Recent lists only Markdown files, so
other file types don't appear under **Files**.

**Does Favorites change my Typora history?**
No. It only reads Typora's Recent list while the panel is visible. Typora
itself decides what goes into that list, including files and folders you open
from Favorites.

**Why did clicking a folder open a new window?**
Ctrl+click opens a new window on purpose. Clicking the folder that's already
open does nothing. If a plain click on a different folder opens a new window,
please report it with your Typora version.

**Where did my Favorites go after updating from an early test build?**
Builds before the first public release used a different plugin ID
(`prisant-labs.quick-access`), and their saved Favorites are not carried over.
Remove that old plugin folder, then add your Favorites again.

**Are my Favorites the same in every window and vault?**
Yes. They are stored once per computer, not per window or vault.

**Why does the settings title say "Vault Settings"?**
The folder open in that window contains a `.typora` subfolder, so Typora
Community Plugin is using that folder's own settings. See
[Folders, vaults and scopes](#folders-vaults-and-scopes).
