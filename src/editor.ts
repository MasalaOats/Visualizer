export type Point = {
  x: number;
  y: number;
  inHandle?: Point;
  outHandle?: Point;
};
export type Tool = "polygon" | "freehand" | "wand";
export type MaskEditMode =
  | "select"
  | "add"
  | "erase"
  | "trace-add"
  | "trace-erase";
export type Shape = { path: Path2D; points: Point[]; tool: Tool };
export type MaskShape = Shape & {
  maskCanvas: HTMLCanvasElement;
  left: number;
  top: number;
  scale: number;
  maskId: number;
};
export type SurfacePart = Shape | MaskShape;
export type Selection = {
  id: number;
  name: string;
  shapes: SurfacePart[];
  holes: SurfacePart[];
  color: string | null;
  colorName?: string;
  colorCode?: string;
  opacity: number;
  /** 0 = flat paint, 1 = full photo shading. Missing values use the default. */
  lighting?: number;
  /** Per-face brightness adjustment in percent (-40 to 40). */
  brightness?: number;
  mergedFrom?: Selection[];
};
export type Color = {
  colorName: string;
  colorCode: string;
  colorTone: string;
  colorValue: string;
};
export type EdgeMap = {
  data: Uint8Array;
  width: number;
  height: number;
  scale: number;
};
export type ColorMap = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  scale: number;
};

export function makeEdgeMap(image: HTMLImageElement): EdgeMap {
  const scale = Math.min(
    1,
    1400 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx)
    return { data: new Uint8Array(width * height), width, height, scale };
  ctx.drawImage(image, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height),
    data = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++)
    gray[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -gray[i - width - 1] +
        gray[i - width + 1] -
        2 * gray[i - 1] +
        2 * gray[i + 1] -
        gray[i + width - 1] +
        gray[i + width + 1];
      const gy =
        -gray[i - width - 1] -
        2 * gray[i - width] -
        gray[i - width + 1] +
        gray[i + width - 1] +
        2 * gray[i + width] +
        gray[i + width + 1];
      data[i] = Math.min(255, Math.hypot(gx, gy) / 4);
    }
  return { data, width, height, scale };
}

export function makeColorMap(image: HTMLImageElement): ColorMap {
  const scale = Math.min(
      1,
      1600 / Math.max(image.naturalWidth, image.naturalHeight),
    ),
    width = Math.max(1, Math.round(image.naturalWidth * scale)),
    height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx)
    return {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      scale,
    };
  ctx.drawImage(image, 0, 0, width, height);
  return {
    data: ctx.getImageData(0, 0, width, height).data,
    width,
    height,
    scale,
  };
}

export function makeColorMask(
  map: ColorMap,
  point: Point,
  tolerance: number,
  scope: "connected" | "image",
): MaskShape | null {
  const sx = Math.max(
      0,
      Math.min(map.width - 1, Math.floor(point.x * map.scale)),
    ),
    sy = Math.max(0, Math.min(map.height - 1, Math.floor(point.y * map.scale))),
    seed = (sy * map.width + sx) * 4;
  const r = map.data[seed],
    g = map.data[seed + 1],
    b = map.data[seed + 2],
    limit = tolerance * tolerance * 3,
    total = map.width * map.height;
  const queue = new Int32Array(total);
  let write = 0,
    minX = map.width,
    minY = map.height,
    maxX = -1,
    maxY = -1;
  const matches = (at: number) => {
    const i = at * 4,
      dr = map.data[i] - r,
      dg = map.data[i + 1] - g,
      db = map.data[i + 2] - b;
    return dr * dr + dg * dg + db * db <= limit;
  };
  if (scope === "image") {
    for (let at = 0; at < total; at++)
      if (matches(at)) {
        queue[write++] = at;
        const x = at % map.width,
          y = Math.floor(at / map.width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
  } else {
    const seen = new Uint8Array(total),
      stack = new Int32Array(total);
    let stackSize = 0;
    stack[stackSize++] = sy * map.width + sx;
    seen[sy * map.width + sx] = 1;
    const visit = (next: number, x: number) => {
      if (
        next < 0 ||
        next >= total ||
        seen[next] ||
        Math.abs((next % map.width) - x) > 1
      )
        return;
      seen[next] = 1;
      stack[stackSize++] = next;
    };
    while (stackSize) {
      const at = stack[--stackSize],
        x = at % map.width,
        y = Math.floor(at / map.width);
      if (!matches(at)) continue;
      queue[write++] = at;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      visit(at - 1, x);
      visit(at + 1, x);
      visit(at - map.width, x);
      visit(at + map.width, x);
    }
  }
  if (!write) return null;
  const padding = 2,
    leftPx = Math.max(0, minX - padding),
    topPx = Math.max(0, minY - padding),
    rightPx = Math.min(map.width - 1, maxX + padding),
    bottomPx = Math.min(map.height - 1, maxY + padding);
  const canvas = document.createElement("canvas");
  canvas.width = rightPx - leftPx + 1;
  canvas.height = bottomPx - topPx + 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  for (let n = 0; n < write; n++) {
    const index = queue[n],
      x = (index % map.width) - leftPx,
      y = Math.floor(index / map.width) - topPx,
      at = (y * canvas.width + x) * 4;
    imageData.data[at] = 255;
    imageData.data[at + 1] = 255;
    imageData.data[at + 2] = 255;
    imageData.data[at + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  const softened = document.createElement("canvas");
  softened.width = canvas.width;
  softened.height = canvas.height;
  const softCtx = softened.getContext("2d");
  if (softCtx) {
    softCtx.filter = "blur(0.7px)";
    softCtx.drawImage(canvas, 0, 0);
  }
  return {
    path: new Path2D(),
    points: [],
    tool: "wand",
    maskCanvas: softened,
    left: leftPx / map.scale,
    top: topPx / map.scale,
    scale: map.scale,
    maskId: Date.now() + Math.random(),
  };
}

export function paintMaskBrush(
  shape: MaskShape,
  point: Point,
  mode: "add" | "erase",
  radius: number,
  imageWidth: number,
  imageHeight: number,
): MaskShape {
  const currentRight = shape.left + shape.maskCanvas.width / shape.scale,
    currentBottom = shape.top + shape.maskCanvas.height / shape.scale;
  if (
    point.x - radius >= shape.left &&
    point.y - radius >= shape.top &&
    point.x + radius <= currentRight &&
    point.y + radius <= currentBottom
  ) {
    const current = shape.maskCanvas.getContext("2d");
    if (current) {
      current.globalCompositeOperation =
        mode === "erase" ? "destination-out" : "source-over";
      current.fillStyle = "#fff";
      current.beginPath();
      current.arc(
        (point.x - shape.left) * shape.scale,
        (point.y - shape.top) * shape.scale,
        radius * shape.scale,
        0,
        Math.PI * 2,
      );
      current.fill();
      current.globalCompositeOperation = "source-over";
      return { ...shape, maskId: Date.now() + Math.random() };
    }
  }
  const left = Math.max(0, Math.min(shape.left, point.x - radius)),
    top = Math.max(0, Math.min(shape.top, point.y - radius));
  const right = Math.min(
      imageWidth,
      Math.max(
        shape.left + shape.maskCanvas.width / shape.scale,
        point.x + radius,
      ),
    ),
    bottom = Math.min(
      imageHeight,
      Math.max(
        shape.top + shape.maskCanvas.height / shape.scale,
        point.y + radius,
      ),
    );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil((right - left) * shape.scale));
  canvas.height = Math.max(1, Math.ceil((bottom - top) * shape.scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return shape;
  ctx.drawImage(
    shape.maskCanvas,
    (shape.left - left) * shape.scale,
    (shape.top - top) * shape.scale,
  );
  ctx.globalCompositeOperation =
    mode === "erase" ? "destination-out" : "source-over";
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(
    (point.x - left) * shape.scale,
    (point.y - top) * shape.scale,
    radius * shape.scale,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  return {
    ...shape,
    maskCanvas: canvas,
    left,
    top,
    maskId: Date.now() + Math.random(),
  };
}

export function editMaskWithPath(
  shape: MaskShape,
  path: Path2D,
  points: Point[],
  mode: "add" | "erase",
  imageWidth: number,
  imageHeight: number,
): MaskShape | null {
  const bounds = pointBounds(points),
    scale = shape.scale;
  const minX = Math.max(0, Math.floor(bounds.left)),
    minY = Math.max(0, Math.floor(bounds.top));
  const maxX = Math.min(imageWidth, Math.ceil(bounds.right)),
    maxY = Math.min(imageHeight, Math.ceil(bounds.bottom));
  const left = mode === "add" ? Math.min(shape.left, minX) : shape.left,
    top = mode === "add" ? Math.min(shape.top, minY) : shape.top;
  const right =
      mode === "add"
        ? Math.max(shape.left + shape.maskCanvas.width / scale, maxX)
        : shape.left + shape.maskCanvas.width / scale,
    bottom =
      mode === "add"
        ? Math.max(shape.top + shape.maskCanvas.height / scale, maxY)
        : shape.top + shape.maskCanvas.height / scale;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil((right - left) * scale));
  canvas.height = Math.max(1, Math.ceil((bottom - top) * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return shape;
  ctx.drawImage(
    shape.maskCanvas,
    (shape.left - left) * scale,
    (shape.top - top) * scale,
  );
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
  ctx.globalCompositeOperation =
    mode === "erase" ? "destination-out" : "source-over";
  ctx.fillStyle = "#fff";
  ctx.fill(path);
  ctx.restore();
  const alpha = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let remains = false;
  for (let i = 3; i < alpha.length; i += 4)
    if (alpha[i]) {
      remains = true;
      break;
    }
  if (!remains) return null;
  return {
    ...shape,
    maskCanvas: canvas,
    left,
    top,
    maskId: Date.now() + Math.random(),
  };
}

export function tintMask(shape: MaskShape, color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = shape.maskCanvas.width;
  canvas.height = shape.maskCanvas.height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(shape.maskCanvas, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

export function colorFamily(color: Color) {
  const rgb = color.colorValue
    .match(/\d+(?:\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number);
  if (!rgb) return "Neutrals";
  const [r, g, b] = rgb.map((v) => v / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min,
    light = (max + min) / 2,
    sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  if (light > 0.9 && sat < 0.3) return "Whites";
  if (sat < 0.12) {
    if (light > 0.84) return "Whites";
    if (light < 0.2) return "Blacks";
    return "Neutrals";
  }
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  if (hue < 15 || hue >= 345) return "Reds";
  if (hue < 45) return "Oranges";
  if (hue < 70) return "Yellows";
  if (hue < 165) return "Greens";
  if (hue < 200) return "Cyans";
  if (hue < 260) return "Blues";
  if (hue < 290) return "Purples";
  return "Pinks";
}

export function containsPart(
  ctx: CanvasRenderingContext2D,
  shape: SurfacePart,
  point: Point,
) {
  if (!("maskCanvas" in shape))
    return ctx.isPointInPath(shape.path, point.x, point.y);
  const x = Math.floor((point.x - shape.left) * shape.scale),
    y = Math.floor((point.y - shape.top) * shape.scale);
  if (
    x < 0 ||
    y < 0 ||
    x >= shape.maskCanvas.width ||
    y >= shape.maskCanvas.height
  )
    return false;
  return !!shape.maskCanvas.getContext("2d")?.getImageData(x, y, 1, 1).data[3];
}

export function makePath(points: Point[], close = true) {
  const path = new Path2D();
  if (points.length) {
    path.moveTo(points[0].x, points[0].y);
    const segmentCount = close ? points.length : points.length - 1;
    for (let i = 0; i < segmentCount; i++) {
      const j = (i + 1) % points.length,
        start = points[i],
        end = points[j];
      if (!start.outHandle && !end.inHandle) {
        path.lineTo(end.x, end.y);
        continue;
      }
      const out = start.outHandle ?? start,
        incoming = end.inHandle ?? end;
      path.bezierCurveTo(out.x, out.y, incoming.x, incoming.y, end.x, end.y);
    }
    if (close) path.closePath();
  }
  return path;
}

export const DEFAULT_LIGHTING = 0.85;

// Brightness is a manual wall-face adjustment; it does not infer 3D geometry.
export function paintLighting(selection: Selection) {
  const lighting = selection.lighting ?? DEFAULT_LIGHTING;
  const brightness = selection.brightness ?? 0;
  return {
    lighting: Number.isFinite(lighting)
      ? Math.max(0, Math.min(1, lighting))
      : DEFAULT_LIGHTING,
    brightness: Number.isFinite(brightness)
      ? Math.max(-40, Math.min(40, brightness))
      : 0,
  };
}

export function makePaintLayer(image: HTMLImageElement, selection: Selection) {
  const allShapes = [...selection.shapes, ...selection.holes];
  if (!allShapes.length || !selection.color)
    return { canvas: document.createElement("canvas"), left: 0, top: 0 };
  const bounds = allShapes.map((shape) =>
    "maskCanvas" in shape
      ? {
          left: shape.left,
          top: shape.top,
          right: shape.left + shape.maskCanvas.width / shape.scale,
          bottom: shape.top + shape.maskCanvas.height / shape.scale,
        }
      : pointBounds(shape.points),
  );
  const left = Math.max(0, Math.floor(Math.min(...bounds.map((b) => b.left))));
  const top = Math.max(0, Math.floor(Math.min(...bounds.map((b) => b.top))));
  const right = Math.min(
    image.naturalWidth,
    Math.ceil(Math.max(...bounds.map((b) => b.right))),
  );
  const bottom = Math.min(
    image.naturalHeight,
    Math.ceil(Math.max(...bounds.map((b) => b.bottom))),
  );
  const width = Math.max(1, right - left),
    height = Math.max(1, bottom - top);
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) return { canvas: source, left, top };
  sourceCtx.drawImage(image, left, top, width, height, 0, 0, width, height);
  const pixels = sourceCtx.getImageData(0, 0, width, height);
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const maskCtx = mask.getContext("2d");
  if (!maskCtx) return { canvas: source, left, top };
  maskCtx.translate(-left, -top);
  maskCtx.fillStyle = "#fff";
  selection.shapes.forEach((shape) =>
    "maskCanvas" in shape
      ? maskCtx.drawImage(
          shape.maskCanvas,
          shape.left,
          shape.top,
          shape.maskCanvas.width / shape.scale,
          shape.maskCanvas.height / shape.scale,
        )
      : maskCtx.fill(shape.path),
  );
  maskCtx.globalCompositeOperation = "destination-out";
  selection.holes.forEach((shape) =>
    "maskCanvas" in shape
      ? maskCtx.drawImage(
          shape.maskCanvas,
          shape.left,
          shape.top,
          shape.maskCanvas.width / shape.scale,
          shape.maskCanvas.height / shape.scale,
        )
      : maskCtx.fill(shape.path),
  );
  const maskPixels = maskCtx.getImageData(0, 0, width, height).data;
  const rgb = selection.color
    ?.match(/\d+(?:\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number) ?? [128, 128, 128];
  const { lighting, brightness } = paintLighting(selection);
  const luminance = (i: number) =>
    0.2126 * pixels.data[i] +
    0.7152 * pixels.data[i + 1] +
    0.0722 * pixels.data[i + 2];
  // Estimate a lit patch from selected pixels only. Normalising against it
  // removes the old paint's overall darkness while retaining local shadows,
  // ledges and texture. Holes/background must not influence this reference.
  const histogram = new Float64Array(256);
  const lightTotals = new Float64Array(256);
  let weight = 0;
  if (lighting > 0) {
    for (let i = 0; i < pixels.data.length; i += 4) {
      const alpha = maskPixels[i + 3] / 255;
      if (!alpha) continue;
      const light = luminance(i);
      const bin = Math.round(light);
      histogram[bin] += alpha;
      lightTotals[bin] += light * alpha;
      weight += alpha;
    }
  }
  let reference = 255;
  if (weight > 0) {
    let cumulative = 0;
    for (let level = 0; level < histogram.length; level++) {
      cumulative += histogram[level];
      if (cumulative >= weight * 0.8) {
        reference = lightTotals[level] / histogram[level];
        break;
      }
    }
  }
  const output = new Uint8ClampedArray(pixels.data.length);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const coverage = (maskPixels[i + 3] / 255) * selection.opacity;
    if (!coverage) continue;
    // Keep source hue out of opaque paint. Only scalar light variation is
    // transferred; the offset avoids amplifying noise in very dark photos.
    const relativeLight = Math.max(
      0.15,
      Math.min(1.15, (luminance(i) + 16) / (reference + 16)),
    );
    const shade = (1 + lighting * (relativeLight - 1)) * (1 + brightness / 100);
    output[i] = Math.min(255, rgb[0] * shade);
    output[i + 1] = Math.min(255, rgb[1] * shade);
    output[i + 2] = Math.min(255, rgb[2] * shade);
    output[i + 3] = coverage * 255;
  }
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const layerCtx = layer.getContext("2d");
  if (layerCtx)
    layerCtx.putImageData(new ImageData(output, width, height), 0, 0);
  return { canvas: layer, left, top };
}

// A cubic Bezier stays inside the convex hull of its endpoints and controls.
export function pointBounds(points: Point[]) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const point of points) {
    for (const p of [point, point.inHandle, point.outHandle]) {
      if (!p) continue;
      left = Math.min(left, p.x);
      top = Math.min(top, p.y);
      right = Math.max(right, p.x);
      bottom = Math.max(bottom, p.y);
    }
  }
  return { left, top, right, bottom };
}

export function cloneMask(shape: MaskShape): MaskShape {
  const canvas = document.createElement("canvas");
  canvas.width = shape.maskCanvas.width;
  canvas.height = shape.maskCanvas.height;
  canvas.getContext("2d")!.drawImage(shape.maskCanvas, 0, 0);
  return { ...shape, maskCanvas: canvas, maskId: Date.now() + Math.random() };
}

export function paintKey(selection: Selection) {
  const key = (shape: SurfacePart) =>
    "maskCanvas" in shape
      ? `mask-${shape.maskId}`
      : JSON.stringify(shape.points);
  return JSON.stringify([
    selection.color,
    selection.opacity,
    paintLighting(selection),
    selection.shapes.map(key),
    selection.holes.map(key),
  ]);
}
