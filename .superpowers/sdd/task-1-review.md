# Task 1 Review: Scene Loader

## Spec Compliance

**Function signature:** ✅ `loadScene(scenePath: string, _resPrefix: string): Promise<THREE.Group>` matches spec.

**Dependencies:** ✅ Uses `parseSMD` from smd-parser and `loadGameTexture` from texture-loader as specified.

**Return type:** ✅ Returns `Promise<THREE.Group>` containing meshes with geometry and materials.

## Code Quality

**Approved.** Implementation is solid and follows existing codebase conventions.

## Findings

**Minor — `_resPrefix` unused (line 17):** The `resPrefix` parameter is kept for interface compatibility with CharSelect but texture paths are derived from SMD material data via `assetUrl(mat.tex[0])`, which is more accurate than the spec's `${resPrefix}/${matName}.bmp` approach. The spec's texture path construction was an approximation; using the actual SMD data is correct. Acceptable per ponytail comment.

**Minor — Deviates from spec stub in two ways (both improvements):**
1. Spec creates one BufferGeometry for all vertices; implementation correctly creates per-material meshes with separate geometries and textures. This is necessary for multi-material scenes.
2. Spec uses `computeVertexNormals()`; implementation computes flat face normals inline. Both produce correct results for this use case; the inline approach is equivalent.

**Minor — `frustumCulled = false` (line 111):** Deliberate choice for scene geometry to prevent culling artifacts. Good.

**Positive — Coordinate conversion (lines 60-62):** Z-up → Y-up via `(-z, y, -x)` with `/256` fixed-point scaling matches map-renderer conventions exactly.

## Verdict

**APPROVED**

No issues blocking Task 3 integration. The interface matches what CharSelect needs.
