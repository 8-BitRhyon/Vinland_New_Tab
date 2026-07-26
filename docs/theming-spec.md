# Spec: Full-Surface Theming (P2)

Status: shipped (V19.38, 2026-07-17)
Source: UI/UX audit + user request for "more elaborate theming feature."

## Goal
Extend the existing `THEME_PRESETS` from a 2-color accent swap to a full-surface
token system so that selecting a preset changes the entire look (background,
surface, text tiers, accents, graph colors, overlays). This makes Vinland feel
like a different "terminal OS" per preset.

## What already exists
- `config.js:THEME_PRESETS` - 13 presets (matrix, cyberpunk, ocean, sunset,
  minimal, blood, gold, forest, amber, ice, lavender, retrogreen, retroma).
  Each has `theme_color`, `secondary_color`, `clock_font`, `secondary_font`,
  and video `filter_*` params.
- `Config.applyTheme()` applies those to `--main-color`, `--secondary-color`,
  `--font-main`, `--font-secondary`, clock size, video filters.
- Individual color pickers in Settings for accent/secondary/fonts.
- `theme-retroma` body class (CSS-class override, outside the preset system).
- CRT/vignette/noise toggles (not per-preset, except retrogreen hardcodes
  `crt_effect`).
- Custom-theme import/export via JSON modal.

## What's missing (the "elaboration")

1. **Background color** - body/panel bg is hardcoded `#000`/`rgba(0,0,0,0.95)`.
   No `--bg-color` var, so presets can't change it. This is the single
   highest-leverage token for making a theme feel like a full skin.

2. **Full token coverage** - presets don't set `--danger-color`,
   `--warning-color`, `--board-color`, `--dim-color`, `--graph-col-*`,
   `--bg-overlay`, overlay toggles.

3. **`theme-retroma` isolation** - retroma uses a body CSS class that sets
   variables in `design-tokens.css`. It works but is separate from the preset
   system. A `retroma` preset should set it automatically.

## Acceptance criteria

1. `--bg-color` CSS variable exists (default `#000`) and is used by body bg,
   modal bg, `.note-card`, `.config-modal`, `.dock` - the main surface areas.

2. Every preset in `THEME_PRESETS` has `bg_color` + `danger_color` +
   `warning_color` + `board_color` + `dim_color`. Existing presets get
   auto-derived defaults from their accent; new presets (and custom themes)
   can set them explicitly.

3. `Config.applyTheme()` writes all surface tokens (`--bg-color`, `--danger-color`,
   `--warning-color`, `--board-color`, `--dim-color`, `--graph-col-*`) from the
   active preset's values (falling back to current defaults when absent).

4. Selecting a preset from the dropdown changes the full look - bg, all
   accent colors, fonts, video filters, overlay toggles - in one shot.

5. The `retroma` preset sets `body.theme-retroma` class so its CSS-class
   overrides take effect; other presets remove it.

6. Backward compatible: existing configs with only `theme_color`/`secondary_color`
   continue to work (new tokens get defaults). The `theme-retroma` CSS class
   still works as a fallback.

## Non-goals (ponytail)
- No new Settings UI panel (preset dropdown + color pickers already exist).
- No theme gallery or marketplace.
- No migration - existing configs keep working via defaults.

## Verification
One e2e check (`tests/theming-surface.playwright.spec.mjs`):
- Select the "ocean" preset via `window.SettingsUI.loadThemePreset('ocean')`.
- Assert `getComputedStyle(document.body).backgroundColor` is the ocean
  preset's `bg_color` (not `#000`).
- Assert `getComputedStyle(document.documentElement).getPropertyValue('--danger-color')`
  matches the ocean preset's `danger_color`.
- Assert `document.body.classList.contains('theme-retroma')` is false.
- Select the "retroma" preset; assert `document.body.classList.contains('theme-retroma')`
  is true.
- Assert `--danger-color` has changed accordingly.
