import type { ArchitectureConfig, ArchitectureLayerId } from '../types'

export function isArchitectureEdgeAllowed(
  fromLayer: ArchitectureLayerId,
  toLayer: ArchitectureLayerId,
  config: ArchitectureConfig,
) {
  return new Set(config.allowedTargets[fromLayer]).has(toLayer)
}
