# Spec: P0 Accessibility Baseline

Status: proposed
Source: UI/UX audit (Web Interface Guidelines) - Vinland New Tab.

## Goal
Establish the minimum accessibility baseline the app currently lacks, so the
keyboard/screen-reader experience is usable and so a future "elaborate theming"
feature (P2) has an accessible preset to build on. No visual redesign.

## Behavior (acceptance criteria)

1. **Visible keyboard focus** - a global `:focus-visible` rule gives every
   interactive control (buttons, links, inputs, `[role=button]`, dock items,
   slash items, sidebar items, canvas delete, modal close) a visible outline.
   Replaces the ~25 `outline: none` that currently hide focus.

2. **Reduced motion** - a `prefers-reduced-motion: reduce` media query disables
   animations/transitions (CRT/scanline/glow etc. stop moving) for users who
   request it.

3. **Labeled icon buttons** - icon-only buttons carry `aria-label`
   (`add-dock-btn`, `add-cmd-btn`, `kanban-modal-close`, `pomo-dismiss-btn`,
   canvas delete ×, etc.).

4. **Dialog semantics + focus** - on open, every modal gets `role="dialog"` and
   `aria-modal="true"`, focus moves into the dialog, and on close focus returns
   to the element that opened it. A Tab focus-trap keeps keyboard users inside
   (the note editor is exempt - it uses Tab for block indent).

5. **Live toasts** - `showNotification` toasts get `aria-live="polite"`
   (+ `role="status"`) so AT announces them.

6. **No regression** - existing unit + e2e suites still pass.

## Non-goals (ponytail)
- No visual/skin change; the existing CRT terminal aesthetic is preserved.
- No skip-link / `<main>` landmark / heading-hierarchy pass (tracked as P1).
- No full Tab focus-trap inside `note-editor-modal` (its BlockEditor owns Tab
  for indentation); it still gets `role`/`aria-modal` + focus move/restore.
- No new dependency.

## Verification
One e2e check (`tests/a11y-baseline.playwright.spec.mjs`):
- The `:focus-visible` rule and the `prefers-reduced-motion` media query exist
  in the loaded stylesheets.
- With reduced motion emulated, an animated element's computed `animationDuration`
  collapses to `0.001ms`/`none`.
- `#add-dock-btn` / `#add-cmd-btn` have truthy `aria-label`.
- Opening `config-modal` yields a `[role="dialog"][aria-modal="true"]` and moves
  `document.activeElement` inside it; after Escape, focus is no longer inside it.
- Triggering `showNotification('x')` produces `#notif-toast` with
  `aria-live="polite"`.
