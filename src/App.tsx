import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, ChevronRight, ImagePlus, Paintbrush, Palette, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { colors } from './colors';

type Point = { x: number; y: number };
type Selection = { id: number; name: string; path: Path2D; points: Point[]; color: string | null; colorName?: string; colorCode?: string };
type Color = { colorName: string; colorCode: string; colorTone: string; colorValue: string };

function App() {
  const [image, setImage] = useState<string | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [color, setColor] = useState<Color>(colors[0]);
  const [name, setName] = useState('');
  const [naming, setNaming] = useState(false);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = selections.find(item => item.id === selectedId);
  const palette = (colors as Color[]).filter(c => `${c.colorName} ${c.colorCode} ${c.colorTone}`.toLowerCase().includes(query.toLowerCase()));

  const draw = useCallback((ctx: CanvasRenderingContext2D, outlines = true, preview: Point[] = points) => {
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (imageRef.current) ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);
    selections.forEach(s => {
      ctx.save();
      if (s.color) { ctx.fillStyle = s.color.startsWith('rgb(') ? s.color.replace('rgb(', 'rgba(').replace(')', ', 0.48)') : `${s.color}80`; ctx.fill(s.path); }
      if (outlines) { ctx.strokeStyle = s.id === selectedId ? '#b8754e' : 'rgba(255,255,255,.95)'; ctx.lineWidth = s.id === selectedId ? 3 : 2; ctx.setLineDash(s.id === selectedId ? [] : [7, 5]); ctx.stroke(s.path); }
      ctx.restore();
    });
    if (outlines && preview.length) {
      ctx.save(); ctx.beginPath(); ctx.moveTo(preview[0].x, preview[0].y); preview.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = '#b8754e'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
      preview.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#b8754e'; ctx.stroke(); }); ctx.restore();
    }
  }, [points, selectedId, selections]);

  useEffect(() => { const ctx = canvasRef.current?.getContext('2d'); if (ctx) draw(ctx); }, [draw, image]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timer); }, [toast]);

  const upload = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setToast('Choose an image file to get started.'); return; }
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { const canvas = canvasRef.current; if (canvas) { canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; }
      imageRef.current = img; setImage(url); setSelections([]); setPoints([]); setSelectedId(null); setDrawing(false); setToast('Photo added — outline an area to begin.'); };
    img.onerror = () => setToast('This photo could not be opened. Try another file.'); img.src = url;
  };
  const pointFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => { const c = canvasRef.current!; const r = c.getBoundingClientRect(); return { x: (e.clientX-r.left)*c.width/r.width, y: (e.clientY-r.top)*c.height/r.height }; };
  const addPoint = (e: React.MouseEvent<HTMLCanvasElement>) => { if (!drawing) { const p = pointFromEvent(e); const ctx = canvasRef.current?.getContext('2d'); if (ctx) { const hit = [...selections].reverse().find(s => ctx.isPointInPath(s.path, p.x, p.y)); if (hit) setSelectedId(hit.id); } return; } setPoints(v => [...v, pointFromEvent(e)]); };
  const saveArea = () => { if (points.length < 3) return; const path = new Path2D(); path.moveTo(points[0].x, points[0].y); points.slice(1).forEach(p => path.lineTo(p.x,p.y)); path.closePath(); setSelections(v => [...v, { id: Date.now(), name: name.trim() || `Area ${v.length+1}`, path, points, color: null }]); setPoints([]); setName(''); setNaming(false); setDrawing(false); setToast('Area saved. Pick a finish to preview it.'); };
  const apply = () => { if (!selected) return; setSelections(v => v.map(s => s.id === selected.id ? { ...s, color: color.colorValue, colorName: color.colorName, colorCode: color.colorCode } : s)); setToast(`${color.colorName} applied to ${selected.name}.`); };
  const remove = () => { setSelections(v => v.filter(s => s.id !== selectedId)); setSelectedId(null); };
  const exportImage = () => { const c = canvasRef.current; if (!c || !image) return; const out = document.createElement('canvas'); out.width = c.width; out.height = c.height; const ctx = out.getContext('2d'); if (!ctx) return; draw(ctx, false, []); const a = document.createElement('a'); a.download = 'room-preview.png'; a.href = out.toDataURL('image/png'); a.click(); setToast('Your preview is ready to share.'); };

  return <div className="app-shell" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files[0]); }}>
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark"><Palette size={19}/></span><span>hue<span className="brand-light">house</span></span></a><span className="topbar-note">A better way to picture your next color</span><button className="export-button" disabled={!image} onClick={exportImage}><ArrowDownToLine size={16}/> Export preview</button></header>
    <main className="workspace">
      <section className="main-column"><div className="eyebrow">ROOM COLOR STUDIO <span className="eyebrow-line"/></div><h1>See the color<br/><em>before you paint.</em></h1><p className="intro">Try a new look on your own space. Upload a photo, trace a surface, and explore the palette.</p>
        <div className={`canvas-card ${image ? 'has-image' : ''}`}>
          {!image && <div className="upload-empty"><div className="upload-icon"><ImagePlus size={25}/></div><h2>Start with a photo of your space</h2><p>For best results, use a clear, well-lit photo with the surface you want to recolor in view.</p><button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={17}/> Upload a photo</button><span className="file-note">JPG, PNG or WEBP · stored on your device</span><div className="drop-hint">or drop an image anywhere in this area</div></div>}
          <canvas ref={canvasRef} onClick={addPoint} className={image ? (drawing ? 'drawing-canvas' : 'view-canvas') : 'hidden-canvas'} />
          {image && <div className="canvas-caption"><span><span className="live-dot"/>{drawing ? 'Outline mode' : 'Your room'}</span><button onClick={() => fileRef.current?.click()}><RotateCcw size={14}/> Change photo</button></div>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => upload(e.target.files?.[0])}/>
        <div className="steps"><div className="step"><span>01</span><div><b>Add a photo</b><small>Choose your room</small></div></div><ChevronRight size={15}/><div className="step"><span>02</span><div><b>Trace a surface</b><small>Mark the area</small></div></div><ChevronRight size={15}/><div className="step"><span>03</span><div><b>Explore color</b><small>Find your finish</small></div></div></div>
      </section>
      <aside className="side-panel"><div className="panel-heading"><div><span className="panel-kicker">YOUR PROJECT</span><h2>Color your space</h2></div><span className="count-pill">{selections.length} {selections.length === 1 ? 'area' : 'areas'}</span></div>
        <div className="area-section"><div className="section-label">SURFACES <span>{selections.length ? `${selections.length} saved` : 'Optional'}</span></div>
          {selections.length === 0 ? <div className="empty-areas"><div className="empty-area-icon"><Plus size={17}/></div><div><b>No surfaces yet</b><p>{image ? 'Outline a wall, trim, or other surface to get started.' : 'Upload a photo, then trace the areas you want to preview.'}</p></div></div> : <div className="area-list">{selections.map(s => <button key={s.id} className={`area-row ${selectedId===s.id?'active':''}`} onClick={() => setSelectedId(s.id)}><span className="area-swatch" style={{background:s.color || '#eee8e2'}}/><span className="area-text"><b>{s.name}</b><small>{s.colorName || 'Choose a color'}</small></span><span className="area-arrow">{selectedId===s.id?'Selected':'›'}</span></button>)}</div>}
          {image && <div className="area-actions">{drawing ? <><button className="secondary-button" onClick={() => {setDrawing(false);setPoints([]);}}><X size={15}/> Cancel</button><button className="primary-button compact" disabled={points.length<3} onClick={() => setNaming(true)}><Check size={15}/> Finish area{points.length>0?` · ${points.length} points`:''}</button></> : <button className="outline-button" onClick={() => {setDrawing(true);setSelectedId(null);setPoints([]);}}><Plus size={16}/> Trace a new surface</button>}</div>}
          {drawing && <p className="drawing-tip">Click around the surface edge. Add at least 3 points, then finish.</p>}
        </div>
        <div className="palette-section"><div className="section-label">COLOR PALETTE <span>{palette.length} colors</span></div><div className="selected-color"><span className="selected-dot" style={{background:color.colorValue}}/><div><b>{color.colorName}</b><small>{color.colorCode} · {color.colorTone}</small></div><span className="finish-tag">SAMPLE</span></div><label className="search-box"><Palette size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a color or finish"/><kbd>/</kbd></label><div className="swatch-grid">{palette.slice(0, 48).map(c => <button key={c.colorCode} title={`${c.colorName} · ${c.colorCode}`} aria-label={`Choose ${c.colorName}`} onClick={() => setColor(c)} className={`swatch ${color.colorCode===c.colorCode?'chosen':''}`} style={{background:c.colorValue}}>{color.colorCode===c.colorCode&&<Check size={13}/>}</button>)}</div><p className="palette-foot">Showing {Math.min(palette.length,48)} of {palette.length} colors</p>
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
