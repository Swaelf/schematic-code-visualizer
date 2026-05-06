import type { ArchitectureConfig, ArchitectureLayerId } from './types'

export const ARCHITECTURE_LAYER_ORDER: ArchitectureLayerId[] = ['tests', 'ui', 'domain', 'infra', 'shared']
export const ARCHITECTURE_RULE_LAYERS: ArchitectureLayerId[] = ['ui', 'domain', 'infra', 'shared', 'tests', 'unknown']
export const ARCHITECTURE_MATCHER_LAYERS: ArchitectureLayerId[] = ['tests', 'ui', 'domain', 'infra', 'shared']
export const ARCHITECTURE_STORAGE_KEY = 'schematic-code-visualizer.architecture-config.v1'

export const DEFAULT_ARCHITECTURE_CONFIG: ArchitectureConfig = {
  layerMatchers: {
    tests: ['/__tests__/', '.test.', '.spec.'],
    ui: ['/components/', '/screens/', '/pages/', '/ui/'],
    domain: ['/domain/', '/entities/', '/models/', '/features/', '/core/', '/services/'],
    infra: [
      '/infra/',
      '/infrastructure/',
      '/api/',
      '/gateway/',
      '/gateways/',
      '/repository/',
      '/repositories/',
      '/store/',
      '/data/',
      '/persistence/',
      '/db/',
    ],
    shared: ['/shared/', '/common/', '/utils/', '/helpers/', '/lib/', '/hooks/', '/types/'],
    unknown: [],
  },
  allowedTargets: {
    ui: ['ui', 'domain', 'shared', 'unknown'],
    domain: ['domain', 'shared', 'unknown'],
    infra: ['infra', 'domain', 'shared', 'unknown'],
    shared: ['shared', 'unknown'],
    tests: ['ui', 'domain', 'infra', 'shared', 'tests', 'unknown'],
    unknown: ['ui', 'domain', 'infra', 'shared', 'tests', 'unknown'],
  },
}
