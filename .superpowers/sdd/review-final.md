# Review package: c93891b..HEAD (full branch)

## Commits (6 total)
e717f15 feat: add character creation i18n strings
7f2fc45 feat: integrate CharSelect creation flow into main app
74b90b9 feat: add CHAR_CREATE screen to app state machine
77a47bc feat: rewrite CharSelect as single-page with 3D preview
ad051dc feat: add custom camera controls for character preview
3603e65 feat: add scene loader for chrselect SMD

## Files changed (7 files, +668 -211)
 src/app/State.ts           |   6 +-
 src/locales/en.json        |   2 +-
 src/locales/zh.json        |   2 +-
 src/main.ts                |  21 +-
 src/render/scene-loader.ts | 116 ++++++++
 src/ui/CharSelect.ts       | 661 +++++++++++++++++++++++++++++++--------------
 src/ui/camera-controls.ts  |  71 +++++

## Summary
Complete character creation UI rewrite: single-page three-column layout with 3D scene preview, job/face selection, BGM, and server integration.
