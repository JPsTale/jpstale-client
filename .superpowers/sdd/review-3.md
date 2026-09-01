# Review package: ad051dc..HEAD

## Commits
77a47bc feat: rewrite CharSelect as single-page with 3D preview

## Files changed
 src/ui/CharSelect.ts | 643 ++++++++++++++++++++++++++------------------------
 1 file changed, 438 insertions(+), 205 deletions(-)

## Summary
Complete rewrite of CharSelect.ts from 4-step wizard to single-page three-column layout:
- Left: job info display
- Center: 3D preview with scene + character model + idle animation
- Right: job selection (hover/selected states), face selection, name input, create/cancel buttons
- BGM playback on show/hide
- Camera controls integration
- Create character flow (handleCreateResult placeholder for main.ts integration)
