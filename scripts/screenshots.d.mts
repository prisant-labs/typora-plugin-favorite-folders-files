export interface Screenshot { name: string; setup: string; clip: string }
export const screenshots: Screenshot[]
export function findBrowser(options: { env: Record<string, string | undefined>; platform: string; exists: (path: string) => boolean }): string | undefined
