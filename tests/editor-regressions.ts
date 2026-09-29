import {
  cloneMask,
  editMaskWithPath,
  makePaintLayer,
  makePath,
  paintKey,
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
