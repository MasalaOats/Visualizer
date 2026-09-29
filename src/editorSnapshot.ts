import { cloneMask } from "./editor";
import type {
  Color,
  ColorMap,
  EdgeMap,
  MaskEditMode,
  MaskShape,
  Point,
  Selection,
  Tool,
} from "./editor";

export type EditorSnapshot = {
  photo: Blob | null;
  image: HTMLImageElement | null;
  edgeMap: EdgeMap | null;
  colorMap: ColorMap | null;
  photoName: string;
  selections: Selection[];
  points: Point[];
  maskShape: MaskShape | null;
  drawing: boolean;
  tool: Tool;
  lastTool: Tool;
  edgeSnap: boolean;
  colorTolerance: number;
  colorScope: "connected" | "image";
  colorSeed: Point | null;
  maskEditMode: MaskEditMode;
  brushSize: number;
  areaMode: "new" | "add" | "subtract" | "edit";
  zoom: number;
  pan: { x: number; y: number };
  panMode: boolean;
  curveMode: boolean;
  color: Color;
  selectedId: number | null;
  multiSelectedIds: number[];
  panel: "surfaces" | "colors";
};

export function copySnapshot(state: EditorSnapshot): EditorSnapshot {
  // Brush strokes mutate the active draft canvas. Saved surfaces/points are
  // immutable, so only this draft needs a pixel copy at action boundaries.
  return {
    ...state,
    maskShape: state.maskShape
      ? { ...cloneMask(state.maskShape), maskId: state.maskShape.maskId }
      : null,
  };
}

export function sameSnapshot(a: EditorSnapshot, b: EditorSnapshot) {
  return (
    a.photo === b.photo &&
    a.selections === b.selections &&
    JSON.stringify(a.points) === JSON.stringify(b.points) &&
    a.maskShape?.maskId === b.maskShape?.maskId &&
    a.drawing === b.drawing &&
    a.tool === b.tool &&
    a.lastTool === b.lastTool &&
    a.edgeSnap === b.edgeSnap &&
    a.colorTolerance === b.colorTolerance &&
    a.colorScope === b.colorScope &&
    a.maskEditMode === b.maskEditMode &&
    a.brushSize === b.brushSize &&
    a.areaMode === b.areaMode &&
    a.zoom === b.zoom &&
    a.pan.x === b.pan.x &&
    a.pan.y === b.pan.y &&
    a.panMode === b.panMode &&
    a.curveMode === b.curveMode &&
    a.color.colorCode === b.color.colorCode
  );
  // Selection, panel navigation, search, dialogs and export are UI context,
  // not edits. Restore selection/panel with an edit, but don't spend a step
  // when users only browse the interface.
}
