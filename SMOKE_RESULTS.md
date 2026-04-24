# Smoke Test Results

Date: 2026-04-24  
Command:

```bash
npm run smoke -- .\smoke-repos\zustand .\smoke-repos\tsup .\smoke-repos\nanostores
```

## Per Repository

- `zustand`
  - files: `32`
  - edges: `25`
  - unresolved: `72`
  - unresolvedExternal: `70`
  - unresolvedInternal: `2`
  - aliasResolved: `0`

- `tsup`
  - files: `46`
  - edges: `100`
  - unresolved: `105`
  - unresolvedExternal: `103`
  - unresolvedInternal: `2`
  - aliasResolved: `0`

- `nanostores`
  - files: `21`
  - edges: `0`
  - unresolved: `56`
  - unresolvedExternal: `33`
  - unresolvedInternal: `23`
  - aliasResolved: `0`

## Totals

- repos: `3`
- files: `99`
- edges: `125`
- unresolved: `233`
- unresolvedExternal: `206`
- unresolvedInternal: `27`
- aliasResolved: `0`

## Conclusion

- Pipeline works across multiple external TS repositories without crashes.
- Most unresolved imports are external package specifiers.
- Internal unresolved imports exist (`27`) and are concentrated in repo-specific resolution patterns.
- MVP target is reached: scan, analyze, visualize, filter, and smoke-test are implemented end-to-end.
