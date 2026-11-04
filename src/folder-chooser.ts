import type { Platform } from './model'

/** Asks for one folder with Typora's own dialog. Resolves to undefined when the dialog is cancelled. */
export type FolderChooser = (defaultPath?: string, title?: string) => Promise<string | undefined>
/** Asks for one Markdown file with Typora's own dialog. Resolves to undefined when the dialog is cancelled. */
export type FileChooser = (defaultPath?: string) => Promise<string | undefined>
export interface WindowsDialogBridge { invoke(command: string, ...args: unknown[]): unknown }
export interface MacDialogBridge { callHandler(name: string, data: unknown, callback: (result: unknown) => void): void }

/** A file URL from the macOS dialog becomes a path; anything empty is a cancel. */
function chosenPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  if (!value.startsWith('file://')) return value
  try { return decodeURIComponent(new URL(value).pathname) || undefined } catch { return undefined }
}

/**
 * Typora's folder dialog, as Typora itself calls it. Core 2.10.21 has none to offer. Windows: the
 * Electron dialog behind Typora's own "Select Container Folder". macOS: the handler behind its export
 * folder choice; `controller.selectFolder` would switch the folder Typora has open instead.
 */
export function folderChooser(platform: Platform, bridges: { windows?: () => WindowsDialogBridge | undefined; mac?: () => MacDialogBridge | undefined }): FolderChooser | undefined {
  if (platform === 'win32' && bridges.windows?.()) {
    return async (defaultPath, title = 'Choose a folder for Browse') => {
      const result = await bridges.windows!()!.invoke('dialog.showOpenDialog', {
        title, defaultPath: defaultPath?.replace(/\//g, '\\'),
        // Choosing a folder here is not opening it, so it stays out of the Windows Recent list.
        properties: ['openDirectory', 'dontAddToRecent'], buttonLabel: 'Choose',
      }) as { filePaths?: unknown } | undefined
      return Array.isArray(result?.filePaths) ? chosenPath(result.filePaths[0]) : undefined
    }
  }
  if (platform === 'darwin' && bridges.mac?.()) {
    return defaultPath => new Promise((resolve, reject) => {
      try { bridges.mac!()!.callHandler('path.selectFolderOrFile', { dir: true, defaultPath }, result => resolve(chosenPath(result))) } catch (error) { reject(error) }
    })
  }
  return undefined
}

/** The extensions `isMarkdown` accepts, for the dialog's filter. */
const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'rmd', 'qmd']

/** Typora's file dialog, with the arguments its own file picker passes on each platform. */
export function markdownFileChooser(platform: Platform, bridges: { windows?: () => WindowsDialogBridge | undefined; mac?: () => MacDialogBridge | undefined }): FileChooser | undefined {
  if (platform === 'win32' && bridges.windows?.()) {
    return async defaultPath => {
      const result = await bridges.windows!()!.invoke('dialog.showOpenDialog', {
        title: 'Choose a Markdown file for Favorites', defaultPath: defaultPath?.replace(/\//g, '\\'),
        filters: [{ name: 'Markdown', extensions: MARKDOWN_EXTENSIONS }],
        // Choosing a file here is not opening it, so it stays out of the Windows Recent list.
        properties: ['openFile', 'dontAddToRecent'], buttonLabel: 'Choose',
      }) as { filePaths?: unknown } | undefined
      return Array.isArray(result?.filePaths) ? chosenPath(result.filePaths[0]) : undefined
    }
  }
  if (platform === 'darwin' && bridges.mac?.()) {
    return defaultPath => new Promise((resolve, reject) => {
      try { bridges.mac!()!.callHandler('path.selectFolderOrFile', { dir: false, defaultPath, filters: [MARKDOWN_EXTENSIONS] }, result => resolve(chosenPath(result))) } catch (error) { reject(error) }
    })
  }
  return undefined
}
