import { History } from "../src/history";
import {
  ENABLE_EXTENDED_UNDO,
  STANDARD_UNDO_LIMIT,
  EXTENDED_UNDO_LIMIT,
  UNDO_LIMIT,
} from "../src/historyConfig";
import { copySnapshot, sameSnapshot } from "../src/editorSnapshot";
import type { EditorSnapshot } from "../src/editorSnapshot";
import {
  cloneMask,
  editMaskWithPath,
  makePaintLayer,
  makePath,
  paintKey,
  paintLighting,
  paintMaskBrush,
} from "../src/editor";
import type { Point, Selection } from "../src/editor";
import { restoreSelection, storeSelection } from "../src/projectStorage";

const results: string[] = [];
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  results.push(`PASS: ${message}`);
}

async function run() {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 400;
  canvas.getContext("2d")!.fillRect(0, 0, 400, 400);
  const photo = new Image();
  photo.src = canvas.toDataURL();
  await photo.decode();
  const points: Point[] = [
    { x: 100, y: 100, outHandle: { x: 150, y: 0 } },
    { x: 300, y: 100, inHandle: { x: 250, y: 0 } },
    { x: 300, y: 300 },
    { x: 100, y: 300 },
  ];
  const selection: Selection = {
    id: 1,
    name: "Curved wall",
    shapes: [{ path: makePath(points), points, tool: "polygon" }],
    holes: [],
    color: "rgb(200,100,50)",
    colorName: "Test shade",
    colorCode: "TEST",
    opacity: 0.8,
  };
  const layer = makePaintLayer(photo, selection);
  const paintedAlpha = layer.canvas
    .getContext("2d")!
    .getImageData(200 - layer.left, 60 - layer.top, 1, 1).data[3];
  assert(paintedAlpha > 0, "Paint covers a curve beyond its anchor bounds");

  const straightPoints = points.map((p) => ({ x: p.x, y: p.y }));
  const straight = {
    ...selection,
    shapes: [
      {
        path: makePath(straightPoints),
        points: straightPoints,
        tool: "polygon" as const,
      },
    ],
  };
  assert(
    paintKey(straight) !== paintKey(selection),
    "Curve-only history changes invalidate the paint cache",
  );
  assert(
    paintKey({ ...selection, shapes: [], holes: selection.shapes }) !==
      paintKey(selection),
    "Paint cache distinguishes additions from cutouts",
  );

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = 200;
  maskCanvas.height = 200;
  maskCanvas.getContext("2d")!.fillRect(0, 0, 200, 200);
  const mask = {
    path: new Path2D(),
    points: [],
    tool: "wand" as const,
    maskCanvas,
    left: 100,
    top: 100,
    scale: 1,
    maskId: 7,
  };
  const draft = paintMaskBrush(
    cloneMask(mask),
    { x: 150, y: 150 },
    "erase",
    20,
    400,
    400,
  );
  assert(
    maskCanvas.getContext("2d")!.getImageData(50, 50, 1, 1).data[3] === 255,
    "Refining a cloned mask preserves the saved surface for cancel/undo",
  );
  assert(
    draft.maskCanvas.getContext("2d")!.getImageData(50, 50, 1, 1).data[3] === 0,
    "Erase brush updates the editable draft",
  );
  const added = editMaskWithPath(
    mask,
    makePath(points),
    points,
    "add",
    400,
    400,
  )!;
  assert(
    added.maskCanvas
      .getContext("2d")!
      .getImageData(200 - added.left, 60 - added.top, 1, 1).data[3] > 0,
    "Traced mask additions retain their curved edges",
  );

  const maskSelection = {
    ...selection,
    id: 2,
    shapes: [draft],
    holes: straight.shapes,
  };
  const merged = {
    ...selection,
    shapes: [...selection.shapes, draft],
    holes: straight.shapes,
    mergedFrom: [selection, maskSelection],
  };
  const restored = restoreSelection(structuredClone(storeSelection(merged)));
  assert(
    restored.name === merged.name &&
      restored.opacity === 0.8 &&
      restored.colorCode === "TEST",
    "Persistence preserves surface names, colors and coverage",
  );
  assert(
    canvas.getContext("2d")!.isPointInPath(restored.shapes[0].path, 200, 60),
    "Persistence reconstructs curved paths",
  );
  const restoredMask = restored.shapes[1];
  assert(
    "maskCanvas" in restoredMask &&
      restoredMask.maskCanvas.getContext("2d")!.getImageData(50, 50, 1, 1)
        .data[3] === 0,
    "Persistence restores edited mask pixels",
  );
  assert(
    restored.holes.length === 1 &&
      restored.mergedFrom?.length === 2 &&
      restored.mergedFrom[1].holes.length === 1,
    "Persistence retains cutouts and originals needed to split merged surfaces",
  );

  // One selection crosses a bright front face and a shaded side face.
  const walls = document.createElement("canvas");
  walls.width = 320;
  walls.height = 160;
  const wallContext = walls.getContext("2d")!;
  wallContext.fillStyle = "rgb(200,200,200)";
  wallContext.fillRect(0, 0, 160, 160);
  wallContext.fillStyle = "rgb(80,80,80)";
  wallContext.fillRect(160, 0, 160, 160);
  wallContext.fillStyle = "rgb(180,180,180)";
  wallContext.fillRect(40, 0, 10, 160);
  wallContext.fillStyle = "rgb(35,35,35)";
  wallContext.fillRect(156, 0, 4, 160);
  const wallPhoto = new Image();
  wallPhoto.src = walls.toDataURL();
  await wallPhoto.decode();
  const wallPoints = [
    { x: 0, y: 0 },
    { x: 320, y: 0 },
    { x: 320, y: 160 },
    { x: 0, y: 160 },
  ];
  const wallSelection: Selection = {
    ...selection,
    opacity: 1,
    color: "rgb(180,120,60)",
    shapes: [
      { points: wallPoints, path: makePath(wallPoints), tool: "polygon" },
    ],
  };
  const sample = (s: Selection, x: number) => {
    const result = makePaintLayer(wallPhoto, s);
    return result.canvas
      .getContext("2d")!
      .getImageData(x - result.left, 80 - result.top, 1, 1).data;
  };
  const front = sample(wallSelection, 80),
    side = sample(wallSelection, 240);
  assert(
    front[0] - side[0] > 60 && front[3] === 255 && side[3] === 255,
    "Opaque paint retains a visible difference between lit and shaded wall faces",
  );
  assert(
    sample(wallSelection, 158)[0] < side[0] &&
      sample(wallSelection, 45)[0] < front[0],
    "Corner shadows and subtle texture survive repainting",
  );
  const flat = { ...wallSelection, lighting: 0 };
  assert(
    sample(flat, 80).join() === "180,120,60,255" &&
      sample(flat, 240).join() === "180,120,60,255",
    "Zero detail produces exact flat paint regardless of source shadows",
  );
  assert(
    sample({ ...flat, brightness: -25 }, 80)[0] === 135 &&
      sample({ ...flat, brightness: 20 }, 80)[0] === 216,
    "Manual face brightness adjusts flat paint independently of coverage",
  );
  for (const color of ["rgb(250,250,245)", "rgb(20,25,30)"]) {
    assert(
      sample({ ...wallSelection, color }, 80)[0] >
        sample({ ...wallSelection, color }, 240)[0],
      `Light and dark paint retain wall depth: ${color}`,
    );
  }
  const darkPoints = [
    { x: 180, y: 0 },
    { x: 320, y: 0 },
    { x: 320, y: 160 },
    { x: 180, y: 160 },
  ];
  const darkWall = {
    ...wallSelection,
    shapes: [
      {
        points: darkPoints,
        path: makePath(darkPoints),
        tool: "polygon" as const,
      },
    ],
  };
  assert(
    sample(darkWall, 240).join() === "180,120,60,255",
    "A uniformly dark old finish does not force the new shade to stay dark",
  );
  const cutoutPoints = [
    { x: 0, y: 0 },
    { x: 180, y: 0 },
    { x: 180, y: 160 },
    { x: 0, y: 160 },
  ];
  const cutoutWall = {
    ...wallSelection,
    holes: [
      {
        points: cutoutPoints,
        path: makePath(cutoutPoints),
        tool: "polygon" as const,
      },
    ],
  };
  assert(
    sample(cutoutWall, 240).join() === sample(darkWall, 240).join() &&
      sample(cutoutWall, 80)[3] === 0,
    "Excluded pixels stay transparent and do not bias surface lighting",
  );
  wallContext.fillStyle = "rgb(255,0,0)";
  wallContext.fillRect(0, 0, 320, 160);
  wallPhoto.src = walls.toDataURL();
  await wallPhoto.decode();
  const blue = sample({ ...wallSelection, color: "rgb(0,100,200)" }, 80);
  assert(
    blue[0] === 0 && blue[1] === 100 && blue[2] === 200 && blue[3] === 255,
    "Source paint hue does not bleed into the opaque replacement colour",
  );
  const litSettings = { ...selection, lighting: 0.4, brightness: -22 };
  const savedLighting = restoreSelection(
    structuredClone(
      storeSelection({ ...litSettings, mergedFrom: [litSettings] }),
    ),
  );
  assert(
    savedLighting.lighting === 0.4 &&
      savedLighting.brightness === -22 &&
      savedLighting.mergedFrom?.[0].brightness === -22,
    "Recovery and merged originals preserve surface lighting settings",
  );
  assert(
    paintLighting(selection).lighting === 0.85 &&
      paintLighting(selection).brightness === 0,
    "Existing saved surfaces receive natural lighting defaults",
  );
  assert(
    paintKey(selection) !== paintKey({ ...selection, lighting: 0 }) &&
      paintKey(selection) !== paintKey({ ...selection, brightness: -20 }),
    "Lighting and brightness changes invalidate cached paint",
  );

  for (const limit of [STANDARD_UNDO_LIMIT, EXTENDED_UNDO_LIMIT]) {
    const history = new History<number>(limit);
    let current = 0;
    for (let i = 1; i <= limit + 3; i++) {
      history.record(current, i, "Edit");
      current = i;
    }
    assert(
      history.past.length === limit,
      `${limit}-step history drops older entries`,
    );
    for (let i = 0; i < limit; i++) current = history.undo(current)!;
    assert(
      current === 3 && history.undo(current) === undefined,
      `${limit}-step undo stops exactly at its limit`,
    );
    for (let i = 0; i < limit; i++) current = history.redo(current)!;
    assert(
      current === limit + 3 && history.redo(current) === undefined,
      `${limit}-step redo restores every retained action`,
    );
    current = history.undo(current)!;
    history.record(current, current, "No change");
    assert(history.future.length === 1, `${limit}-step no-op preserves redo`);
    history.record(current, 999, "New branch");
    assert(
      history.future.length === 0 && history.redo(999) === undefined,
      `${limit}-step new edit discards redo branch`,
    );
  }
  assert(
    UNDO_LIMIT ===
      (ENABLE_EXTENDED_UNDO ? EXTENDED_UNDO_LIMIT : STANDARD_UNDO_LIMIT),
    "History configuration selects the declared limit",
  );
  const state: EditorSnapshot = {
    photo: null,
    image: photo,
    edgeMap: null,
    colorMap: null,
    photoName: "fixture",
    selections: [selection],
    points,
    maskShape: mask,
    drawing: true,
    tool: "wand",
    lastTool: "wand",
    edgeSnap: false,
    colorTolerance: 34,
    colorScope: "connected",
    colorSeed: null,
    maskEditMode: "erase",
    brushSize: 24,
    areaMode: "new",
    zoom: 1,
    pan: { x: 0, y: 0 },
    panMode: false,
    curveMode: false,
    color: {
      colorName: "Test",
      colorCode: "T",
      colorTone: "Light",
      colorValue: "rgb(200,100,50)",
    },
    selectedId: 1,
    multiSelectedIds: [],
    panel: "surfaces",
  };
  const snapshot = copySnapshot(state);
  paintMaskBrush(mask, { x: 150, y: 150 }, "erase", 20, 400, 400);
  assert(
    snapshot.maskShape!.maskCanvas.getContext("2d")!.getImageData(50, 50, 1, 1)
      .data[3] === 255,
    "History snapshot isolates a mutable brush draft",
  );
  assert(
    sameSnapshot(snapshot, { ...snapshot, selectedId: 2, panel: "colors" }),
    "Browsing panels and selecting surfaces does not consume undo",
  );
  assert(
    !sameSnapshot(snapshot, { ...snapshot, zoom: 2 }) &&
      !sameSnapshot(snapshot, { ...snapshot, colorTolerance: 50 }),
    "View and selection settings count as editable history",
  );
  document.title = `${results.length} checks passed`;
}
run()
  .catch((error) => {
    results.push(`FAIL: ${error.message}`);
    document.title = "Regression check failed";
  })
  .finally(() => {
    document.querySelector("#results")!.textContent = results.join("\n");
  });
