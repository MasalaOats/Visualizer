# Visualizer · Colour studio

A browser-based paint visualizer for trying shades on a customer's room or house photo. Photo processing stays on the device; no AI or external image service is used.

## Development

```sh
npm ci
npm run dev -- --host 0.0.0.0 --port 5173
```

Open `http://localhost:5173`. Build production assets with `npm run build`; deploy `dist/` using a static web host.

## Editing

1. Upload a JPG, PNG or WEBP (up to 30 MB and 24 megapixels).
2. Create a surface with point tracing, freehand, or similar-color selection. The last chosen drawing tool is remembered.
3. Finish the surface. It is named automatically and selected for painting; tap any color to apply it immediately.
4. Edit traced points by dragging them. Use **Curves** (or Shift-drag) for curved edges and **Remove last point** to correct tracing. Use **Edit surface** to restore or erase pixels in a saved color selection.
5. Hold **Original** to compare, then export PNG or JPG. Use **Pan** or Space-drag to move the photo.

## Wall depth and angled faces

Paint keeps local shadows, ledges and texture from the original photograph at full coverage. In **Colours → Paint & lighting**, **Surface detail** controls the effect (85% by default); set it to **0%** for a flat finish. **Wall brightness** adjusts the selected face from −40% to +40% without changing its shade code. Both controls support undo/redo, local recovery and export. Existing saved surfaces use the new defaults.

For an angled house, trace the front and side as separate surfaces, apply the same shade, and reduce the shaded side’s brightness if needed. Point tracing already supports triangles and perspective outlines. Merging adopts the active surface’s lighting settings; splitting restores the originals.

Use the original photo: details erased by an earlier solid-colour export cannot be recovered. This is non-AI shading from photo pixels, not geometry detection; old stains/patterns can also appear as detail, so lower Surface detail when needed. Preview colours still need checking against a physical shade card.

## Undo / redo configuration

The toolbar and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y share one history for editor actions: points, curves, freehand, mask strokes/traces, tool settings, creating/finishing/cancelling surfaces, paint/coverage, rename/remove/merge/split, zoom/pan, and importing/replacing photos. One drag, brush stroke or slider interaction counts as one action. A new edit after undo discards redo. Navigation, searches, typing into text fields, comparison and downloads do not consume editor history.

**Five undo steps are enabled.** In `src/historyConfig.ts`, change `ENABLE_EXTENDED_UNDO` from `false` to `true` to enable **20 steps**. The extra capacity is implemented and tested. Set it back to `false` for five steps. Reload/rebuild after changing this code switch. It does not implement billing or paid-plan enforcement.

History is per session and resets on reload; it is separate from local project recovery. **Remove last point** is itself an undoable edit. Undoing a finished surface restores its editable draft. Undoing the first photo import returns to a blank workspace and clears that local autosave; Redo restores the photo during the session. Surface checkboxes still support merge/split.

## Local recovery

The current photo and finished surfaces are saved in IndexedDB in this browser, including masks, cutouts and merged surfaces. Reopening on the same origin restores the project. Wait for **Saved on this device** before closing. Unfinished outlines and undo history are not persisted. A save failure is shown with a retry action.

There is one current project per browser/origin. Replacing its photo replaces that project; export any preview you want to keep first. Browser data deletion, private browsing or changing devices/URLs can remove or separate local projects. This is local recovery, not a cloud backup. Use one editor tab per project.

## Checks

```sh
npm run lint
npx tsc -b
npm run build
```

With the development server running, open `http://localhost:5173/tests/editor-regressions.html` for browser-native rendering and serialization checks. These cover curved paint bounds, curve-aware cache keys, mask draft isolation, traced mask additions, persistence of paths/pixels/cutouts/merged originals, 5/20-step history limits, redo branching, history snapshot isolation, opaque shading contrast, flat mode, per-face brightness, and lighting persistence. The test page does not modify the saved project. It is not included in the production build.

For UI smoke testing: upload → trace → undo a point → finish → choose a color → edit/cancel/save a mask → undo/redo → reload → export both formats. Check phone and desktop layouts. `src/editor.ts` contains rendering/geometry; `src/projectStorage.ts` handles local persistence; `src/App.tsx` connects the editor controls.
