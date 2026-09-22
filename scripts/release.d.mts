export const releaseFiles: string[]

export function validateMetadata(
  source: Record<string, unknown>,
  pkg: Record<string, unknown>,
  built: Record<string, unknown>,
  tag?: string,
): void

export function validatePayload(
  actual: Record<string, Uint8Array>,
  expected: Record<string, Uint8Array>,
): void

export function validateRelease(
  root?: string,
  tag?: string,
): Promise<{
  version: string
  files: string[]
  sha256: string
}>
