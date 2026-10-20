# Favorites for Typora: user guide

Favorites adds a sidebar panel to [Typora](https://typora.io) that keeps the
folders and Markdown files you use most one click away. You can organize them
into groups, see Typora's own Recent list alongside them, and browse a folder
tree that starts at folders you choose.

Favorites is an early release. If something behaves differently from what this
guide describes, please [open an issue](https://github.com/prisant-labs/typora-plugin-favorite-folders-files/issues).

## Contents

- [Install](#install)
- [Open the panel](#open-the-panel)
- [Favorites and groups](#favorites-and-groups)
- [Recent](#recent)
- [Browse](#browse)
- [Opening files and folders](#opening-files-and-folders)
- [Views, sorting and search](#views-sorting-and-search)
- [Settings](#settings)
- [Updates](#updates)
- [Where your data lives](#where-your-data-lives)
- [Folders, vaults and scopes](#folders-vaults-and-scopes)
- [FAQ](#faq)

## Install

Favorites is a plugin for [Typora Community Plugin](https://github.com/typora-community-plugin/typora-community-plugin)
("Core"). You need:

- Typora 1.4.0 or newer
- Typora Community Plugin 2.10.21 or newer
- Windows or macOS (Recent on macOS is new in 0.1.3; see [Recent](#recent))

**From the marketplace:** open Typora's settings, go to **Plugin
Marketplace**, search for **Favorites**, and install it. Then go to
**Installed Plugins** and tick **Favorites** to enable it.

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
  you open a file or folder, or switch back to the Typora window. It also reads
  it when you run **Favorites: Copy Recent diagnostics**.
- It is the same in every Typora window, and it survives restarts, because
  Typora keeps it.
- Favorites never saves the list, sends it anywhere, or changes it. To clear
  it, use Typora's own **File → Open Recent → Clear Items**.
- The label next to **Views** says **Most recent first** when every entry has a
  date. If Typora left some entries without a date, it says **Typora's order**
  and each list keeps Typora's own order.
- Recent works in Typora for Windows and macOS. Recent on macOS is new in
  0.1.3.
- On macOS, Typora passes its Recent files to Favorites without dates, so
  Recent says **Typora's order** there and **Recently opened** sorting is
  unavailable.

## Browse

Browse is a folder tree that starts at folders you choose. Typora's own file
tree shows the folder of whatever file you open last, and has no way up. Browse
stays where you left it, whichever file Typora opens. Browse has been used in
Typora on Windows. It has not yet been tested in Typora on macOS.

The tree shows your **root folders** and two built-in entries, in the order
you set on **Manage Browse roots**. Until you move them, the built-in entries
come after your roots:

- **Home**, your user folder, such as `C:\Users\<you>` or `/Users/<you>`.
  Favorites finds it for you. It is left out if Typora does not say where it
  is.
- **Drives** on Windows, or **Volumes** on macOS. It lists your drives or
  mounted volumes when you expand it.

Root folders are the starting points you choose; there is no separate home
folder setting for Browse. Add a folder you work in, such as `D:\Notes`, as a
root, and it appears after your other roots. You can have up to 50 roots, on
any drives, in any order.

### More than one drive

- **Drives** lists every drive letter Windows reports, from **C:** to **Z:**.
  That includes USB drives and network drives mapped to a letter. Expand a drive
  to browse it from its top folder.
- On macOS, **Volumes** lists the internal disk, external drives and mounted
  network shares.
- A root can be on any drive, and a whole drive can be a root, such as `D:\`.
- A network share without a drive letter, such as `\\server\notes`, does not
  appear under **Drives**. Add it as a root by its full path instead.
- Browse reads the list of drives again when you switch back to the Typora
  window, so a drive you plug in appears then. A root on a drive that is not
  connected stays in your list. When you expand it, Browse shows
  **Unavailable** or **Could not be read** in place of its contents.
- Drive letters **A:** and **B:** are not listed.

### Using the tree

- **Click a folder** to expand or collapse it. Browse reads one folder at a
  time, when you expand it, and remembers which folders you expanded.
- **Click a Markdown file** to open it in this window. On Windows,
  **Ctrl+click** opens it in a new window.
- **Arrow keys:** Up and Down move between rows; Right expands a folder or
  steps into it; Left collapses it or steps out to its parent.
- Browse shows folders and Markdown files only. It hides names that start with
  a dot, and on Windows, system folders such as `$Recycle.Bin`.
- A folder Browse cannot read shows **No access**, **Unavailable** or **Could
  not be read** in place of its contents.
- The **star** adds a folder or file to Favorites, and the reveal button shows
  it in Explorer or Finder.
- A folder's **⋯** menu has **Open in Typora**, which makes it the folder
  Typora has open, as if you opened it from Typora's own folder menu. It also
  has **Add to Browse roots** or **Remove from Browse roots**.

### Manage roots

While the **Browse** tab is selected, the **gear** at the right end of the
**Views** row opens **Manage Browse roots**. That is the place where Recent
shows its order and Favorites shows its sorting. In the **Stacked** layout, the
gear sits at the end of the **Browse** section heading.

On that page, the **Roots** list holds your root folders, **Home** and
**Drives** (**Volumes**). You can:

- reorder the list by dragging the dotted grip, or with the arrows, so that
  Home and Drives can sit anywhere among your roots;
- remove a root;
- hide **Home** or **Drives** with its eye button. A hidden entry stays in the
  list, dimmed, so you can show it again in the same place.

Under **Add a root**, you can:

- add a folder with **Choose folder…**, which opens Typora's own folder dialog;
- add the folder Typora has open;
- add any folder by typing its full path, such as `D:\Notes`,
  `\\server\notes` or `/Volumes/Notes`.

A new root goes right after your last root. Like the other editing pages, this
page saves nothing until you press **Save**. If a folder cannot be added, the
reason appears right below the path field.

The same choices are on the settings page, under **Browse** (see
[Settings](#settings)). There, each change is saved at once, like the other
settings.

Browse reads folders again when you open the panel or switch back to the
Typora window, so files added outside Typora appear. On macOS, reading folders
such as Documents or Desktop may make macOS ask whether Typora may access them.

## Opening files and folders

Clicking works the same way in Favorites and in Recent. In Browse, clicking a
folder expands it instead; use its **⋯** menu to open it in Typora.

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

- **Views** chooses the layout: **Tabs** shows Favorites, Recent and Browse one
  at a time, and **Stacked** shows all three in one list. Each collection's
  tab and section heading carries its icon: a star for Favorites, a clock for
  Recent and a folder tree for Browse. Both layouts follow the
  **Tab order** setting (see [Settings](#settings)). It also chooses how groups
  appear: **Outline** lists every group, and **Filter** shows one group at a
  time.
- **Groups** and **Items** set the sort order: **Custom** (your arranged order),
  **A–Z**, or **Recently opened**. Recently opened follows Typora's Recent list,
  so it is only available when every entry in that list has a date.
- **Search** matches names and paths across your Favorites and Recent. It does
  not search Browse.

## Settings

Open Typora's settings, then **Community Plugins → Favorites**, or click the
sliders button in the panel header. The settings page has the same layout and
sorting options as the panel, plus a live preview. The preview uses made-up
sample data and never shows your real Favorites, Recent list or folders.

**Tab order**, under **Display**, sets the order of the **Favorites**,
**Recent** and **Browse** tabs. Use the arrows beside a tab to move it. The
order also applies to the sections of the **Stacked** layout, and the live
preview shows it at once. Each move is saved straight away, and every Typora
window follows it. The panel keeps the tab you last selected, wherever it sits
in the order.

**Browse** has two rows. **Roots** lists your root folders, **Home** and
**Drives** (**Volumes** on macOS) in one list, with arrows to move each entry.
A root folder has a button to remove it, and Home and Drives each have an eye
button to hide or show them. **Add a root** adds a folder with **Choose
folder…**, adds the folder Typora has open, or takes a folder's full path. Each
change is saved straight away, and the panel follows it.

If a setting cannot be saved, or a folder cannot be added, the message appears
in that setting's own row.

## Updates

When the Plugin Marketplace has a newer version of Favorites, an **Update**
pill with that version appears in the panel header and next to the installed
version on the settings page. In a narrow sidebar, the panel pill shows only an
arrow and the version.

- **Click the pill** to open a confirmation. It names both versions and links
  to the release notes. **Update** hands the work to Community Plugin Core,
  which downloads the new version from GitHub and reloads Favorites in that
  window. If Core's copy of the Marketplace lists is out of date, Core reloads
  it first, even with the automatic check off, because you asked for the
  update. Other Typora windows keep the old
  version until you restart them.
- **Your saved Favorites are kept.** They live in Typora's local storage, not
  in the plugin folder that the update replaces.
- **If the download fails**, Core has already removed the old version, so
  reinstall Favorites from the Plugin Marketplace. Your saved Favorites are
  still there.

How Favorites learns about a new version:

- Community Plugin Core keeps a copy of the Plugin Marketplace lists while
  Typora runs, once you open its **Installed Plugins** or **Plugin
  Marketplace** tab. Favorites reads that copy without any request of its own.
- With **Check for updates automatically** on (the default), Favorites also
  asks Core to load those lists when the panel or the settings page opens, at
  most once a day across all Typora windows. Core downloads the Marketplace's
  public lists from GitHub, using Core's GitHub proxy setting. Favorites sends
  nothing about you or your files.
- Turn the check off under **Updates** on the Favorites settings page. The pill
  can still appear after you open Core's own plugin tabs, because that costs no
  request.

## Where your data lives

- Favorites are saved on this computer, in Typora's local browser storage (an
  IndexedDB database named `prisant-labs.favorite-folders-files`). They are
  shared by every Typora window on this computer.
- Browse saves its root folders, where Home and Drives sit and whether they
  are shown, which folders
  are expanded, and the tab order, in the same database. It keeps folder contents only in
  memory. On macOS, each folder it reads runs one `ls` command through Typora,
  with the folder's path quoted; that is the only shell command Favorites runs.
- Favorites collects no telemetry and sends nothing about you or your files.
  It causes network requests only through Community Plugin Core: the update
  check, which you can turn off, and an update you confirm. Both are described
  under [Updates](#updates).
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

**How do I update Favorites?**
Click the **Update** pill in the panel header or on the settings page, then
**Update** in the confirmation. Without a pill, you already have the newest
version, or the check is off; Core's **Installed Plugins** tab also offers
updates. See [Updates](#updates).

**Why can't I find Favorites in the Plugin Marketplace?**
If you installed it manually, it only appears under **Installed Plugins**; the
Marketplace tab lists plugins from the online catalog only.

**Why is "Recently opened" greyed out?**
It follows Typora's Recent list. It is unavailable when that list is
unavailable, or when some entries in it have no date. While it is unavailable,
Favorites keeps your Custom order. On macOS, Typora passes its Recent files
without dates, so Recently opened is always unavailable there.

**Why does Recent say "Typora's order" instead of "Most recent first"?**
Some entries in Typora's Recent list have no date, so Favorites can't be sure
of the order across all of them. Each list keeps the order Typora gave it.

**Why is Recent empty?**
Typora's own list may be empty (check **File → Open Recent**). Recent lists
only Markdown files, so other file types don't appear under **Files**. On
macOS, Favorites 0.1.2 and earlier show a message there instead, because they
read Recent on Windows only.

**Recent shows an error or the wrong files. How do I report it?**
Run **Favorites: Copy Recent diagnostics** from the command palette. It reads
Typora's Recent list the way the panel does (twice on macOS), then shows a
report with a **Copy report** button. The report lists counts, kinds and
timings, never paths or names, so you can paste it into an
[issue](https://github.com/prisant-labs/typora-plugin-favorite-folders-files/issues)
as it is.

**Does Favorites change my Typora history?**
No. It only reads Typora's Recent list while the panel is visible, or when you
run **Favorites: Copy Recent diagnostics**. Typora
itself decides what goes into that list, including files and folders you open
from Favorites.

**How is Browse different from Typora's own file tree?**
Typora's file tree shows the folder Typora has open, and it moves when you open
a file somewhere else. Browse starts at your root folders and stays where you
left it. To make Typora's tree match a folder in Browse, use that folder's
**⋯** menu → **Open in Typora**.

**Why doesn't Browse show all my files?**
Browse lists folders and Markdown files only. It hides names that start with a
dot and, on Windows, system folders such as `$Recycle.Bin`. The other files are
still there; open them from Explorer or Finder.

**Why does a folder in Browse say "No access"?**
Your computer did not let Typora read it. On macOS, folders such as Documents
or Desktop need your permission, and macOS asks the first time. If you chose
**Don't Allow**, turn Typora on under **System Settings → Privacy & Security →
Files and Folders**. On Windows, some old shortcut folders inside your user
folder, such as `Application Data`, always say **No access**; that is expected.

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
