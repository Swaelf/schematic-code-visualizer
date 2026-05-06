import { DEFAULT_ARCHITECTURE_CONFIG } from '../constants'
import type { ArchitectureConfig, ArchitectureLayerId } from '../types'

export function normalizeArchitectureConfig(input: unknown): ArchitectureConfig | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const candidate = input as Partial<ArchitectureConfig>
  const validLayers: ArchitectureLayerId[] = ['ui', 'domain', 'infra', 'shared', 'tests', 'unknown']

  const layerMatchers = {} as Record<ArchitectureLayerId, string[]>
  const allowedTargets = {} as Record<ArchitectureLayerId, ArchitectureLayerId[]>

  for (const layer of validLayers) {
    const rawMatchers = candidate.layerMatchers?.[layer]
    const nextMatchers = Array.isArray(rawMatchers)
      ? rawMatchers.filter((item): item is string => typeof item === 'string').map((item) => item.toLowerCase().trim()).filter(Boolean)
      : DEFAULT_ARCHITECTURE_CONFIG.layerMatchers[layer]
    layerMatchers[layer] = [...new Set(nextMatchers)]

    const rawAllowed = candidate.allowedTargets?.[layer]
    const nextAllowed = Array.isArray(rawAllowed)
      ? rawAllowed
          .filter((item): item is ArchitectureLayerId => typeof item === 'string' && validLayers.includes(item as ArchitectureLayerId))
      : DEFAULT_ARCHITECTURE_CONFIG.allowedTargets[layer]
    if (nextAllowed.length === 0) {
      return null
    }
    allowedTargets[layer] = [...new Set(nextAllowed)]
  }

  return {
    layerMatchers,
    allowedTargets,
  }
}
