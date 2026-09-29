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
4. Edit traced points by dragging them. Use **Curves** (or Shift-drag) for curved edges and **Undo last point** to correct tracing. Use **Edit surface** to restore or erase pixels in a saved color selection.
5. Hold **Original** to compare, then export PNG or JPG. Use **Pan** or Space-drag to move the photo.

Completed surface changes support undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y). While drawing, Ctrl/Cmd+Z removes the last tracing point. Select multiple surfaces with the checkboxes to merge; merged surfaces can be split again.

## Local recovery

The current photo and finished surfaces are saved in IndexedDB in this browser, including masks, cutouts and merged surfaces. Reopening on the same origin restores the project. Wait for **Saved on this device** before closing. Unfinished outlines and undo history are not persisted. A save failure is shown with a retry action.

There is one current project per browser/origin. Replacing its photo replaces that project; export any preview you want to keep first. Browser data deletion, private browsing or changing devices/URLs can remove or separate local projects. This is local recovery, not a cloud backup. Use one editor tab per project.

## Checks

```sh
npm run lint
npx tsc -b
npm run build
```

With the development server running, open `http://localhost:5173/tests/editor-regressions.html` for browser-native rendering and serialization checks. These cover curved paint bounds, curve-aware cache keys, mask draft isolation, traced mask additions, and persistence of paths, pixels, cutouts and merged originals. The test page does not modify the saved project. It is not included in the production build.

For UI smoke testing: upload → trace → undo a point → finish → choose a color → edit/cancel/save a mask → undo/redo → reload → export both formats. Check phone and desktop layouts. `src/editor.ts` contains rendering/geometry; `src/projectStorage.ts` handles local persistence; `src/App.tsx` connects the editor controls.
