# Security

## Supported versions

Only the latest release of Favorites receives security fixes. Update through
the **Update** pill or the Plugin Marketplace before reporting a problem.

## What counts as a security problem

Favorites runs inside Typora with access to your files, so these are security
problems:

- Favorites runs any command other than the single quoted `ls` that Browse uses
  on macOS, or a folder name changes what that command does.
- Favorites writes, moves, renames or deletes anything on disk. It should only
  read folders and save its own data in Typora's local storage.
- A path, file name or Recent entry leaves the computer, or appears in a
  diagnostics report, a release file or the repository.
- Favorites makes a network request of its own. Its only requests are the
  update check and updates, both carried out by Community Plugin Core.

## Reporting a problem

Please don't describe a security problem in a public issue.

1. If this repository's **Security** tab offers **Report a vulnerability**, use
   it. Only the maintainer sees the report.
2. Otherwise, open an issue titled "Security contact request", with no details.
   The maintainer will reply with a private way to send them.

Please include the Favorites, Typora and Community Plugin versions, your
platform, and steps that show the problem. Use made-up folder names.
