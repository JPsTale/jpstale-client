# Task 1: Scene Loader — Report

## What I Implemented

Created `src/render/scene-loader.ts` — a function `loadScene(scenePath, resPrefix)` that:
- Fetches an SMD file and parses it via `parseSMD()`
- Collects texture URLs from SMD material data, loads them via `loadGameTexture()`
- Groups faces by material, builds per-material `BufferGeometry` with position, normal, and UV attributes
- Applies Z-up → Y-up coordinate transform (`wx = -z*S, wy = y*S, wz = -x*S`)
- Returns a `THREE.Group` containing one `Mesh` per material with `MeshLambertMaterial`

## Plan vs. Actual APIs

The plan's code referenced non-existent properties. Adapted to real APIs:
- `parseSMD(path)` → `parseSMD(buffer)` — parser takes ArrayBuffer, not path
- `loadTexture(path)` → `loadGameTexture(url)` — different function name
- `smd.vertices` → `smd.verts`, `smd.faceIndices` → `smd.triIdx`, `smd.uvs` → `smd.texUVs`
- `materials[0]?.name` → `materials[].tex[0]` — texture names, not material names
- Added UV unwrapping logic matching `map-renderer.ts` (swizzle u0/v0/u1/v1/v2/u2)
- Added per-material face grouping and geometry building (matching map-renderer pattern)

## Test Results

- `npx tsc --noEmit`: scene-loader.ts compiles clean (0 errors)
- Pre-existing error in `src/main.ts` (`getToken` unused) — unrelated

## Files Changed

- `src/render/scene-loader.ts` (created, 116 lines)

## Self-Review

- Follows map-renderer patterns for geometry construction (face grouping, UV swizzle, coordinate transform)
- `_resPrefix` param kept for interface compat with CharSelect (unused — texture paths come from SMD data)
- Skipped: lightmap/second-texture support, wind/water animations, fog — not needed for chrselect scene preview
- Single `MeshLambertMaterial` per material group — simpler than map-renderer's custom shader, appropriate for preview scene
