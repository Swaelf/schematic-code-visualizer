import type { TsConfigAliasConfig } from './models'

type TsConfigRoot = {
  compilerOptions?: {
    baseUrl?: string
    paths?: Record<string, string[]>
  }
}

export async function readTsConfigAliasConfig(
  directoryHandle: FileSystemDirectoryHandle,
): Promise<TsConfigAliasConfig | null> {
  try {
    const tsconfigHandle = await directoryHandle.getFileHandle('tsconfig.json')
    const file = await tsconfigHandle.getFile()
    const text = await file.text()
    const config = JSON.parse(text) as TsConfigRoot
    const compilerOptions = config.compilerOptions ?? {}
    const hasBaseUrl = typeof compilerOptions.baseUrl === 'string' && compilerOptions.baseUrl.length > 0
    const hasPaths = !!compilerOptions.paths && Object.keys(compilerOptions.paths).length > 0

    if (!hasBaseUrl && !hasPaths) {
      return null
    }

    return {
      baseUrl: hasBaseUrl ? compilerOptions.baseUrl : undefined,
      paths: hasPaths ? compilerOptions.paths : undefined,
    }
  } catch {
    return null
  }
}
