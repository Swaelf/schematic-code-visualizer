import { ARCHITECTURE_RULE_LAYERS } from '../constants'
import type { ArchitectureConfig } from '../types'

export function architectureConfigDescription(config: ArchitectureConfig) {
  return ARCHITECTURE_RULE_LAYERS.map((layer) => `${layer} -> ${config.allowedTargets[layer].join('/')}`).join('; ')
}
