import { ARCHITECTURE_LAYER_ORDER } from '../constants'
import type { ArchitectureConfig, ArchitectureLayerId } from '../types'

export function detectArchitectureLayer(filePath: string, config: ArchitectureConfig): ArchitectureLayerId {
  const path = filePath.toLowerCase()
  for (const layer of ARCHITECTURE_LAYER_ORDER) {
    const patterns = config.layerMatchers[layer]
    for (const pattern of patterns) {
      if (path.includes(pattern)) {
        return layer
      }
    }
  }
  return 'unknown'
}
