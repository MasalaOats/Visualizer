import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowDownToLine, Check, ChevronRight, Circle, ImagePlus, Magnet, Paintbrush, Palette, Pencil, Pentagon, Plus, RotateCcw, Square, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import { colors } from './colors';

type Point = { x: number; y: number };
type Tool = 'polygon' | 'ellipse' | 'rectangle' | 'freehand';
type Shape = { path: Path2D; points: Point[]; tool: Tool };
type Selection = { id: number; name: string; shapes: Shape[]; holes: Shape[]; color: string | null; colorName?: string; colorCode?: string; opacity: number };
type Color = { colorName: string; colorCode: string; colorTone: string; colorValue: string };
type EdgeMap = { data: Uint8Array; width: number; height: number; scale: number };

function makeEdgeMap(image: HTMLImageElement): EdgeMap {
  const scale = Math.min(1, 1400 / image.naturalWidth);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { data: new Uint8Array(width*height), width, height, scale };
  ctx.drawImage(image, 0, 0, width, height);
  const rgba = ctx.getImageData(0,0,width,height).data;
  const gray = new Uint8Array(width*height), data = new Uint8Array(width*height);
  for (let i=0,j=0;i<rgba.length;i+=4,j++) gray[j]=(0.299*rgba[i]+0.587*rgba[i+1]+0.114*rgba[i+2]);
  for (let y=1;y<height-1;y++) for (let x=1;x<width-1;x++) {
    const i=y*width+x;
    const gx=-gray[i-width-1]+gray[i-width+1]-2*gray[i-1]+2*gray[i+1]-gray[i+width-1]+gray[i+width+1];
    const gy=-gray[i-width-1]-2*gray[i-width]-gray[i-width+1]+gray[i+width-1]+2*gray[i+width]+gray[i+width+1];
    data[i]=Math.min(255,Math.hypot(gx,gy)/4);
  }
  return { data, width, height, scale };
}

function makePath(tool: Tool, points: Point[]) {
  const path = new Path2D();
  if (tool === 'ellipse' && points.length >= 2) {
    const left = Math.min(points[0].x, points[1].x), top = Math.min(points[0].y, points[1].y);
    path.ellipse(left + Math.abs(points[1].x-points[0].x)/2, top + Math.abs(points[1].y-points[0].y)/2, Math.max(1,Math.abs(points[1].x-points[0].x)/2), Math.max(1,Math.abs(points[1].y-points[0].y)/2), 0, 0, Math.PI*2);
  } else if (tool === 'rectangle' && points.length >= 2) {
    path.rect(Math.min(points[0].x,points[1].x),Math.min(points[0].y,points[1].y),Math.abs(points[1].x-points[0].x),Math.abs(points[1].y-points[0].y));
  } else if (points.length) {
    path.moveTo(points[0].x,points[0].y); points.slice(1).forEach(p=>path.lineTo(p.x,p.y)); path.closePath();
  }
  return path;
}

function makePaintLayer(image: HTMLImageElement, selection: Selection) {
  const allShapes = [...selection.shapes, ...selection.holes];
  const points = allShapes.flatMap(shape => shape.points);
  if (!points.length || !selection.color) return { canvas: document.createElement('canvas'), left: 0, top: 0 };
  const left = Math.max(0, Math.floor(Math.min(...points.map(p => p.x))));
  const top = Math.max(0, Math.floor(Math.min(...points.map(p => p.y))));
  const right = Math.min(image.naturalWidth, Math.ceil(Math.max(...points.map(p => p.x))));
  const bottom = Math.min(image.naturalHeight, Math.ceil(Math.max(...points.map(p => p.y))));
  const width = Math.max(1, right-left), height = Math.max(1, bottom-top);
  const source = document.createElement('canvas'); source.width = width; source.height = height;
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) return { canvas: source, left, top };
  sourceCtx.drawImage(image, left, top, width, height, 0, 0, width, height);
  const pixels = sourceCtx.getImageData(0, 0, width, height);
  const mask = document.createElement('canvas'); mask.width = width; mask.height = height;
  const maskCtx = mask.getContext('2d');
  if (!maskCtx) return { canvas: source, left, top };
  maskCtx.translate(-left, -top); maskCtx.fillStyle = '#fff';
  selection.shapes.forEach(shape => maskCtx.fill(shape.path));
  maskCtx.globalCompositeOperation = 'destination-out'; selection.holes.forEach(shape => maskCtx.fill(shape.path));
  const maskPixels = maskCtx.getImageData(0, 0, width, height).data;
  const rgb = selection.color?.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [128,128,128];
  const output = new Uint8ClampedArray(pixels.data.length);
  let lightTotal=0, coveredPixels=0;
  for (let i=0;i<pixels.data.length;i+=4) if (maskPixels[i+3]) {
    lightTotal += ((0.2126*pixels.data[i]+0.7152*pixels.data[i+1]+0.0722*pixels.data[i+2])/255) * maskPixels[i+3];
    coveredPixels += maskPixels[i+3];
  }
  const averageLight = coveredPixels ? lightTotal/coveredPixels : 0.5;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const coverage = maskPixels[i+3] / 255 * selection.opacity;
    if (!coverage) continue;
    const light = (0.2126*pixels.data[i] + 0.7152*pixels.data[i+1] + 0.0722*pixels.data[i+2]) / 255;
    // Retain only luminance-based light and shadow, never the old surface color.
    const shade = Math.max(0.68, Math.min(1.28, 1 + (light-averageLight)*0.95));
    output[i] = Math.min(255, rgb[0]*shade);
    output[i+1] = Math.min(255, rgb[1]*shade);
    output[i+2] = Math.min(255, rgb[2]*shade);
    output[i+3] = coverage * 255;
  }
  const layer = document.createElement('canvas'); layer.width = width; layer.height = height;
  const layerCtx = layer.getContext('2d');
  if (layerCtx) layerCtx.putImageData(new ImageData(output, width, height), 0, 0);
  return { canvas: layer, left, top };
}

function App() {
  const [image, setImage] = useState<string | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>('polygon');
  const [edgeSnap, setEdgeSnap] = useState(false);
  const [areaMode, setAreaMode] = useState<'new' | 'add' | 'subtract'>('new');
  const [gesture, setGesture] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [color, setColor] = useState<Color>(colors[0]);
  const [name, setName] = useState('');
  const [naming, setNaming] = useState(false);
  const [query, setQuery] = useState('');
  const [exportFormat, setExportFormat] = useState<'png' | 'jpg'>('png');
  const [toast, setToast] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const edgeMapRef = useRef<EdgeMap | null>(null);
  const paintCache = useRef(new Map<number, { key: string; canvas: HTMLCanvasElement; left: number; top: number }>());
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = selections.find(item => item.id === selectedId);
  const palette = (colors as Color[]).filter(c => `${c.colorName} ${c.colorCode} ${c.colorTone}`.toLowerCase().includes(query.toLowerCase()));

  const draw = useCallback((ctx: CanvasRenderingContext2D, outlines = true, preview: Point[] = points) => {
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (imageRef.current) ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);
    selections.forEach(s => {
      ctx.save();
      if (s.color && imageRef.current) {
        const key = `${s.color}:${s.opacity}:${[...s.shapes,...s.holes].map(shape=>shape.points.map(p=>`${p.x},${p.y}`).join(';')).join('|')}`;
        let layer = paintCache.current.get(s.id);
        if (!layer || layer.key !== key) { const result = makePaintLayer(imageRef.current, s); layer = { ...result, key }; paintCache.current.set(s.id, layer); }
        ctx.drawImage(layer.canvas, layer.left, layer.top);
      }
      if (outlines) {
        ctx.strokeStyle = s.id === selectedId ? '#b8754e' : 'rgba(255,255,255,.95)'; ctx.lineWidth = s.id === selectedId ? 3 : 2; ctx.setLineDash(s.id === selectedId ? [] : [7, 5]);
        s.shapes.forEach(shape=>ctx.stroke(shape.path));
        ctx.strokeStyle = '#e05b50'; ctx.setLineDash([4,4]); s.holes.forEach(shape=>ctx.stroke(shape.path));
      }
      ctx.restore();
    });
    if (outlines && preview.length) {
      ctx.save(); ctx.strokeStyle = areaMode === 'subtract' ? '#e05b50' : '#b8754e'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      if (tool === 'polygon' || tool === 'freehand') {
        ctx.beginPath(); ctx.moveTo(preview[0].x, preview[0].y); preview.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke(); ctx.setLineDash([]);
        if (tool === 'polygon') preview.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#b8754e'; ctx.stroke(); });
      } else if (preview.length > 1) ctx.stroke(makePath(tool, preview));
      ctx.restore();
    }
  }, [areaMode, points, selectedId, selections, tool]);

  useEffect(() => { const ctx = canvasRef.current?.getContext('2d'); if (ctx) draw(ctx); }, [draw, image]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timer); }, [toast]);

  const upload = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setToast('Choose an image file to get started.'); return; }
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { const canvas = canvasRef.current; if (canvas) { canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; }
      paintCache.current.clear(); edgeMapRef.current = makeEdgeMap(img); setZoom(1); setPan({ x: 0, y: 0 });
      imageRef.current = img; setImage(url); setSelections([]); setPoints([]); setSelectedId(null); setDrawing(false); setToast('Photo added — outline an area to begin.'); };
    img.onerror = () => setToast('This photo could not be opened. Try another file.'); img.src = url;
  };
  const pointFromEvent = (e: PointerEvent<HTMLCanvasElement>) => { const c = canvasRef.current!; const r = c.getBoundingClientRect(); return { x: (e.clientX-r.left)*c.width/r.width, y: (e.clientY-r.top)*c.height/r.height }; };
  const snapToEdge = (point: Point): Point => {
    const map = edgeMapRef.current, canvas = canvasRef.current;
    if (!edgeSnap || !map || !canvas) return point;
    const scale = map.scale, centerX = Math.round(point.x*scale), centerY = Math.round(point.y*scale);
    const radius = Math.max(3, Math.min(32, 9*(canvas.width/canvas.getBoundingClientRect().width)*scale));
    let best = point, bestScore = 26;
    for (let y=Math.max(1,centerY-radius);y<=Math.min(map.height-2,centerY+radius);y++) for (let x=Math.max(1,centerX-radius);x<=Math.min(map.width-2,centerX+radius);x++) {
      const distance = Math.hypot(x-centerX,y-centerY), edge = map.data[y*map.width+x];
      const score = edge-distance*1.35;
      if (distance<=radius && score>bestScore) { bestScore=score; best={x/scale,y/scale}; }
    }
    return best;
  };
  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = pointFromEvent(e);
    if (!drawing && zoom > 1) { e.currentTarget.setPointerCapture(e.pointerId); setPanStart({ x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }); return; }
    if (!drawing) { const ctx = canvasRef.current?.getContext('2d'); if (ctx) { const hit = [...selections].reverse().find(s => s.shapes.some(shape=>ctx.isPointInPath(shape.path,p.x,p.y)) && !s.holes.some(shape=>ctx.isPointInPath(shape.path,p.x,p.y))); if (hit) setSelectedId(hit.id); } return; }
    if (tool === 'polygon') { setPoints(v => [...v, snapToEdge(p)]); return; }
    e.currentTarget.setPointerCapture(e.pointerId); setGesture(true); setPoints([p]);
  };
  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (panStart) { setPan({ x: panStart.panX + e.clientX - panStart.x, y: panStart.panY + e.clientY - panStart.y }); return; }
    if (!drawing || !gesture) return; const p = pointFromEvent(e);
    setPoints(v => tool === 'freehand' ? [...v,p] : [v[0],p]);
  };
  const handlePointerUp = () => { setGesture(false); setPanStart(null); };
  const changeZoom = (next: number) => { const value = Math.max(1, Math.min(4, next)); setZoom(value); if (value === 1) setPan({ x: 0, y: 0 }); };
  const minimumPoints = tool === 'polygon' || tool === 'freehand' ? 3 : 2;
  const makeCurrentShape = (): Shape => ({ path: makePath(tool, points), points, tool });
  const saveArea = () => { if (points.length < minimumPoints) return; const shape=makeCurrentShape(); setSelections(v => [...v, { id: Date.now(), name: name.trim() || `Area ${v.length+1}`, shapes:[shape], holes:[], color: null, opacity: 1 }]); setPoints([]); setName(''); setNaming(false); setDrawing(false); setAreaMode('new'); setToast('Surface saved. Pick a paint color to preview it.'); };
  const startDrawing = (mode: 'new'|'add'|'subtract') => { setDrawing(true); setAreaMode(mode); setTool('polygon'); setEdgeSnap(false); setGesture(false); setPoints([]); if (mode==='new') setSelectedId(null); };
  const finishDrawing = () => {
    if (points.length < minimumPoints) return;
    if (areaMode === 'new') { setNaming(true); return; }
    if (selectedId === null) return;
    const shape=makeCurrentShape();
    setSelections(v=>v.map(s=>s.id!==selectedId?s:areaMode==='add'?{...s,shapes:[...s.shapes,shape]}:{...s,holes:[...s.holes,shape]}));
    paintCache.current.delete(selectedId); setPoints([]); setDrawing(false); setAreaMode('new'); setToast(areaMode==='add'?'Area added to the paint mask.':'Object cut out of the paint mask.');
  };
  const apply = () => { if (!selected) return; setSelections(v => v.map(s => s.id === selected.id ? { ...s, color: color.colorValue, colorName: color.colorName, colorCode: color.colorCode } : s)); setToast(`${color.colorName} applied to ${selected.name}.`); };
  const setOpacity = (opacity: number) => { if (selected) setSelections(v => v.map(s => s.id === selected.id ? { ...s, opacity } : s)); };
  const remove = () => { setSelections(v => v.filter(s => s.id !== selectedId)); setSelectedId(null); };
  const exportImage = () => { const c = canvasRef.current; if (!c || !image) return; const out = document.createElement('canvas'); out.width = c.width; out.height = c.height; const ctx = out.getContext('2d'); if (!ctx) return; draw(ctx, false, []); const jpg=exportFormat==='jpg'; const a = document.createElement('a'); a.download = `room-preview.${exportFormat}`; a.href = out.toDataURL(jpg?'image/jpeg':'image/png', jpg?0.92:undefined); a.click(); setToast(`Your ${jpg?'JPG':'PNG'} preview is ready to share.`); };

  return <div className="app-shell" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files[0]); }}>
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark"><Palette size={19}/></span><span>hue<span className="brand-light">house</span></span></a><span className="topbar-note">A better way to picture your next color</span><div className="export-controls"><select aria-label="Export format" value={exportFormat} onChange={e=>setExportFormat(e.target.value as 'png'|'jpg')}><option value="png">PNG</option><option value="jpg">JPG</option></select><button className="export-button" disabled={!image} onClick={exportImage}><ArrowDownToLine size={16}/> Export</button></div></header>
    <main className="workspace">
      <section className="main-column"><div className="eyebrow">ROOM COLOR STUDIO <span className="eyebrow-line"/></div><h1>See the color<br/><em>before you paint.</em></h1><p className="intro">Try a new look on your own space. Upload a photo, trace a surface, and explore the palette.</p>
        <div className={`canvas-card ${image ? 'has-image' : ''}`}>
          {!image && <div className="upload-empty"><div className="upload-icon"><ImagePlus size={25}/></div><h2>Start with a photo of your space</h2><p>For best results, use a clear, well-lit photo with the surface you want to recolor in view.</p><button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={17}/> Upload a photo</button><span className="file-note">JPG, PNG or WEBP · stored on your device</span><div className="drop-hint">or drop an image anywhere in this area</div></div>}
          <canvas ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} className={image ? (drawing ? 'drawing-canvas' : zoom > 1 ? 'panning-canvas' : 'view-canvas') : 'hidden-canvas'} />
          {image && <div className="canvas-caption"><span><span className="live-dot"/>{drawing ? 'Outline mode' : zoom > 1 ? 'Drag image to pan' : 'Your room'}</span><div className="canvas-tools"><button aria-label="Zoom out" title="Zoom out" disabled={zoom<=1} onClick={()=>changeZoom(zoom-.25)}><ZoomOut size={14}/></button><span>{Math.round(zoom*100)}%</span><button aria-label="Zoom in" title="Zoom in" disabled={zoom>=4} onClick={()=>changeZoom(zoom+.25)}><ZoomIn size={14}/></button><button onClick={()=>changeZoom(1)}>Fit</button><button onClick={() => fileRef.current?.click()}><RotateCcw size={14}/> Change photo</button></div></div>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => upload(e.target.files?.[0])}/>
        <div className="steps"><div className="step"><span>01</span><div><b>Add a photo</b><small>Choose your room</small></div></div><ChevronRight size={15}/><div className="step"><span>02</span><div><b>Trace a surface</b><small>Mark the area</small></div></div><ChevronRight size={15}/><div className="step"><span>03</span><div><b>Explore color</b><small>Find your finish</small></div></div></div>
      </section>
      <aside className="side-panel"><div className="panel-heading"><div><span className="panel-kicker">YOUR PROJECT</span><h2>Color your space</h2></div><span className="count-pill">{selections.length} {selections.length === 1 ? 'area' : 'areas'}</span></div>
        <div className="area-section"><div className="section-label">SURFACES <span>{selections.length ? `${selections.length} saved` : 'Optional'}</span></div>
          {selections.length === 0 ? <div className="empty-areas"><div className="empty-area-icon"><Plus size={17}/></div><div><b>No surfaces yet</b><p>{image ? 'Outline a wall, trim, or other surface to get started.' : 'Upload a photo, then trace the areas you want to preview.'}</p></div></div> : <div className="area-list">{selections.map(s => <button key={s.id} className={`area-row ${selectedId===s.id?'active':''}`} onClick={() => setSelectedId(s.id)}><span className="area-swatch" style={{background:s.color || '#eee8e2'}}/><span className="area-text"><b>{s.name}</b><small>{s.colorName || 'Choose a color'}</small></span><span className="area-arrow">{selectedId===s.id?'Selected':'›'}</span></button>)}</div>}
          {image && <div className={`area-actions ${drawing?'drawing-actions':'mask-actions'}`}>{drawing ? <><button className="secondary-button" onClick={() => {setDrawing(false);setGesture(false);setPoints([]);setAreaMode('new');}}><X size={15}/> Cancel</button><button className="primary-button compact" disabled={points.length<minimumPoints} onClick={finishDrawing}><Check size={15}/> {areaMode==='new'?'Finish area':'Finish mask'}</button></> : <><button className="outline-button" onClick={() => startDrawing('new')}><Plus size={16}/> Add a surface</button>{selected && <><button className="mask-action" onClick={() => startDrawing('add')}><Plus size={13}/> Add to mask</button><button className="mask-action subtract" onClick={() => startDrawing('subtract')}><X size={13}/> Cut object out</button></>}</>}</div>}
          {drawing && <><div className="tool-picker" aria-label="Surface drawing tools">
            <button className={tool==='polygon'?'active':''} onClick={()=>{setTool('polygon');setGesture(false);setPoints([]);}}><Pentagon size={15}/> Point trace</button>
            <button className={tool==='freehand'?'active':''} onClick={()=>{setTool('freehand');setGesture(false);setPoints([]);}}><Pencil size={15}/> Freehand</button>
            <button className={tool==='rectangle'?'active':''} onClick={()=>{setTool('rectangle');setGesture(false);setPoints([]);}}><Square size={15}/> Rectangle</button>
            <button className={tool==='ellipse'?'active':''} onClick={()=>{setTool('ellipse');setGesture(false);setPoints([]);}}><Circle size={15}/> Oval</button>
          </div>{tool==='polygon' && <button className={`edge-snap ${edgeSnap?'active':''}`} onClick={()=>setEdgeSnap(v=>!v)}><Magnet size={13}/>{edgeSnap?'Edge snap on':'Snap clicks to edges'}</button>}<p className="drawing-tip">{areaMode==='subtract'?'Trace around the window, furniture, or object to keep paint off it.':areaMode==='add'?'Trace another surface patch to include in the same paint mask.':tool==='polygon'?'Click around the edge; use edge snap for sharper boundaries.':tool==='freehand'?'Press and drag around the surface edge, then release.':'Click and drag to fit the shape to the surface.'}</p></>}
        </div>
        <div className="palette-section"><div className="section-label">COLOR PALETTE <span>{palette.length} colors</span></div><div className="selected-color"><span className="selected-dot" style={{background:color.colorValue}}/><div><b>{color.colorName}</b><small>{color.colorCode} · {color.colorTone}</small></div><span className="finish-tag">SAMPLE</span></div><label className="search-box"><Palette size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a color or finish"/><kbd>/</kbd></label><div className="swatch-grid">{palette.slice(0, 32).map(c => <button key={c.colorCode} title={`${c.colorName} · ${c.colorCode}`} aria-label={`Choose ${c.colorName}`} onClick={() => setColor(c)} className={`swatch ${color.colorCode===c.colorCode?'chosen':''}`} style={{background:c.colorValue}}>{color.colorCode===c.colorCode&&<Check size={13}/>}</button>)}</div><p className="palette-foot">Showing {Math.min(palette.length,32)} of {palette.length} colors</p>
          {selected && <label className="opacity-control"><span>Paint coverage <b>{Math.round(selected.opacity*100)}%</b></span><input aria-label="Paint coverage" type="range" min="25" max="100" value={Math.round(selected.opacity*100)} onChange={e=>setOpacity(Number(e.target.value)/100)}/><small>At 100%, paint covers the old color while keeping the photo’s lighting and texture.</small></label>}
          <button className="apply-button" disabled={!selected} onClick={apply}><Paintbrush size={16}/>{selected ? `Preview on ${selected.name}` : 'Select a surface to preview'}</button>{selected && <button className="delete-link" onClick={remove}><Trash2 size={13}/> Remove {selected.name}</button>}
        </div><div className="privacy-note"><span>✳</span><p>Your photo stays on this device. We never upload or store your images.</p></div>
      </aside>
    </main>
    <footer className="footer"><span>huehouse <span>·</span> Make room for color.</span><span>Made for the home you love</span></footer>
    {naming && <div className="modal-backdrop" onMouseDown={e => {if(e.target===e.currentTarget)setNaming(false);}}><form className="name-modal" onSubmit={e => {e.preventDefault();saveArea();}}><button type="button" className="modal-close" onClick={() => setNaming(false)}><X size={18}/></button><span className="panel-kicker">NEW SURFACE</span><h2>Name this area</h2><p>Give your surface a name so you can keep track of your color ideas.</p><input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Living room wall"/><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setNaming(false)}>Cancel</button><button className="primary-button compact" type="submit"><Check size={15}/> Save surface</button></div></form></div>}
    {toast && <div className="toast"><Check size={15}/>{toast}</div>}
  </div>;
}

export default App;
