import { makePath } from "./editor";
import type { Point, Selection, SurfacePart, Tool } from "./editor";

type StoredPart = {
  points: Point[];
  tool: Tool;
  mask?: {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    left: number;
    top: number;
    scale: number;
  };
};
type StoredSelection = Omit<Selection, "shapes" | "holes" | "mergedFrom"> & {
  shapes: StoredPart[];
  holes: StoredPart[];
  mergedFrom?: StoredSelection[];
};
type StoredProject = {
  version: 1;
  photo: Blob;
  name: string;
  selections: StoredSelection[];
  tool: Tool;
};

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      // Keep the existing database name so the Visualizer rename preserves saved projects.
      const request = indexedDB.open("huehouse-workspace", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("projects");
      request.onerror = () => {
        database = undefined;
        reject(request.error);
      };
      request.onblocked = () => {
        database = undefined;
        reject(new Error("Close other Visualizer tabs to enable saving."));
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
    });
  }
  return database;
}

function storePart(shape: SurfacePart): StoredPart {
  const stored: StoredPart = { points: shape.points, tool: shape.tool };
  if ("maskCanvas" in shape) {
    const { width, height } = shape.maskCanvas;
    const ctx = shape.maskCanvas.getContext("2d");
    if (!ctx) throw new Error("Could not save the surface mask.");
    stored.mask = {
      pixels: ctx.getImageData(0, 0, width, height).data,
      width,
      height,
      left: shape.left,
      top: shape.top,
      scale: shape.scale,
    };
  }
  return stored;
}

export function storeSelection(selection: Selection): StoredSelection {
  return {
    ...selection,
    shapes: selection.shapes.map(storePart),
    holes: selection.holes.map(storePart),
    mergedFrom: selection.mergedFrom?.map(storeSelection),
  };
}

function restorePart(shape: StoredPart): SurfacePart {
  const base = {
    points: shape.points,
    path: makePath(shape.points),
    tool: shape.tool,
  };
  if (!shape.mask) return base;
  const { width, height, pixels, left, top, scale } = shape.mask;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not restore the surface mask.");
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), width, height),
    0,
    0,
  );
  return {
    ...base,
    maskCanvas: canvas,
    left,
    top,
    scale,
    maskId: Date.now() + Math.random(),
  };
}

export function restoreSelection(selection: StoredSelection): Selection {
  return {
    ...selection,
    shapes: selection.shapes.map(restorePart),
    holes: selection.holes.map(restorePart),
    mergedFrom: selection.mergedFrom?.map(restoreSelection),
  };
}

export async function loadProject() {
  const db = await openDatabase();
  const project = await new Promise<StoredProject | undefined>(
    (resolve, reject) => {
      const request = db
        .transaction("projects", "readonly")
        .objectStore("projects")
        .get("current");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    },
  );
  if (!project) return null;
  if (
    project.version !== 1 ||
    !(project.photo instanceof Blob) ||
    !Array.isArray(project.selections)
  )
    throw new Error("Unsupported saved project.");
  return {
    photo: project.photo,
    name: project.name,
    selections: project.selections.map(restoreSelection),
    tool: project.tool,
  };
}

export async function saveProject(
  photo: Blob,
  name: string,
  selections: Selection[],
  tool: Tool,
) {
  // Snapshot masks before awaiting: active brush canvases can change during a later gesture.
  const project: StoredProject = {
    version: 1,
    photo,
    name,
    selections: selections.map(storeSelection),
    tool,
  };
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("projects", "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Saving was interrupted."));
    transaction.objectStore("projects").put(project, "current");
  });
}
