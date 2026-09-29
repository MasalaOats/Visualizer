import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ImagePlus,
  Magnet,
  Paintbrush,
  Palette,
  Pencil,
  Plus,
  Redo2,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
  Eye,
  Hand,
  Search,
  Layers,
  Trash2,
  MousePointer2,
  ShieldCheck,
} from "lucide-react";
import { colors } from "./colors";
import {
  cloneMask,
  colorFamily,
  containsPart,
  editMaskWithPath,
  makeColorMap,
  makeColorMask,
  makeEdgeMap,
  makePaintLayer,
  makePath,
  paintKey,
  paintMaskBrush,
  tintMask,
} from "./editor";
import type {
  Color,
  ColorMap,
  EdgeMap,
  MaskEditMode,
  MaskShape,
  Point,
  Selection,
  SurfacePart,
  Tool,
} from "./editor";
import { clearProject, loadProject, saveProject } from "./projectStorage";
import { History } from "./history";
import { UNDO_LIMIT } from "./historyConfig";
import { copySnapshot, sameSnapshot } from "./editorSnapshot";
import type { EditorSnapshot } from "./editorSnapshot";

type CurveDrag = {
  index: number;
  start: Point;
  mode: "anchor" | "segment" | "move";
};
const families = [
  "All colours",
  "Whites",
  "Neutrals",
  "Blacks",
  "Reds",
  "Oranges",
  "Yellows",
  "Greens",
  "Cyans",
  "Blues",
  "Purples",
  "Pinks",
];

function App() {
  const [image, setImage] = useState<string | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const selectionsRef = useRef(selections);
  const [points, setPoints] = useState<Point[]>([]);
  const [curveDrag, setCurveDrag] = useState<CurveDrag | null>(null);
  const [maskShape, setMaskShape] = useState<MaskShape | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>("polygon");
  const [edgeSnap, setEdgeSnap] = useState(false);
  const [colorTolerance, setColorTolerance] = useState(34);
  const [colorScope, setColorScope] = useState<"connected" | "image">(
    "connected",
  );
  const [colorSeed, setColorSeed] = useState<Point | null>(null);
  const [maskEditMode, setMaskEditMode] = useState<MaskEditMode>("select");
  const [brushSize, setBrushSize] = useState(24);
  const [areaMode, setAreaMode] = useState<"new" | "add" | "subtract" | "edit">(
    "new",
  );
  const [gesture, setGesture] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const spaceHeldRef = useRef(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<number[]>([]);
  const [color, setColor] = useState<Color>(colors[0]);
  const [name, setName] = useState("");
  const [naming, setNaming] = useState(false);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("All colours");
  const [visibleCount, setVisibleCount] = useState(64);
  const [exportFormat, setExportFormat] = useState<"png" | "jpg">("png");
  const [toast, setToast] = useState("");
  const [panel, setPanel] = useState<"surfaces" | "colors">("surfaces");
  const [original, setOriginal] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [curveMode, setCurveMode] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Opening workspace…");
  const [photoName, setPhotoName] = useState("");
  const [retrySave, setRetrySave] = useState(0);
  const photoRef = useRef<Blob | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const lastTool = useRef<Tool>("polygon");
  const history = useRef(new History<EditorSnapshot>(UNDO_LIMIT, sameSnapshot));
  const pendingHistory = useRef<{
    state: EditorSnapshot;
    label: string;
  } | null>(null);
  const historyGroup = useRef<string | null>(null);
  const [, refreshHistory] = useState(0);
  const projectOpened = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const maskTintRef = useRef<{
    maskId: number;
    canvas: HTMLCanvasElement;
  } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const edgeMapRef = useRef<EdgeMap | null>(null);
  const colorMapRef = useRef<ColorMap | null>(null);
  const paintCache = useRef(
    new Map<
      number,
      { key: string; canvas: HTMLCanvasElement; left: number; top: number }
    >(),
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = selections.find((item) => item.id === selectedId);
  const snapshotRef = useRef<EditorSnapshot>(null!);
  snapshotRef.current = {
    photo: photoRef.current,
    image: imageRef.current,
    edgeMap: edgeMapRef.current,
    colorMap: colorMapRef.current,
    photoName,
    selections,
    points,
    maskShape,
    drawing,
    tool,
    lastTool: lastTool.current,
    edgeSnap,
    colorTolerance,
    colorScope,
    colorSeed,
    maskEditMode,
    brushSize,
    areaMode,
    zoom,
    pan,
    panMode,
    curveMode,
    color,
    selectedId,
    multiSelectedIds,
    panel,
  };
  const flushHistory = () => {
    const pending = pendingHistory.current;
    if (!pending) return;
    pendingHistory.current = null;
    if (
      history.current.record(pending.state, snapshotRef.current, pending.label)
    )
      refreshHistory((v) => v + 1);
  };
  const beginHistory = (label: string) => {
    flushHistory();
    historyGroup.current = null;
    pendingHistory.current = {
      state: copySnapshot(snapshotRef.current),
      label,
    };
  };
  const change = (label: string, action: () => void) => {
    beginHistory(label);
    action();
  };
  const beginGesture = (label: string) => {
    beginHistory(label);
    historyGroup.current = "pointer";
  };
  const adjust = (label: string, action: () => void) => {
    if (historyGroup.current !== label) {
      beginHistory(label);
      historyGroup.current = label;
    }
    action();
  };
  const endAdjustment = () => {
    historyGroup.current = null;
    refreshHistory((v) => v + 1);
  };
  useLayoutEffect(() => {
    if (!historyGroup.current) flushHistory();
  });

  const restoreSnapshot = (state: EditorSnapshot) => {
    pendingHistory.current = null;
    historyGroup.current = null;
    if (imageRef.current !== state.image) {
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      const url = state.photo ? URL.createObjectURL(state.photo) : null;
      imageUrlRef.current = url;
      imageRef.current = state.image;
      photoRef.current = state.photo;
      edgeMapRef.current = state.edgeMap;
      colorMapRef.current = state.colorMap;
      setImage(url);
      const canvas = canvasRef.current!;
      canvas.width = state.image?.naturalWidth ?? 300;
      canvas.height = state.image?.naturalHeight ?? 150;
    }
    paintCache.current.clear();
    maskTintRef.current = null;
    selectionsRef.current = state.selections;
    lastTool.current = state.lastTool;
    setPhotoName(state.photoName);
    setSelections(state.selections);
    setPoints(state.points);
    setMaskShape(state.maskShape);
    setDrawing(state.drawing);
    setTool(state.tool);
    setEdgeSnap(state.edgeSnap);
    setColorTolerance(state.colorTolerance);
    setColorScope(state.colorScope);
    setColorSeed(state.colorSeed);
    setMaskEditMode(state.maskEditMode);
    setBrushSize(state.brushSize);
    setAreaMode(state.areaMode);
    setZoom(state.zoom);
    setPan(state.pan);
    setPanMode(state.panMode);
    setCurveMode(state.curveMode);
    setColor(state.color);
    setSelectedId(state.selectedId);
    setMultiSelectedIds(state.multiSelectedIds);
    setPanel(state.panel);
    setGesture(false);
    setCurveDrag(null);
    setPanStart(null);
    setNaming(false);
    setOriginal(false);
    setToast("");
    refreshHistory((v) => v + 1);
  };
  const undo = () => {
    if (loading || !ready) return;
    flushHistory();
    const previous = history.current.undo(copySnapshot(snapshotRef.current));
    if (previous) restoreSnapshot(previous);
  };
  const redo = () => {
    if (loading || !ready) return;
    flushHistory();
    const next = history.current.redo(copySnapshot(snapshotRef.current));
    if (next) restoreSnapshot(next);
  };
  const updateSelections = (update: (current: Selection[]) => Selection[]) => {
    const next = update(selectionsRef.current);
    selectionsRef.current = next;
    setSelections(next);
  };
  const palette = useMemo(
    () =>
      (colors as Color[]).filter(
        (c) =>
          (family === "All colours" || colorFamily(c) === family) &&
          `${c.colorName} ${c.colorCode} ${c.colorTone}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [family, query],
  );
  useEffect(() => setVisibleCount(64), [family, query]);
  const shortcutRef = useRef({ undo, redo });
  shortcutRef.current = { undo, redo };
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement,
        typing =
          target instanceof HTMLInputElement
            ? !["range", "checkbox", "radio", "button", "submit"].includes(
                target.type,
              )
            : target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && !typing) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) shortcutRef.current.redo();
          else shortcutRef.current.undo();
          return;
        }
        if (event.key.toLowerCase() === "y") {
          event.preventDefault();
          shortcutRef.current.redo();
          return;
        }
      }
      if (event.code === "Space" && !typing && target?.tagName !== "BUTTON") {
        event.preventDefault();
        spaceHeldRef.current = true;
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceHeldRef.current = false;
    };
    const blur = () => {
      spaceHeldRef.current = false;
      setOriginal(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const handleRadius = 5 / zoom;
  const draw = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      outlines = true,
      preview: Point[] = points,
    ) => {
      const canvas = ctx.canvas;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (imageRef.current)
        ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);
      if (outlines && original) return;
      selections.forEach((s) => {
        if (outlines && areaMode === "edit" && s.id === selectedId) return;
        ctx.save();
        if (s.color && imageRef.current) {
          const key = paintKey(s);
          let layer = paintCache.current.get(s.id);
          if (!layer || layer.key !== key) {
            const result = makePaintLayer(imageRef.current, s);
            layer = { ...result, key };
            paintCache.current.set(s.id, layer);
          }
          ctx.drawImage(layer.canvas, layer.left, layer.top);
        }
        if (outlines) {
          ctx.strokeStyle =
            s.id === selectedId ? "#b8754e" : "rgba(255,255,255,.95)";
          ctx.lineWidth = s.id === selectedId ? 3 : 2;
          ctx.setLineDash(s.id === selectedId ? [] : [7, 5]);
          s.shapes.forEach((shape) => {
            if ("maskCanvas" in shape) {
              if (!s.color) {
                ctx.save();
                ctx.globalAlpha = 0.28;
                ctx.drawImage(
                  shape.maskCanvas,
                  shape.left,
                  shape.top,
                  shape.maskCanvas.width / shape.scale,
                  shape.maskCanvas.height / shape.scale,
                );
                ctx.restore();
              }
            } else ctx.stroke(shape.path);
          });
          ctx.strokeStyle = "#e05b50";
          ctx.setLineDash([4, 4]);
          s.holes.forEach((shape) => {
            if (!("maskCanvas" in shape)) ctx.stroke(shape.path);
          });
        }
        ctx.restore();
      });
      if (outlines && maskShape) {
        let tint = maskTintRef.current;
        if (!tint || tint.maskId !== maskShape.maskId) {
          tint = {
            maskId: maskShape.maskId,
            canvas: tintMask(maskShape, "#20b875"),
          };
          maskTintRef.current = tint;
        }
        ctx.save();
        ctx.globalAlpha = 0.48;
        ctx.drawImage(
          tint.canvas,
          maskShape.left,
          maskShape.top,
          maskShape.maskCanvas.width / maskShape.scale,
          maskShape.maskCanvas.height / maskShape.scale,
        );
        ctx.restore();
      }
      if (outlines && preview.length) {
        ctx.save();
        ctx.strokeStyle = areaMode === "subtract" ? "#e05b50" : "#b8754e";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        if (
          maskShape &&
          tool === "polygon" &&
          (maskEditMode === "trace-add" || maskEditMode === "trace-erase") &&
          preview.length >= 3
        ) {
          ctx.fillStyle =
            maskEditMode === "trace-add"
              ? "rgba(32,184,117,.38)"
              : "rgba(226,73,73,.4)";
          ctx.fill(makePath(preview));
        }
        if (tool === "polygon" || tool === "freehand") {
          ctx.stroke(makePath(preview, tool !== "polygon"));
          ctx.setLineDash([]);
          if (tool === "polygon")
            preview.forEach((p) => {
              for (const handle of [p.inHandle, p.outHandle])
                if (handle) {
                  ctx.beginPath();
                  ctx.moveTo(p.x, p.y);
                  ctx.lineTo(handle.x, handle.y);
                  ctx.strokeStyle = "rgba(184,117,78,.75)";
                  ctx.lineWidth = 1;
                  ctx.stroke();
                  ctx.beginPath();
                  ctx.arc(handle.x, handle.y, 4, 0, Math.PI * 2);
                  ctx.fillStyle = "#fff";
                  ctx.fill();
                  ctx.stroke();
                }
              ctx.beginPath();
              ctx.arc(
                p.x,
                p.y,
                handleRadius *
                  (canvas.width /
                    (canvasRef.current?.offsetWidth || canvas.width)),
                0,
                Math.PI * 2,
              );
              ctx.fillStyle = "#fff";
              ctx.fill();
              ctx.strokeStyle = "#b8754e";
              ctx.stroke();
            });
        } else if (preview.length > 1) ctx.stroke(makePath(preview));
        ctx.restore();
      }
    },
    [
      areaMode,
      maskEditMode,
      maskShape,
      points,
      selectedId,
      selections,
      tool,
      original,
      handleRadius,
    ],
  );

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) draw(ctx);
  }, [draw, image]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const selectColorRegion = (
    seed: Point,
    tolerance = colorTolerance,
    scope = colorScope,
  ) => {
    if (!colorMapRef.current) return;
    setColorSeed(seed);
    setMaskShape(makeColorMask(colorMapRef.current, seed, tolerance, scope));
  };
  const changeTolerance = (value: number) =>
    adjust("Color tolerance", () => {
      setColorTolerance(value);
      if (colorSeed && tool === "wand") selectColorRegion(colorSeed, value);
    });
  const changeScope = (value: "connected" | "image") =>
    change("Selection scope", () => {
      setColorScope(value);
      if (colorSeed && tool === "wand")
        selectColorRegion(colorSeed, colorTolerance, value);
    });
  const installPhoto = useCallback(
    (
      img: HTMLImageElement,
      url: string,
      blob: Blob,
      restored: Selection[] = [],
    ) => {
      const canvas = canvasRef.current!;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      paintCache.current.clear();
      edgeMapRef.current = makeEdgeMap(img);
      colorMapRef.current = makeColorMap(img);
      imageRef.current = img;
      photoRef.current = blob;
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = url;
      selectionsRef.current = restored;
      projectOpened.current = true;
      setImage(url);
      setSelections(restored);
      setSelectedId(restored[0]?.id ?? null);
      setMultiSelectedIds([]);
      setPoints([]);
      setMaskShape(null);
      setColorSeed(null);
      setDrawing(false);
      setAreaMode("new");
      setNaming(false);
      setOriginal(false);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setPanMode(false);
      setPanel("surfaces");
    },
    [],
  );

  useEffect(() => {
    let active = true;
    let pendingUrl: string | null = null;
    void (async () => {
      try {
        const project = await loadProject();
        if (!active) return;
        if (project) {
          pendingUrl = URL.createObjectURL(project.photo);
          const img = new Image();
          img.src = pendingUrl;
          await img.decode();
          if (!active) return;
          installPhoto(img, pendingUrl, project.photo, project.selections);
          pendingUrl = null;
          setPhotoName(project.name);
          lastTool.current = project.tool;
          setTool(project.tool);
          setToast("Previous project restored.");
        }
        setSaveStatus(project ? "Saved on this device" : "Local workspace");
      } catch {
        if (active) setSaveStatus("Recovery unavailable");
      } finally {
        if (pendingUrl) URL.revokeObjectURL(pendingUrl);
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [installPhoto]);

  useEffect(
    () => () => {
      loadGeneration.current++;
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!ready || (!image && !projectOpened.current)) return;
    let active = true;
    setSaveStatus("Saving…");
    void (
      photoRef.current
        ? saveProject(photoRef.current, photoName, selections, lastTool.current)
        : clearProject()
    )
      .then(() => {
        if (active)
          setSaveStatus(image ? "Saved on this device" : "Local workspace");
      })
      .catch(() => {
        if (active) setSaveStatus("Could not save — retry");
      });
    return () => {
      active = false;
    };
  }, [ready, image, photoName, selections, retrySave]);

  useEffect(() => {
    if (
      !drawing &&
      saveStatus !== "Saving…" &&
      !saveStatus.startsWith("Could not")
    )
      return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drawing, saveStatus]);

  useEffect(() => {
    if (naming) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [naming]);

  const upload = async (file?: File) => {
    if (!file || !ready || loading) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setToast("Choose a JPG, PNG or WEBP photo.");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setToast("Choose a photo smaller than 30 MB.");
      return;
    }
    if (
      (selections.length || drawing) &&
      !window.confirm(
        "Replace this photo and its surfaces? Export your preview first if you want to keep it.",
      )
    )
      return;
    const generation = ++loadGeneration.current;
    const url = URL.createObjectURL(file);
    setLoading(true);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (generation !== loadGeneration.current) {
        URL.revokeObjectURL(url);
        return;
      }
      if (img.naturalWidth * img.naturalHeight > 24_000_000)
        throw new Error(
          "This photo is too large. Resize it below 24 megapixels and try again.",
        );
      beginHistory("Import photograph");
      installPhoto(img, url, file);
      setPhotoName(file.name);
      setToast("Photograph imported. Define a surface to continue.");
    } catch (error) {
      URL.revokeObjectURL(url);
      if (generation === loadGeneration.current)
        setToast(
          error instanceof Error && error.message.startsWith("This photo")
            ? error.message
            : "This photo could not be opened. Try another file.",
        );
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  };
  const pointFromEvent = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(c.width, ((e.clientX - r.left) * c.width) / r.width),
      ),
      y: Math.max(
        0,
        Math.min(c.height, ((e.clientY - r.top) * c.height) / r.height),
      ),
    };
  };
  const snapToEdge = (point: Point): Point => {
    const map = edgeMapRef.current,
      canvas = canvasRef.current;
    if (!edgeSnap || !map || !canvas) return point;
    const scale = map.scale,
      centerX = Math.round(point.x * scale),
      centerY = Math.round(point.y * scale);
    const radius = Math.round(
      Math.max(
        3,
        Math.min(
          32,
          9 * (canvas.width / canvas.getBoundingClientRect().width) * scale,
        ),
      ),
    );
    let best = point,
      bestScore = 26;
    for (
      let y = Math.max(1, centerY - radius);
      y <= Math.min(map.height - 2, centerY + radius);
      y++
    )
      for (
        let x = Math.max(1, centerX - radius);
        x <= Math.min(map.width - 2, centerX + radius);
        x++
      ) {
        const distance = Math.hypot(x - centerX, y - centerY),
          edge = map.data[y * map.width + x];
        const score = edge - distance * 1.35;
        if (distance <= radius && score > bestScore) {
          bestScore = score;
          best = { x: x / scale, y: y / scale };
        }
      }
    return best;
  };
  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (original || loading) return;
    const p = pointFromEvent(e);
    if (spaceHeldRef.current || panMode) {
      beginGesture("Pan photo");
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanStart({ x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y });
      return;
    }
    if (!drawing) {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        const hit = [...selections]
          .reverse()
          .find(
            (s) =>
              s.shapes.some((shape) => containsPart(ctx, shape, p)) &&
              !s.holes.some((shape) => containsPart(ctx, shape, p)),
          );
        if (hit) {
          setSelectedId(hit.id);
          setPanel("colors");
        }
      }
      return;
    }
    if (tool === "wand") {
      if (maskShape && (maskEditMode === "add" || maskEditMode === "erase")) {
        beginGesture(maskEditMode === "erase" ? "Erase mask" : "Restore mask");
        e.currentTarget.setPointerCapture(e.pointerId);
        setGesture(true);
        setColorSeed(null);
        const img = imageRef.current;
        if (img)
          setMaskShape((v) =>
            v
              ? paintMaskBrush(
                  v,
                  p,
                  maskEditMode,
                  brushSize,
                  img.naturalWidth,
                  img.naturalHeight,
                )
              : v,
          );
        return;
      }
      beginHistory("Select color region");
      selectColorRegion(p);
      setPoints([]);
      return;
    }
    if (tool === "polygon") {
      const canvas = e.currentTarget,
        hitRadius = (14 * canvas.width) / canvas.getBoundingClientRect().width;
      const bending = e.shiftKey || curveMode;
      for (let i = points.length - 1; i >= 0; i--) {
        if (Math.hypot(points[i].x - p.x, points[i].y - p.y) <= hitRadius) {
          beginGesture(bending ? "Curve point" : "Move point");
          canvas.setPointerCapture(e.pointerId);
          setGesture(true);
          setCurveDrag({
            index: i,
            start: p,
            mode: bending ? "anchor" : "move",
          });
          return;
        }
      }
      if (bending && points.length > 1) {
        let nearest = -1,
          nearestDistance = hitRadius;
        for (let i = 0; i < points.length; i++) {
          const a = points[i],
            b = points[(i + 1) % points.length],
            dx = b.x - a.x,
            dy = b.y - a.y;
          const length2 = dx * dx + dy * dy;
          const t = length2
            ? Math.max(
                0,
                Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2),
              )
            : 0;
          const distance = Math.hypot(
            p.x - (a.x + t * dx),
            p.y - (a.y + t * dy),
          );
          if (distance < nearestDistance) {
            nearest = i;
            nearestDistance = distance;
          }
        }
        if (nearest >= 0) {
          beginGesture("Curve edge");
          canvas.setPointerCapture(e.pointerId);
          setGesture(true);
          setCurveDrag({ index: nearest, start: p, mode: "segment" });
          return;
        }
        return;
      }
      beginHistory("Add point");
      setPoints((v) => [...v, snapToEdge(p)]);
      return;
    }
    beginGesture("Freehand outline");
    e.currentTarget.setPointerCapture(e.pointerId);
    setGesture(true);
    setPoints([p]);
  };
  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (panStart) {
      setPan({
        x: panStart.panX + e.clientX - panStart.x,
        y: panStart.panY + e.clientY - panStart.y,
      });
      return;
    }
    if (!drawing || !gesture) return;
    const p = pointFromEvent(e);
    if (
      tool === "wand" &&
      maskShape &&
      (maskEditMode === "add" || maskEditMode === "erase")
    ) {
      const img = imageRef.current;
      if (img)
        setMaskShape((v) =>
          v
            ? paintMaskBrush(
                v,
                p,
                maskEditMode,
                brushSize,
                img.naturalWidth,
                img.naturalHeight,
              )
            : v,
        );
      return;
    }
    if (tool === "polygon" && curveDrag?.mode === "move") {
      setPoints((v) =>
        v.map((point, i) => {
          if (i !== curveDrag.index) return point;
          const dx = p.x - point.x,
            dy = p.y - point.y;
          const move = (handle?: Point) =>
            handle ? { x: handle.x + dx, y: handle.y + dy } : undefined;
          return {
            ...point,
            x: p.x,
            y: p.y,
            inHandle: move(point.inHandle),
            outHandle: move(point.outHandle),
          };
        }),
      );
      return;
    }
    if (tool === "polygon" && curveDrag) {
      if (
        Math.hypot(p.x - curveDrag.start.x, p.y - curveDrag.start.y) <
        (3 * e.currentTarget.width) /
          e.currentTarget.getBoundingClientRect().width
      )
        return;
      setPoints((v) => {
        if (curveDrag.mode === "anchor")
          return v.map((point, i) =>
            i === curveDrag.index
              ? {
                  ...point,
                  outHandle: p,
                  inHandle: { x: 2 * point.x - p.x, y: 2 * point.y - p.y },
                }
              : point,
          );
        const a = v[curveDrag.index],
          b = v[(curveDrag.index + 1) % v.length],
          dx = b.x - a.x,
          dy = b.y - a.y,
          length = Math.hypot(dx, dy) || 1,
          nx = -dy / length,
          ny = dx / length,
          offset =
            (((p.x - curveDrag.start.x) * nx + (p.y - curveDrag.start.y) * ny) *
              4) /
            3;
        return v.map((point, i) =>
          i === curveDrag.index
            ? {
                ...point,
                outHandle: {
                  x: a.x + dx / 3 + nx * offset,
                  y: a.y + dy / 3 + ny * offset,
                },
              }
            : i === (curveDrag.index + 1) % v.length
              ? {
                  ...point,
                  inHandle: {
                    x: b.x - dx / 3 + nx * offset,
                    y: b.y - dy / 3 + ny * offset,
                  },
                }
              : point,
        );
      });
      return;
    }
    setPoints((v) => (tool === "freehand" ? [...v, p] : [v[0], p]));
  };
  const handlePointerUp = () => {
    if (historyGroup.current === "pointer") historyGroup.current = null;
    setGesture(false);
    setCurveDrag(null);
    setPanStart(null);
  };
  const changeZoom = (next: number) => {
    const value = Math.max(1, Math.min(4, next));
    if (value === zoom && (value !== 1 || (pan.x === 0 && pan.y === 0))) return;
    beginHistory(value === 1 ? "Fit photo" : "Zoom photo");
    setZoom(value);
    if (value === 1) setPan({ x: 0, y: 0 });
  };
  const minimumPoints = tool === "wand" ? 0 : 3;
  const canFinish =
    tool === "wand" ? maskShape !== null : points.length >= minimumPoints;
  const isMaskTrace =
    maskEditMode === "trace-add" || maskEditMode === "trace-erase";
  const makeCurrentShape = (): SurfacePart =>
    tool === "wand" && maskShape
      ? maskShape
      : { path: makePath(points), points, tool };
  const resetDrawing = () => {
    setDrawing(false);
    setGesture(false);
    setCurveDrag(null);
    setPoints([]);
    setMaskShape(null);
    setColorSeed(null);
    setAreaMode("new");
    setMaskEditMode("select");
  };
  const saveArea = () => {
    const id = Date.now();
    const shape = makeCurrentShape();
    updateSelections((v) => [
      ...v,
      {
        id,
        name: `Surface ${v.length + 1}`,
        shapes: [shape],
        holes: [],
        color: null,
        opacity: 1,
      },
    ]);
    setSelectedId(id);
    resetDrawing();
    setPanel("colors");
    setToast("Surface created. Select a shade to apply.");
  };
  const startDrawing = (mode: "new" | "add" | "subtract") => {
    beginHistory("Start surface");
    resetDrawing();
    setDrawing(true);
    setAreaMode(mode);
    setTool(lastTool.current);
    setPanMode(false);
    setCurveMode(false);
    setPanel("surfaces");
    if (mode === "new") {
      setSelectedId(null);
      setMultiSelectedIds([]);
    }
  };
  const chooseTool = (next: Tool) => {
    beginHistory("Change drawing tool");
    lastTool.current = next;
    setTool(next);
    setMaskShape(null);
    setColorSeed(null);
    setMaskEditMode("select");
    setGesture(false);
    setCurveDrag(null);
    setPoints([]);
    setCurveMode(false);
  };
  const canEditSurface = !!selected && selected.shapes.length === 1;
  const editSurface = () => {
    const shape = selected?.shapes[0];
    if (!selected || !shape || selected.shapes.length !== 1) return;
    beginHistory("Edit surface");
    resetDrawing();
    setDrawing(true);
    setAreaMode("edit");
    setPanMode(false);
    setCurveMode(false);
    if ("maskCanvas" in shape) {
      setTool("wand");
      setMaskShape(cloneMask(shape));
      setMaskEditMode("erase");
    } else {
      setTool("polygon");
      setPoints(shape.points);
    }
    setPanel("surfaces");
  };
  const finishDrawing = () => {
    if (!canFinish) return;
    beginHistory("Finish surface");
    if (areaMode === "edit" && selectedId !== null) {
      const shape = makeCurrentShape();
      updateSelections((v) =>
        v.map((s) => (s.id === selectedId ? { ...s, shapes: [shape] } : s)),
      );
      paintCache.current.delete(selectedId);
      resetDrawing();
      setToast("Surface updated.");
      return;
    }
    if (areaMode === "new") {
      saveArea();
      return;
    }
    if (selectedId === null) return;
    const shape = makeCurrentShape();
    updateSelections((v) =>
      v.map((s) =>
        s.id !== selectedId
          ? s
          : areaMode === "add"
            ? { ...s, shapes: [...s.shapes, shape] }
            : { ...s, holes: [...s.holes, shape] },
      ),
    );
    paintCache.current.delete(selectedId);
    setPoints([]);
    setMaskShape(null);
    setDrawing(false);
    setAreaMode("new");
    setToast(
      areaMode === "add"
        ? "Area added to the paint mask."
        : "Object cut out of the paint mask.",
    );
  };
  const finishMaskTrace = () => {
    if (!maskShape || points.length < 3 || !imageRef.current) return;
    beginHistory("Apply mask trace");
    const mode = maskEditMode === "trace-erase" ? "erase" : "add";
    const next = editMaskWithPath(
      maskShape,
      makePath(points),
      points,
      mode,
      imageRef.current.naturalWidth,
      imageRef.current.naturalHeight,
    );
    setMaskShape(next);
    setPoints([]);
    setCurveDrag(null);
    setColorSeed(null);
    setTool("wand");
    setMaskEditMode("select");
    setToast(
      mode === "add"
        ? "Traced region added to the colour selection."
        : next
          ? "Traced region removed from the colour selection."
          : "Colour selection cleared.",
    );
  };
  const chooseColor = (next: Color) => {
    beginHistory("Apply shade");
    setColor(next);
    if (!selected || drawing || selected.colorCode === next.colorCode) return;
    updateSelections((v) =>
      v.map((s) =>
        s.id === selected.id
          ? {
              ...s,
              color: next.colorValue,
              colorName: next.colorName,
              colorCode: next.colorCode,
            }
          : s,
      ),
    );
  };
  const setOpacity = (opacity: number) => {
    if (!selected || selected.opacity === opacity) return;
    adjust("Paint coverage", () =>
      updateSelections((v) =>
        v.map((s) => (s.id === selected.id ? { ...s, opacity } : s)),
      ),
    );
  };
  const remove = () => {
    if (!selected) return;
    beginHistory("Remove surface");
    updateSelections((v) => v.filter((s) => s.id !== selectedId));
    if (selectedId !== null) paintCache.current.delete(selectedId);
    setSelectedId(null);
  };
  const clearPaint = () => {
    if (!selected) return;
    beginHistory("Remove paint");
    updateSelections((v) =>
      v.map((s) =>
        s.id === selected.id
          ? { ...s, color: null, colorName: undefined, colorCode: undefined }
          : s,
      ),
    );
    paintCache.current.delete(selected.id);
    setToast("Paint removed from this surface.");
  };
  const mergeSelected = () => {
    const ids = new Set([
      ...(selectedId === null ? [] : [selectedId]),
      ...multiSelectedIds,
    ]);
    if (ids.size < 2) return;
    beginHistory("Merge surfaces");
    const parts = selections.filter((s) => ids.has(s.id));
    const active = parts.find((s) => s.id === selectedId) ?? parts[0];
    const merged: Selection = {
      id: Date.now(),
      name: parts.map((s) => s.name).join(" + "),
      shapes: parts.flatMap((s) => s.shapes),
      holes: parts.flatMap((s) => s.holes),
      color: active.color,
      colorName: active.colorName,
      colorCode: active.colorCode,
      opacity: active.opacity,
      mergedFrom: parts,
    };
    updateSelections((v) => [...v.filter((s) => !ids.has(s.id)), merged]);
    parts.forEach((s) => paintCache.current.delete(s.id));
    setSelectedId(merged.id);
    setMultiSelectedIds([]);
    setToast(`${parts.length} surfaces merged. You can split them again.`);
  };
  const splitSelected = () => {
    if (!selected?.mergedFrom) return;
    beginHistory("Split surfaces");
    const originals = selected.mergedFrom;
    updateSelections((v) => [
      ...v.filter((s) => s.id !== selected.id),
      ...originals,
    ]);
    paintCache.current.delete(selected.id);
    setSelectedId(originals[0]?.id ?? null);
    setMultiSelectedIds([]);
    setToast("Merged surfaces split back into their original areas.");
  };
  const exportImage = () => {
    const c = canvasRef.current;
    if (!c || !image) return;
    const out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    draw(ctx, false, []);
    const jpg = exportFormat === "jpg";
    const a = document.createElement("a");
    a.download = `visualizer-preview.${exportFormat}`;
    a.href = out.toDataURL(
      jpg ? "image/jpeg" : "image/png",
      jpg ? 0.92 : undefined,
    );
    a.click();
    setToast(`${jpg ? "JPG" : "PNG"} preview exported.`);
  };

  const cancelDrawing = () => {
    beginHistory("Cancel drawing");
    if (isMaskTrace) {
      setTool("wand");
      setMaskEditMode("select");
      setPoints([]);
      setCurveDrag(null);
      setGesture(false);
      setColorSeed(null);
    } else resetDrawing();
  };
  const activeColor = selected?.color
    ? {
        colorName: selected.colorName,
        colorCode: selected.colorCode,
        colorValue: selected.color,
      }
    : color;
  const busy = !ready || loading;

  return (
    <div
      className="app-shell"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void upload(e.dataTransfer.files[0]);
      }}
    >
      <header className="topbar">
        <a className="brand" href="#" aria-label="Visualizer home">
          <span className="brand-mark">
            <svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true">
              <path d="M4 6h7l8 20h-7L4 6Z" fill="currentColor" />
              <path
                d="m21 6-5 12 4 8L28 6h-7Z"
                fill="currentColor"
                opacity=".55"
              />
            </svg>
          </span>
          Visualizer
          <span className="brand-divider" />
          <span className="brand-subtitle">Colour studio</span>
        </a>
        <div className="header-actions">
          <span
            className={`save-status ${saveStatus.startsWith("Could not") || saveStatus === "Recovery unavailable" ? "save-error" : ""}`}
            role="status"
          >
            <span className="status-dot" />
            {saveStatus}
          </span>
          {saveStatus.startsWith("Could not") && (
            <button onClick={() => setRetrySave((v) => v + 1)}>
              Retry save
            </button>
          )}
          <div className="export-controls">
            <select
              aria-label="Export format"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as "png" | "jpg")}
            >
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
            </select>
            <button
              className="primary-button"
              disabled={!image || busy || drawing}
              onClick={exportImage}
            >
              <ArrowDownToLine size={17} />
              <span>Export image</span>
            </button>
          </div>
        </div>
      </header>

      <main className="workspace">
        <div className="workspace-heading">
          <div>
            <h1>Colour studio</h1>
            <p>Preview paint on walls, borders and more.</p>
          </div>
          <span className="local-badge">
            <ShieldCheck size={16} /> Photos stay on this device
          </span>
        </div>
        <section
          className={image ? "main-column with-photo" : "main-column"}
          aria-label="Photo workspace"
        >
          <div className="preview-header">
            <div>
              <span className="section-title">Project canvas</span>
              <span className="photo-name" title={photoName}>
                {photoName || "No photograph imported"}
              </span>
            </div>
            <div className="preview-actions">
              <div
                className="history-controls"
                aria-label={`Edit history, maximum ${UNDO_LIMIT} steps`}
              >
                <button
                  aria-label="Undo"
                  title={`Undo ${history.current.past[history.current.past.length - 1]?.label ?? "edit"} (Ctrl+Z)`}
                  disabled={busy || !history.current.past.length}
                  onClick={undo}
                >
                  <Undo2 size={17} />
                </button>
                <button
                  aria-label="Redo"
                  title={`Redo ${history.current.future[history.current.future.length - 1]?.label ?? "edit"} (Ctrl+Shift+Z)`}
                  disabled={busy || !history.current.future.length}
                  onClick={redo}
                >
                  <Redo2 size={17} />
                </button>
                <span className="history-count" title="Available undo steps">
                  {history.current.past.length}/{UNDO_LIMIT}
                </span>
              </div>
              <button
                className={`compare-button ${original ? "active" : ""}`}
                disabled={!image || busy}
                aria-label="Hold to view original"
                title="Hold to view the original photo"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setOriginal(true);
                }}
                onPointerUp={() => setOriginal(false)}
                onPointerCancel={() => setOriginal(false)}
                onLostPointerCapture={() => setOriginal(false)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    setOriginal(true);
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    setOriginal(false);
                  }
                }}
                onBlur={() => setOriginal(false)}
              >
                <Eye size={17} />
                {original ? "Original photo" : "Hold for original"}
              </button>
            </div>
          </div>
          <div className={`canvas-card ${image ? "has-image" : ""}`}>
            {!image && (
              <div className="upload-empty">
                <div className="material-study" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <div className="material-line" />
                </div>
                <span className="eyebrow">INTERIORS &amp; EXTERIORS</span>
                <h2>Colour, in context.</h2>
                <p>
                  Bring the shade card to your customer's space.
                  <br />
                  Import a site photograph to create a colour study.
                </p>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={18} />
                  {!ready ? "Opening workspace…" : "Import photograph"}
                </button>
                <span className="file-note">
                  JPG / PNG / WEBP · 30 MB max · drag & drop supported
                </span>
              </div>
            )}
            <canvas
              ref={canvasRef}
              aria-label="Photo editor. Select a tool in Surfaces, then draw on the photo."
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
              className={
                !image
                  ? "hidden-canvas"
                  : panMode
                    ? "panning-canvas"
                    : drawing
                      ? "drawing-canvas"
                      : "view-canvas"
              }
            />
            {original && <span className="original-label">Original</span>}
            {loading && (
              <div className="loading-overlay" role="status">
                Opening your photo…
              </div>
            )}
          </div>
          <div className="canvas-footer">
            <div className="canvas-tools">
              <button
                aria-label="Zoom out"
                disabled={!image || zoom <= 1}
                onClick={() => changeZoom(zoom - 0.25)}
              >
                <ZoomOut size={18} />
              </button>
              <span className="zoom-label">{Math.round(zoom * 100)}%</span>
              <button
                aria-label="Zoom in"
                disabled={!image || zoom >= 4}
                onClick={() => changeZoom(zoom + 0.25)}
              >
                <ZoomIn size={18} />
              </button>
              <button disabled={!image} onClick={() => changeZoom(1)}>
                Fit
              </button>
              <span className="tool-divider" />
              <button
                aria-pressed={panMode}
                className={panMode ? "active" : ""}
                disabled={!image}
                onClick={() => change("Pan mode", () => setPanMode((v) => !v))}
              >
                <Hand size={17} /> Pan
              </button>
            </div>
            <button
              className="change-photo"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus size={17} />
              {image ? "Change photo" : "Add photo"}
            </button>
          </div>
          <div className="workspace-note">
            <span>
              {drawing
                ? "Finish your surface to save these edits."
                : "Local workspace · Original resolution export"}
            </span>
            <span>Verify final colours against a physical shade card.</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </section>

        <aside className="side-panel" aria-label="Painting tools">
          <div className="panel-tabs" role="tablist" aria-label="Editor panels">
            <button
              id="surfaces-tab"
              role="tab"
              aria-selected={panel === "surfaces"}
              aria-controls="surfaces-panel"
              tabIndex={panel === "surfaces" ? 0 : -1}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  setPanel("colors");
                  document.getElementById("colors-tab")?.focus();
                }
              }}
              onClick={() => setPanel("surfaces")}
            >
              <Layers size={17} /> Surfaces <span>{selections.length}</span>
            </button>
            <button
              id="colors-tab"
              role="tab"
              aria-selected={panel === "colors"}
              aria-controls="colors-panel"
              tabIndex={panel === "colors" ? 0 : -1}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  setPanel("surfaces");
                  document.getElementById("surfaces-tab")?.focus();
                }
              }}
              onClick={() => setPanel("colors")}
            >
              <Palette size={17} /> Colours
            </button>
          </div>
          {panel === "surfaces" ? (
            <div
              id="surfaces-panel"
              role="tabpanel"
              aria-labelledby="surfaces-tab"
              className="panel-content"
            >
              <div className="section-heading">
                <div>
                  <h2>
                    {drawing
                      ? areaMode === "edit"
                        ? "Refine surface"
                        : areaMode === "subtract"
                          ? "Cut out an object"
                          : areaMode === "add"
                            ? "Extend surface"
                            : "Create a surface"
                      : "Surface manager"}
                  </h2>
                  <p>
                    {drawing
                      ? "Mark the area you want to change."
                      : "Define walls, trims and other paintable areas."}
                  </p>
                </div>
              </div>
              {!drawing && (
                <>
                  {selections.length === 0 ? (
                    <div className="empty-surfaces">
                      <Layers size={27} />
                      <b>No surfaces defined</b>
                      <p>
                        {image
                          ? "Outline a paintable area on the canvas."
                          : "Import a photograph to define surfaces."}
                      </p>
                    </div>
                  ) : (
                    <div className="area-list">
                      {selections.map((s) => (
                        <div
                          className={`surface-row ${selectedId === s.id ? "selected" : ""}`}
                          key={s.id}
                        >
                          <button
                            className="area-row"
                            aria-pressed={selectedId === s.id}
                            onClick={() => {
                              setSelectedId(s.id);
                            }}
                          >
                            <span
                              className="area-swatch"
                              style={{ background: s.color || "#e5e7eb" }}
                            />
                            <span className="area-text">
                              <b>{s.name}</b>
                              <small>{s.colorName || "No shade applied"}</small>
                            </span>
                            {selectedId === s.id && <Check size={16} />}
                          </button>
                          {selections.length > 1 && (
                            <input
                              type="checkbox"
                              aria-label={`Include ${s.name} in merge`}
                              checked={multiSelectedIds.includes(s.id)}
                              onChange={(e) =>
                                setMultiSelectedIds((v) =>
                                  e.target.checked
                                    ? [...v, s.id]
                                    : v.filter((id) => id !== s.id),
                                )
                              }
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    className="primary-button full-width"
                    disabled={!image || busy}
                    onClick={() => startDrawing("new")}
                  >
                    <Plus size={18} /> Create surface
                  </button>
                  {selected && (
                    <div className="selected-surface-tools">
                      <div className="section-label">EDIT SELECTED SURFACE</div>
                      <div className="surface-actions">
                        <button
                          onClick={editSurface}
                          disabled={!canEditSurface}
                          title={
                            canEditSurface
                              ? "Adjust the outline or brush the colour selection"
                              : "Use add or cutout tools for surfaces with multiple parts"
                          }
                        >
                          <Pencil size={16} /> Edit surface
                        </button>
                        <button
                          onClick={() => {
                            setName(selected.name);
                            setNaming(true);
                          }}
                        >
                          Rename
                        </button>
                        <button onClick={() => startDrawing("add")}>
                          <Plus size={16} /> Add area
                        </button>
                        <button onClick={() => startDrawing("subtract")}>
                          <X size={16} /> Cut out
                        </button>
                      </div>
                      <div className="surface-secondary-actions">
                        <button className="text-button danger" onClick={remove}>
                          <Trash2 size={15} /> Remove
                        </button>
                        {selected.mergedFrom && (
                          <button
                            className="text-button"
                            onClick={splitSelected}
                          >
                            Split surfaces
                          </button>
                        )}
                        {new Set([selectedId, ...multiSelectedIds]).size >
                          1 && (
                          <button
                            className="text-button"
                            onClick={mergeSelected}
                          >
                            Merge selected
                          </button>
                        )}
                      </div>
                      {selections.length > 1 && (
                        <p className="helper-text">
                          Tick surfaces to merge them with the selected surface.
                        </p>
                      )}
                    </div>
                  )}
                  {selected && (
                    <button
                      className="outline-button full-width"
                      onClick={() => setPanel("colors")}
                    >
                      <Palette size={17} /> Browse shades
                    </button>
                  )}
                </>
              )}
              {drawing && (
                <>
                  {!isMaskTrace && areaMode !== "edit" && (
                    <div
                      className="tool-picker"
                      aria-label="Surface drawing tools"
                    >
                      <button
                        aria-pressed={tool === "polygon"}
                        className={tool === "polygon" ? "active" : ""}
                        onClick={() => chooseTool("polygon")}
                      >
                        <MousePointer2 size={18} />
                        <span>
                          Point trace<small>Click around the edges</small>
                        </span>
                      </button>
                      <button
                        aria-pressed={tool === "freehand"}
                        className={tool === "freehand" ? "active" : ""}
                        onClick={() => chooseTool("freehand")}
                      >
                        <Pencil size={18} />
                        <span>
                          Freehand<small>Draw an outline</small>
                        </span>
                      </button>
                      <button
                        aria-pressed={tool === "wand"}
                        className={tool === "wand" ? "active" : ""}
                        onClick={() => chooseTool("wand")}
                      >
                        <Paintbrush size={18} />
                        <span>
                          Select similar colour
                          <small>Click a patch of the wall</small>
                        </span>
                      </button>
                    </div>
                  )}
                  {tool === "polygon" && (
                    <div className="drawing-options">
                      <div className="segmented-control">
                        <button
                          aria-pressed={!curveMode}
                          className={!curveMode ? "active" : ""}
                          onClick={() =>
                            change("Point mode", () => setCurveMode(false))
                          }
                        >
                          Points
                        </button>
                        <button
                          aria-pressed={curveMode}
                          className={curveMode ? "active" : ""}
                          onClick={() =>
                            change("Curve mode", () => setCurveMode(true))
                          }
                        >
                          Curves
                        </button>
                      </div>
                      <p className="helper-text">
                        {curveMode
                          ? "Drag a point or an edge to bend the outline."
                          : "Click to add points. Drag any point to adjust its position."}
                      </p>
                      <button
                        className="full-width"
                        disabled={!points.length}
                        onClick={() => {
                          beginHistory("Remove point");
                          setPoints((v) => v.slice(0, -1));
                          setCurveDrag(null);
                        }}
                      >
                        <Undo2 size={16} /> Remove last point{" "}
                        <span className="button-count">{points.length}</span>
                      </button>
                      <button
                        aria-pressed={edgeSnap}
                        className={`edge-snap full-width ${edgeSnap ? "active" : ""}`}
                        onClick={() =>
                          change("Edge snapping", () => setEdgeSnap((v) => !v))
                        }
                      >
                        <Magnet size={16} />
                        {edgeSnap ? "Edge snapping on" : "Snap points to edges"}
                      </button>
                    </div>
                  )}
                  {tool === "freehand" && (
                    <p className="helper-text">
                      Press and drag around the surface. Release when the
                      outline is complete.
                    </p>
                  )}
                  {tool === "wand" && (
                    <div className="wand-options">
                      <label className="range-control">
                        <span>
                          Colour tolerance <b>{colorTolerance}</b>
                        </span>
                        <input
                          aria-label="Colour tolerance"
                          type="range"
                          onPointerUp={endAdjustment}
                          onPointerCancel={endAdjustment}
                          onKeyUp={endAdjustment}
                          onBlur={endAdjustment}
                          min="8"
                          max="100"
                          value={colorTolerance}
                          onChange={(e) =>
                            changeTolerance(Number(e.target.value))
                          }
                        />
                      </label>
                      <label className="check-control">
                        <input
                          type="checkbox"
                          checked={colorScope === "image"}
                          onChange={(e) =>
                            changeScope(
                              e.target.checked ? "image" : "connected",
                            )
                          }
                        />
                        <span>
                          Match across the photo
                          <small>
                            Include separate patches of the same colour.
                          </small>
                        </span>
                      </label>
                      {maskShape && (
                        <>
                          <div className="section-label">REFINE SELECTION</div>
                          <div className="mask-edit-tools">
                            {(
                              [
                                ["select", "Select patch"],
                                ["add", "Restore brush"],
                                ["erase", "Erase brush"],
                              ] as const
                            ).map(([mode, label]) => (
                              <button
                                key={mode}
                                aria-pressed={maskEditMode === mode}
                                className={
                                  maskEditMode === mode ? "active" : ""
                                }
                                onClick={() =>
                                  change("Mask tool", () =>
                                    setMaskEditMode(mode),
                                  )
                                }
                              >
                                {label}
                              </button>
                            ))}
                            <button
                              onClick={() => {
                                beginHistory("Trace mask addition");
                                setMaskEditMode("trace-add");
                                setTool("polygon");
                                setPoints([]);
                                setCurveMode(false);
                                setColorSeed(null);
                              }}
                            >
                              Trace add
                            </button>
                            <button
                              onClick={() => {
                                beginHistory("Trace mask cutout");
                                setMaskEditMode("trace-erase");
                                setTool("polygon");
                                setPoints([]);
                                setCurveMode(false);
                                setColorSeed(null);
                              }}
                            >
                              Trace erase
                            </button>
                          </div>
                          {(maskEditMode === "add" ||
                            maskEditMode === "erase") && (
                            <label className="range-control">
                              <span>
                                Brush size <b>{brushSize}px</b>
                              </span>
                              <input
                                aria-label="Mask brush size"
                                type="range"
                                onPointerUp={endAdjustment}
                                onPointerCancel={endAdjustment}
                                onKeyUp={endAdjustment}
                                onBlur={endAdjustment}
                                min="6"
                                max="120"
                                value={brushSize}
                                onChange={(e) =>
                                  adjust("Brush size", () =>
                                    setBrushSize(Number(e.target.value)),
                                  )
                                }
                              />
                            </label>
                          )}
                        </>
                      )}
                      <p className="helper-text">
                        {maskShape
                          ? "Green shows your selection. Brush over the photo to refine it, or select a new patch."
                          : "Click the wall to select a patch. Adjust tolerance to include more or less."}
                      </p>
                    </div>
                  )}
                  {isMaskTrace && (
                    <p className="helper-text">
                      {maskEditMode === "trace-add"
                        ? "Trace the area to add to your selection."
                        : "Trace the area to remove from your selection."}
                    </p>
                  )}
                  <div className="drawing-actions">
                    <button onClick={cancelDrawing}>
                      <X size={16} />
                      {isMaskTrace ? "Cancel trace" : "Cancel"}
                    </button>
                    <button
                      className="primary-button"
                      disabled={isMaskTrace ? points.length < 3 : !canFinish}
                      onClick={isMaskTrace ? finishMaskTrace : finishDrawing}
                    >
                      <Check size={17} />
                      {isMaskTrace
                        ? "Apply trace"
                        : areaMode === "edit"
                          ? "Save changes"
                          : "Finish surface"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div
              id="colors-panel"
              role="tabpanel"
              aria-labelledby="colors-tab"
              className="panel-content palette-section"
            >
              <div className="section-heading">
                <div>
                  <h2>Shade library</h2>
                  <p>
                    {drawing
                      ? "Finish your surface before applying colours."
                      : selected
                        ? "Select a shade to apply it to the active surface."
                        : "Create or select a surface to start painting."}
                  </p>
                </div>
              </div>
              {selections.length > 0 && (
                <label className="surface-select">
                  <span>Painting</span>
                  <select
                    aria-label="Surface to paint"
                    disabled={drawing}
                    value={selectedId ?? ""}
                    onChange={(e) => setSelectedId(Number(e.target.value))}
                  >
                    <option value="" disabled>
                      Select a surface
                    </option>
                    {selections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </label>
              )}
              <div className="selected-color">
                <span
                  className="selected-dot"
                  style={{ background: activeColor.colorValue }}
                />
                <div>
                  <small>
                    {selected?.color ? "ON THIS SURFACE" : "SELECTED SHADE"}
                  </small>
                  <b>{activeColor.colorName}</b>
                  <span>{activeColor.colorCode}</span>
                </div>
              </div>
              <label className="search-box">
                <Search size={18} />
                <input
                  aria-label="Search colours"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search shade name or code"
                />
                {query && (
                  <button
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                  >
                    <X size={15} />
                  </button>
                )}
              </label>
              <div className="palette-filters">
                <select
                  aria-label="Colour family"
                  value={family}
                  onChange={(e) => setFamily(e.target.value)}
                >
                  {families.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
                <span>{palette.length.toLocaleString()} shades</span>
              </div>
              <div
                className="color-list"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40)
                    setVisibleCount((v) => Math.min(v + 64, palette.length));
                }}
              >
                {palette.slice(0, visibleCount).map((c) => (
                  <button
                    key={c.colorCode}
                    title={`${c.colorName} · ${c.colorCode}`}
                    aria-label={`Choose ${c.colorName}`}
                    aria-pressed={
                      (selected?.colorCode ?? color.colorCode) === c.colorCode
                    }
                    disabled={drawing}
                    onClick={() => chooseColor(c)}
                    className={`color-list-item ${(selected?.colorCode ?? color.colorCode) === c.colorCode ? "chosen" : ""}`}
                  >
                    <span
                      className="color-chip"
                      style={{ background: c.colorValue }}
                    />
                    <span className="color-list-copy">
                      <b>{c.colorName}</b>
                      <small>{c.colorCode}</small>
                    </span>
                    {(selected?.colorCode ?? color.colorCode) ===
                      c.colorCode && <Check size={15} />}
                  </button>
                ))}
                {palette.length > visibleCount && (
                  <button
                    className="text-button full-width more-shades"
                    onClick={() => setVisibleCount((v) => v + 64)}
                  >
                    Show more shades
                  </button>
                )}
                {!palette.length && (
                  <div className="no-results">
                    <Search size={22} />
                    <b>No matching shades</b>
                    <p>Try another name, code or colour family.</p>
                  </div>
                )}
              </div>
              {selected?.color && !drawing && (
                <details className="paint-settings">
                  <summary>
                    Paint settings{" "}
                    <span>{Math.round(selected.opacity * 100)}% coverage</span>
                    <ChevronDown size={16} />
                  </summary>
                  <div className="paint-settings-content">
                    <label className="range-control">
                      <span>
                        Paint coverage{" "}
                        <b>{Math.round(selected.opacity * 100)}%</b>
                      </span>
                      <input
                        aria-label="Paint coverage"
                        type="range"
                        onPointerUp={endAdjustment}
                        onPointerCancel={endAdjustment}
                        onKeyUp={endAdjustment}
                        onBlur={endAdjustment}
                        min="25"
                        max="100"
                        value={Math.round(selected.opacity * 100)}
                        onChange={(e) =>
                          setOpacity(Number(e.target.value) / 100)
                        }
                      />
                    </label>
                    <button className="text-button" onClick={clearPaint}>
                      <X size={15} /> Remove paint
                    </button>
                  </div>
                </details>
              )}
              {(!selected || drawing) && (
                <button
                  className="outline-button full-width"
                  onClick={() => setPanel("surfaces")}
                >
                  {drawing ? "Return to surface editing" : "Go to surfaces"}
                </button>
              )}
            </div>
          )}
          <div className="panel-footnote">
            <ShieldCheck size={15} />
            <span>
              {image
                ? `${saveStatus}. Finished surfaces are saved in this browser; unfinished outlines are not.`
                : "Local autosave · Photographs stay on this device."}
            </span>
          </div>
        </aside>
      </main>
      <footer className="footer">
        <span>
          Visualizer <span> / </span> Colour studio
        </span>
      </footer>
      <dialog
        ref={dialogRef}
        className="name-modal"
        onCancel={() => setNaming(false)}
        onClose={() => setNaming(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setNaming(false);
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (selected && name.trim() && name.trim() !== selected.name) {
              beginHistory("Rename surface");
              updateSelections((v) =>
                v.map((s) =>
                  s.id === selected.id
                    ? { ...s, name: name.trim() || s.name }
                    : s,
                ),
              );
            }
            setNaming(false);
          }}
        >
          <div className="modal-heading">
            <h2>Rename surface</h2>
            <button
              type="button"
              aria-label="Close rename dialog"
              onClick={() => setNaming(false)}
            >
              <X size={19} />
            </button>
          </div>
          <label>
            Surface name
            <input
              autoFocus
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Front wall"
            />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setNaming(false)}>
              Cancel
            </button>
            <button className="primary-button" type="submit">
              Save name
            </button>
          </div>
        </form>
      </dialog>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
