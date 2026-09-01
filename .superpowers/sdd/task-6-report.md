# Task 6: i18n 补全 — Report

## Commit

`e717f15` — `feat: add character creation i18n strings`

## Changes

### `src/locales/zh.json`
Added 6 keys to `gui.charCreate`: `selectJob`, `placeholder`, `nameInvalid`, `creating`, `failed`, `failedRetry`.

### `src/locales/en.json`
Added corresponding English translations for the same 6 keys.

### `src/ui/CharSelect.ts`
Replaced 5 hardcoded Chinese strings with `t()` calls:

| Line | Before | After |
|------|--------|-------|
| 200 | `'角色名 (2-12字)'` | `t('gui.charCreate.placeholder')` |
| 327 | `t('gui.charCreate.job')` | `t('gui.charCreate.selectJob')` (bug fix: was showing "选择职业" instead of "请选择职业") |
| 492 | `'名字只能包含中英文和数字，2-12个字符'` | `t('gui.charCreate.nameInvalid')` |
| 504 | `'创建中...'` | `t('gui.charCreate.creating')` |
| 509 | `'创建失败，请重试'` | `t('gui.charCreate.failedRetry')` |

Also added `gui.charCreate.failed` key (used in `handleCreateResult` at line 548) which was previously missing from locale files.

## Verification

`npx tsc --noEmit` — 0 errors.
