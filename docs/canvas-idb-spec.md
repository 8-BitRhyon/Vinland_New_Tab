# Spec: Canvas data offloaded to IndexedDB

Status: proposed
Source limitation: `docs/design.md` §11 - `CanvasManager` stores everything in
`note.canvasData` (localStorage); large canvas data may hit quota and is lost.

## Goal
Keep large canvas payloads out of the 5 MB `localStorage` budget by persisting
`note.canvasData` in IndexedDB (`OPERATOR_VAULT` / `media_assets`, key
`vinland_canvas_<noteId>`), reusing the existing `DB` module. No new dependency.

## Behavior (acceptance criteria)

1. **Offload on write** - `saveData()` / `saveAllNotes()` never serialize the
   canvas payload into the per-note `localStorage` shard. The shard stores a
   lightweight marker (`canvasData: { _external: true }`) so it stays small.
   The real `canvasData` is mirrored to IndexedDB (fire-and-forget,
   de-duplicated by serialized form).

2. **Hydrate on read** - on `loadData()`, canvas notes have their `canvasData`
   restored from IndexedDB into the in-memory note.

3. **Backward compatible** - notes that still carry real `canvasData` in their
   `localStorage` shard (pre-upgrade) continue to work; on next save they are
   migrated to the IndexedDB + marker form automatically.

4. **Round-trips** - create a canvas, add many nodes/edges, reload the page;
   the canvas reopens with the same nodes/edges (data survived in IndexedDB,
   not in `localStorage`).

5. **No regression** - existing note/task/board persistence unchanged; the
   unit + e2e suites still pass.

## Non-goals (ponytail)
- No new storage library, no schema versioning, no migration CLI.
- No change to the in-memory `note.canvasData` shape (CanvasManager keeps using
  it directly); only the *durability layer* moves.
- `clearAllNotes()` / orphan IDB entries: left as-is (harmless, YAGNI).

## Verification
One e2e check (`tests/canvas-idb.playwright.spec.mjs`):
- Create a canvas, add N nodes via the `+ NODE` button.
- Assert the `localStorage` shard for that note does NOT contain the node
  payload (offload worked).
- Reload; assert the in-memory `canvasData.nodes.length === N` (round-trip via
  IndexedDB).
