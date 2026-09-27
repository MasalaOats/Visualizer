import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowDownToLine, Check, ChevronDown, ImagePlus, Magnet, Paintbrush, Palette, Pencil, Plus, Redo2, RotateCcw, Undo2, Upload, Wand2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { colors } from './colors';

type Point = { x: number; y: number; inHandle?: Point; outHandle?: Point };
type CurveDrag = { index: number; start: Point; mode: 'anchor'|'segment' };
type Tool = 'polygon' | 'freehand' | 'wand';
type MaskEditMode = 'select'|'add'|'erase'|'trace-add'|'trace-erase';
type Shape = { path: Path2D; points: Point[]; tool: Tool };
type MaskShape = Shape & { maskCanvas: HTMLCanvasElement; left: number; top: number; scale: number; maskId: number };
type SurfacePart = Shape | MaskShape;
type Selection = { id: number; name: string; shapes: SurfacePart[]; holes: SurfacePart[]; color: string | null; colorName?: string; colorCode?: string; opacity: number; mergedFrom?: Selection[] };
type Color = { colorName: string; colorCode: string; colorTone: string; colorValue: string };
type EdgeMap = { data: Uint8Array; width: number; height: number; scale: number };
type ColorMap = { data: Uint8ClampedArray; width: number; height: number; scale: number };

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

function makeColorMap(image: HTMLImageElement): ColorMap {
  const scale=Math.min(1,1600/image.naturalWidth),width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)return{data:new Uint8ClampedArray(width*height*4),width,height,scale};
  ctx.drawImage(image,0,0,width,height);return{data:ctx.getImageData(0,0,width,height).data,width,height,scale};
}

function makeColorMask(map: ColorMap, point: Point, tolerance: number, scope: 'connected' | 'image'): MaskShape | null {
  const sx=Math.max(0,Math.min(map.width-1,Math.floor(point.x*map.scale))),sy=Math.max(0,Math.min(map.height-1,Math.floor(point.y*map.scale))),seed=(sy*map.width+sx)*4;
  const r=map.data[seed],g=map.data[seed+1],b=map.data[seed+2],limit=tolerance*tolerance*3,total=map.width*map.height;
  const queue=new Int32Array(total);let write=0,minX=map.width,minY=map.height,maxX=-1,maxY=-1;
  const matches=(at:number)=>{const i=at*4,dr=map.data[i]-r,dg=map.data[i+1]-g,db=map.data[i+2]-b;return dr*dr+dg*dg+db*db<=limit;};
  if(scope==='image') {
    for(let at=0;at<total;at++) if(matches(at)) { queue[write++]=at;const x=at%map.width,y=Math.floor(at/map.width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); }
  } else {
    const seen=new Uint8Array(total),stack=new Int32Array(total);let stackSize=0;stack[stackSize++]=sy*map.width+sx;seen[sy*map.width+sx]=1;
    const visit=(next:number,x:number)=>{if(next<0||next>=total||seen[next]||Math.abs(next%map.width-x)>1)return;seen[next]=1;stack[stackSize++]=next;};
    while(stackSize){const at=stack[--stackSize],x=at%map.width,y=Math.floor(at/map.width);if(!matches(at))continue;queue[write++]=at;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);visit(at-1,x);visit(at+1,x);visit(at-map.width,x);visit(at+map.width,x);}
  }
  if(!write)return null;
  const padding=2,leftPx=Math.max(0,minX-padding),topPx=Math.max(0,minY-padding),rightPx=Math.min(map.width-1,maxX+padding),bottomPx=Math.min(map.height-1,maxY+padding);
  const canvas=document.createElement('canvas');canvas.width=rightPx-leftPx+1;canvas.height=bottomPx-topPx+1;
  const ctx=canvas.getContext('2d');if(!ctx)return null;const imageData=ctx.createImageData(canvas.width,canvas.height);
  for(let n=0;n<write;n++){const index=queue[n],x=index%map.width-leftPx,y=Math.floor(index/map.width)-topPx,at=(y*canvas.width+x)*4;imageData.data[at]=255;imageData.data[at+1]=255;imageData.data[at+2]=255;imageData.data[at+3]=255;}
  ctx.putImageData(imageData,0,0);
  const softened=document.createElement('canvas');softened.width=canvas.width;softened.height=canvas.height;
  const softCtx=softened.getContext('2d');if(softCtx){softCtx.filter='blur(0.7px)';softCtx.drawImage(canvas,0,0);}
  return{path:new Path2D(),points:[],tool:'wand',maskCanvas:softened,left:leftPx/map.scale,top:topPx/map.scale,scale:map.scale,maskId:Date.now()+Math.random()};
}

function paintMaskBrush(shape:MaskShape,point:Point,mode:'add'|'erase',radius:number,imageWidth:number,imageHeight:number):MaskShape {
  const currentRight=shape.left+shape.maskCanvas.width/shape.scale,currentBottom=shape.top+shape.maskCanvas.height/shape.scale;
  if(point.x-radius>=shape.left&&point.y-radius>=shape.top&&point.x+radius<=currentRight&&point.y+radius<=currentBottom){const current=shape.maskCanvas.getContext('2d');if(current){current.globalCompositeOperation=mode==='erase'?'destination-out':'source-over';current.fillStyle='#fff';current.beginPath();current.arc((point.x-shape.left)*shape.scale,(point.y-shape.top)*shape.scale,radius*shape.scale,0,Math.PI*2);current.fill();current.globalCompositeOperation='source-over';return{...shape,maskId:Date.now()+Math.random()};}}
  const left=Math.max(0,Math.min(shape.left,point.x-radius)),top=Math.max(0,Math.min(shape.top,point.y-radius));
  const right=Math.min(imageWidth,Math.max(shape.left+shape.maskCanvas.width/shape.scale,point.x+radius)),bottom=Math.min(imageHeight,Math.max(shape.top+shape.maskCanvas.height/shape.scale,point.y+radius));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil((right-left)*shape.scale));canvas.height=Math.max(1,Math.ceil((bottom-top)*shape.scale));
  const ctx=canvas.getContext('2d');if(!ctx)return shape;
  ctx.drawImage(shape.maskCanvas,(shape.left-left)*shape.scale,(shape.top-top)*shape.scale);
  ctx.globalCompositeOperation=mode==='erase'?'destination-out':'source-over';ctx.fillStyle='#fff';ctx.beginPath();ctx.arc((point.x-left)*shape.scale,(point.y-top)*shape.scale,radius*shape.scale,0,Math.PI*2);ctx.fill();
  return{...shape,maskCanvas:canvas,left,top,maskId:Date.now()+Math.random()};
}

function editMaskWithPath(shape:MaskShape,path:Path2D,points:Point[],mode:'add'|'erase',imageWidth:number,imageHeight:number):MaskShape|null {
  const scale=shape.scale,minX=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))),minY=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))),maxX=Math.min(imageWidth,Math.ceil(Math.max(...points.map(p=>p.x)))),maxY=Math.min(imageHeight,Math.ceil(Math.max(...points.map(p=>p.y))));
  const left=mode==='add'?Math.min(shape.left,minX):shape.left,top=mode==='add'?Math.min(shape.top,minY):shape.top;
  const right=mode==='add'?Math.max(shape.left+shape.maskCanvas.width/scale,maxX):shape.left+shape.maskCanvas.width/scale,bottom=mode==='add'?Math.max(shape.top+shape.maskCanvas.height/scale,maxY):shape.top+shape.maskCanvas.height/scale;
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil((right-left)*scale));canvas.height=Math.max(1,Math.ceil((bottom-top)*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return shape;
  ctx.drawImage(shape.maskCanvas,(shape.left-left)*scale,(shape.top-top)*scale);
  ctx.save();ctx.setTransform(scale,0,0,scale,-left*scale,-top*scale);ctx.globalCompositeOperation=mode==='erase'?'destination-out':'source-over';ctx.fillStyle='#fff';ctx.fill(path);ctx.restore();
  const alpha=ctx.getImageData(0,0,canvas.width,canvas.height).data;let remains=false;for(let i=3;i<alpha.length;i+=4)if(alpha[i]){remains=true;break;}
  if(!remains)return null;
  return{...shape,maskCanvas:canvas,left,top,maskId:Date.now()+Math.random()};
}

function tintMask(shape:MaskShape,color:string):HTMLCanvasElement {
  const canvas=document.createElement('canvas');canvas.width=shape.maskCanvas.width;canvas.height=shape.maskCanvas.height;
  const ctx=canvas.getContext('2d');if(ctx){ctx.drawImage(shape.maskCanvas,0,0);ctx.globalCompositeOperation='source-in';ctx.fillStyle=color;ctx.fillRect(0,0,canvas.width,canvas.height);}
  return canvas;
}

function colorFamily(color: Color) {
  const rgb=color.colorValue.match(/\d+(?:\.\d+)?/g)?.slice(0,3).map(Number);if(!rgb)return'Neutrals';
  const [r,g,b]=rgb.map(v=>v/255),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,light=(max+min)/2,sat=delta===0?0:delta/(1-Math.abs(2*light-1));
  if(light>0.9&&sat<0.3)return'Whites';
  if(sat<0.12){if(light>0.84)return'Whites';if(light<0.2)return'Blacks';return'Neutrals';}
  let hue=0;if(delta){if(max===r)hue=60*(((g-b)/delta)%6);else if(max===g)hue=60*((b-r)/delta+2);else hue=60*((r-g)/delta+4);}if(hue<0)hue+=360;
  if(hue<15||hue>=345)return'Reds';if(hue<45)return'Oranges';if(hue<70)return'Yellows';if(hue<165)return'Greens';if(hue<200)return'Cyans';if(hue<260)return'Blues';if(hue<290)return'Purples';return'Pinks';
}

function containsPart(ctx: CanvasRenderingContext2D, shape: SurfacePart, point: Point) {
  if (!('maskCanvas' in shape)) return ctx.isPointInPath(shape.path,point.x,point.y);
  const x=Math.floor((point.x-shape.left)*shape.scale),y=Math.floor((point.y-shape.top)*shape.scale);
  if(x<0||y<0||x>=shape.maskCanvas.width||y>=shape.maskCanvas.height)return false;
  return !!shape.maskCanvas.getContext('2d')?.getImageData(x,y,1,1).data[3];
}

function makePath(points: Point[], close = true) {
  const path = new Path2D();
  if (points.length) {
    path.moveTo(points[0].x,points[0].y);
    const segmentCount=close?points.length:points.length-1;
    for(let i=0;i<segmentCount;i++) {
      const j=(i+1)%points.length,start=points[i],end=points[j];
      if(!start.outHandle&&!end.inHandle){path.lineTo(end.x,end.y);continue;}
      const out=start.outHandle??start,incoming=end.inHandle??end;
      path.bezierCurveTo(out.x,out.y,incoming.x,incoming.y,end.x,end.y);
    }
    if(close)path.closePath();
  }
  return path;
}

function makePaintLayer(image: HTMLImageElement, selection: Selection) {
  const allShapes = [...selection.shapes, ...selection.holes];
  if (!allShapes.length || !selection.color) return { canvas: document.createElement('canvas'), left: 0, top: 0 };
  const bounds=allShapes.map(shape => 'maskCanvas' in shape ? {left:shape.left,top:shape.top,right:shape.left+shape.maskCanvas.width/shape.scale,bottom:shape.top+shape.maskCanvas.height/shape.scale} : {left:Math.min(...shape.points.map(p=>p.x)),top:Math.min(...shape.points.map(p=>p.y)),right:Math.max(...shape.points.map(p=>p.x)),bottom:Math.max(...shape.points.map(p=>p.y))});
  const left = Math.max(0, Math.floor(Math.min(...bounds.map(b=>b.left))));
  const top = Math.max(0, Math.floor(Math.min(...bounds.map(b=>b.top))));
  const right = Math.min(image.naturalWidth, Math.ceil(Math.max(...bounds.map(b=>b.right))));
  const bottom = Math.min(image.naturalHeight, Math.ceil(Math.max(...bounds.map(b=>b.bottom))));
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
  selection.shapes.forEach(shape => 'maskCanvas' in shape ? maskCtx.drawImage(shape.maskCanvas,shape.left,shape.top,shape.maskCanvas.width/shape.scale,shape.maskCanvas.height/shape.scale) : maskCtx.fill(shape.path));
  maskCtx.globalCompositeOperation = 'destination-out'; selection.holes.forEach(shape => 'maskCanvas' in shape ? maskCtx.drawImage(shape.maskCanvas,shape.left,shape.top,shape.maskCanvas.width/shape.scale,shape.maskCanvas.height/shape.scale) : maskCtx.fill(shape.path));
  const maskPixels = maskCtx.getImageData(0, 0, width, height).data;
  const rgb = selection.color?.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [128,128,128];
  const output = new Uint8ClampedArray(pixels.data.length);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const coverage = maskPixels[i+3] / 255 * selection.opacity;
    if (!coverage) continue;
    const light = (0.2126*pixels.data[i] + 0.7152*pixels.data[i+1] + 0.0722*pixels.data[i+2]) / 255;
    // Keep the new paint opaque: only 4% of the original luminance remains as subtle surface lighting.
    const shade = 0.96 + light * 0.04;
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
  const selectionsRef = useRef(selections);
  const selectionHistory = useRef<{past:Selection[][];future:Selection[][]}>({past:[],future:[]});
  const [points, setPoints] = useState<Point[]>([]);
  const [curveDrag, setCurveDrag] = useState<CurveDrag|null>(null);
  const [maskShape, setMaskShape] = useState<MaskShape|null>(null);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>('polygon');
  const [edgeSnap, setEdgeSnap] = useState(false);
  const [colorTolerance, setColorTolerance] = useState(34);
  const [colorScope, setColorScope] = useState<'connected'|'image'>('connected');
  const [colorSeed, setColorSeed] = useState<Point|null>(null);
  const [maskEditMode, setMaskEditMode] = useState<MaskEditMode>('select');
  const [brushSize, setBrushSize] = useState(24);
  const [areaMode, setAreaMode] = useState<'new' | 'add' | 'subtract' | 'edit'>('new');
  const [gesture, setGesture] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const spaceHeldRef = useRef(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<number[]>([]);
  const [color, setColor] = useState<Color>(colors[0]);
  const [name, setName] = useState('');
  const [naming, setNaming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState('All colors');
  const [visibleCount, setVisibleCount] = useState(64);
  const [exportFormat, setExportFormat] = useState<'png' | 'jpg'>('png');
  const [toast, setToast] = useState('');
  const maskTintRef = useRef<{ maskId:number; canvas:HTMLCanvasElement }|null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const edgeMapRef = useRef<EdgeMap | null>(null);
  const colorMapRef = useRef<ColorMap | null>(null);
  const paintCache = useRef(new Map<number, { key: string; canvas: HTMLCanvasElement; left: number; top: number }>());
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = selections.find(item => item.id === selectedId);
  const updateSelections=(update:(current:Selection[])=>Selection[],record=true)=>{const previous=selectionsRef.current,next=update(previous);if(next===previous)return;if(record){selectionHistory.current.past.push(previous);if(selectionHistory.current.past.length>60)selectionHistory.current.past.shift();}selectionHistory.current.future=[];selectionsRef.current=next;setSelections(next);};
  const undoSurfaces=()=>{const history=selectionHistory.current;if(!history.past.length)return;const previous=history.past.pop()!;history.future.push(selectionsRef.current);selectionsRef.current=previous;setSelections(previous);setSelectedId(id=>id!==null&&previous.some(s=>s.id===id)?id:previous[previous.length-1]?.id??null);setMultiSelectedIds([]);};
  const redoSurfaces=()=>{const history=selectionHistory.current;if(!history.future.length)return;const next=history.future.pop()!;history.past.push(selectionsRef.current);selectionsRef.current=next;setSelections(next);setSelectedId(id=>id!==null&&next.some(s=>s.id===id)?id:next[next.length-1]?.id??null);setMultiSelectedIds([]);};
  const palette = (colors as Color[]).filter(c => (family==='All colors'||colorFamily(c)===family) && `${c.colorName} ${c.colorCode} ${c.colorTone}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(()=>setVisibleCount(64),[family,query]);
  useEffect(()=>{
    const down=(event:KeyboardEvent)=>{const target=event.target as HTMLElement,typing=['INPUT','TEXTAREA','SELECT'].includes(target?.tagName)||target?.isContentEditable;if((event.ctrlKey||event.metaKey)&&!typing){if(event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)redoSurfaces();else undoSurfaces();return;}if(event.key.toLowerCase()==='y'){event.preventDefault();redoSurfaces();return;}}if(event.code==='Space'&&!typing){event.preventDefault();spaceHeldRef.current=true;}};
    const up=(event:KeyboardEvent)=>{if(event.code==='Space')spaceHeldRef.current=false;};
    const blur=()=>{spaceHeldRef.current=false;};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);
    return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);};
  },[]);

  const draw = useCallback((ctx: CanvasRenderingContext2D, outlines = true, preview: Point[] = points) => {
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (imageRef.current) ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);
    selections.forEach(s => {
      ctx.save();
      if (s.color && imageRef.current) {
        const key = `${s.color}:${s.opacity}:${[...s.shapes,...s.holes].map(shape=>'maskCanvas' in shape?`mask-${shape.maskId}`:shape.points.map(p=>`${p.x},${p.y}`).join(';')).join('|')}`;
        let layer = paintCache.current.get(s.id);
        if (!layer || layer.key !== key) { const result = makePaintLayer(imageRef.current, s); layer = { ...result, key }; paintCache.current.set(s.id, layer); }
        ctx.drawImage(layer.canvas, layer.left, layer.top);
      }
      if (outlines) {
        ctx.strokeStyle = s.id === selectedId ? '#b8754e' : 'rgba(255,255,255,.95)'; ctx.lineWidth = s.id === selectedId ? 3 : 2; ctx.setLineDash(s.id === selectedId ? [] : [7, 5]);
        s.shapes.forEach(shape=>{
          if('maskCanvas' in shape){if(!s.color){ctx.save();ctx.globalAlpha=.28;ctx.drawImage(shape.maskCanvas,shape.left,shape.top,shape.maskCanvas.width/shape.scale,shape.maskCanvas.height/shape.scale);ctx.restore();}}
          else ctx.stroke(shape.path);
        });
        ctx.strokeStyle = '#e05b50'; ctx.setLineDash([4,4]); s.holes.forEach(shape=>{if(!('maskCanvas' in shape))ctx.stroke(shape.path);});
      }
      ctx.restore();
    });
    if (outlines && maskShape) { let tint=maskTintRef.current;if(!tint||tint.maskId!==maskShape.maskId){tint={maskId:maskShape.maskId,canvas:tintMask(maskShape,'#20b875')};maskTintRef.current=tint;}ctx.save();ctx.globalAlpha=.48;ctx.drawImage(tint.canvas,maskShape.left,maskShape.top,maskShape.maskCanvas.width/maskShape.scale,maskShape.maskCanvas.height/maskShape.scale);ctx.restore(); }
    if (outlines && preview.length) {
      ctx.save(); ctx.strokeStyle = areaMode === 'subtract' ? '#e05b50' : '#b8754e'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      if(maskShape&&tool==='polygon'&&(maskEditMode==='trace-add'||maskEditMode==='trace-erase')&&preview.length>=3){ctx.fillStyle=maskEditMode==='trace-add'?'rgba(32,184,117,.38)':'rgba(226,73,73,.4)';ctx.fill(makePath(preview));}
      if (tool === 'polygon' || tool === 'freehand') {
        ctx.stroke(makePath(preview,tool!=='polygon')); ctx.setLineDash([]);
        if (tool === 'polygon') preview.forEach(p => { for(const handle of [p.inHandle,p.outHandle])if(handle){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(handle.x,handle.y);ctx.strokeStyle='rgba(184,117,78,.75)';ctx.lineWidth=1;ctx.stroke();ctx.beginPath();ctx.arc(handle.x,handle.y,4,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.stroke();}ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#b8754e'; ctx.stroke(); });
      } else if (preview.length > 1) ctx.stroke(makePath(preview));
      ctx.restore();
    }
  }, [areaMode, maskEditMode, maskShape, points, selectedId, selections, tool]);

  useEffect(() => { const ctx = canvasRef.current?.getContext('2d'); if (ctx) draw(ctx); }, [draw, image]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => { const map=colorMapRef.current;if(drawing&&tool==='wand'&&colorSeed&&map)setMaskShape(makeColorMask(map,colorSeed,colorTolerance,colorScope)); },[colorSeed,colorTolerance,colorScope,drawing,tool]);

  const upload = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setToast('Choose an image file to get started.'); return; }
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { const canvas = canvasRef.current; if (canvas) { canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; }
      paintCache.current.clear(); edgeMapRef.current = makeEdgeMap(img); colorMapRef.current=makeColorMap(img); setZoom(1); setPan({ x: 0, y: 0 });
      imageRef.current = img; setImage(url); selectionsRef.current=[];selectionHistory.current={past:[],future:[]};setSelections([]); setPoints([]); setMaskShape(null); setColorSeed(null); setSelectedId(null); setMultiSelectedIds([]); setDrawing(false); setToast('Photo added — trace an area or use color select.'); };
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
      if (distance<=radius && score>bestScore) { bestScore=score; best={x:x/scale,y:y/scale}; }
    }
    return best;
  };
  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = pointFromEvent(e);
    if (spaceHeldRef.current || (!drawing && zoom > 1)) { e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId); setPanStart({ x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }); return; }
    if (!drawing) { const ctx = canvasRef.current?.getContext('2d'); if (ctx) { const hit = [...selections].reverse().find(s => s.shapes.some(shape=>containsPart(ctx,shape,p)) && !s.holes.some(shape=>containsPart(ctx,shape,p))); if (hit) setSelectedId(hit.id); } return; }
    if (tool === 'wand') { if(maskShape&&(maskEditMode==='add'||maskEditMode==='erase')){e.currentTarget.setPointerCapture(e.pointerId);setGesture(true);const img=imageRef.current;if(img)setMaskShape(v=>v?paintMaskBrush(v,p,maskEditMode,brushSize,img.naturalWidth,img.naturalHeight):v);return;}setColorSeed(p);setPoints([]);return; }
    if (tool === 'polygon') {
      const canvas=e.currentTarget,hitRadius=14*canvas.width/canvas.getBoundingClientRect().width;
      if(e.shiftKey&&points.length>1){let nearest=-1,nearestDistance=hitRadius;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy,t=length2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length2)):0,distance=Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));if(distance<nearestDistance){nearest=i;nearestDistance=distance;}}if(nearest>=0){canvas.setPointerCapture(e.pointerId);setGesture(true);setCurveDrag({index:nearest,start:p,mode:'segment'});return;}
        for(let i=points.length-1;i>=0;i--)if(Math.hypot(points[i].x-p.x,points[i].y-p.y)<=hitRadius){canvas.setPointerCapture(e.pointerId);setGesture(true);setCurveDrag({index:i,start:p,mode:'anchor'});return;}}
      setPoints(v=>[...v,snapToEdge(p)]);return;
    }
    e.currentTarget.setPointerCapture(e.pointerId); setGesture(true); setPoints([p]);
  };
  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (panStart) { setPan({ x: panStart.panX + e.clientX - panStart.x, y: panStart.panY + e.clientY - panStart.y }); return; }
    if (!drawing || !gesture) return; const p = pointFromEvent(e);
    if(tool==='wand'&&maskShape&&(maskEditMode==='add'||maskEditMode==='erase')){const img=imageRef.current;if(img)setMaskShape(v=>v?paintMaskBrush(v,p,maskEditMode,brushSize,img.naturalWidth,img.naturalHeight):v);return;}
    if(tool==='polygon'&&curveDrag){if(Math.hypot(p.x-curveDrag.start.x,p.y-curveDrag.start.y)<3*e.currentTarget.width/e.currentTarget.getBoundingClientRect().width)return;setPoints(v=>{if(curveDrag.mode==='anchor')return v.map((point,i)=>i===curveDrag.index?{...point,outHandle:p,inHandle:{x:2*point.x-p.x,y:2*point.y-p.y}}:point);const a=v[curveDrag.index],b=v[(curveDrag.index+1)%v.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1,nx=-dy/length,ny=dx/length,offset=((p.x-curveDrag.start.x)*nx+(p.y-curveDrag.start.y)*ny)*4/3;return v.map((point,i)=>i===curveDrag.index?{...point,outHandle:{x:a.x+dx/3+nx*offset,y:a.y+dy/3+ny*offset}}:i===(curveDrag.index+1)%v.length?{...point,inHandle:{x:b.x-dx/3+nx*offset,y:b.y-dy/3+ny*offset}}:point);});return;}
    setPoints(v => tool === 'freehand' ? [...v,p] : [v[0],p]);
  };
  const handlePointerUp = () => { setGesture(false); setCurveDrag(null); setPanStart(null); };
  const changeZoom = (next: number) => { const value = Math.max(1, Math.min(4, next)); setZoom(value); if (value === 1) setPan({ x: 0, y: 0 }); };
  const minimumPoints = tool === 'wand' ? 0 : 3;
  const canFinish = tool==='wand' ? maskShape!==null : points.length>=minimumPoints;
  const isMaskTrace=maskEditMode==='trace-add'||maskEditMode==='trace-erase';
  const makeCurrentShape = (): SurfacePart => tool==='wand' && maskShape ? maskShape : ({ path: makePath(points), points, tool });
  const saveArea = () => { if(renaming && selectedId!==null){updateSelections(v=>v.map(s=>s.id===selectedId?{...s,name:name.trim()||s.name}:s));setRenaming(false);setNaming(false);setName('');setToast('Surface renamed.');return;} if (tool!=='wand' && points.length < minimumPoints || tool==='wand' && !maskShape) return; const shape=makeCurrentShape(); updateSelections(v => [...v, { id: Date.now(), name: name.trim() || `Area ${v.length+1}`, shapes:[shape], holes:[], color: null, opacity: 1 }]); setPoints([]); setMaskShape(null);setColorSeed(null); setName(''); setNaming(false); setDrawing(false); setAreaMode('new'); setToast('Surface saved. Pick a paint color to preview it.'); };
  const startDrawing = (mode: 'new'|'add'|'subtract') => { setDrawing(true); setAreaMode(mode); setTool('polygon'); setEdgeSnap(false); setGesture(false); setPoints([]);setMaskShape(null);setColorSeed(null);setMaskEditMode('select'); if (mode==='new') {setSelectedId(null);setMultiSelectedIds([]);} };
  const canEditSurface=!!selected&&selected.shapes.length===1&&selected.holes.length===0&&!('maskCanvas' in selected.shapes[0]);
  const editSurface=()=>{const shape=selected?.shapes[0];if(!selected||!shape||selected.shapes.length!==1||selected.holes.length||'maskCanvas' in shape)return;setDrawing(true);setAreaMode('edit');setTool('polygon');setEdgeSnap(false);setGesture(false);setCurveDrag(null);setPoints(shape.points);setMaskShape(null);setColorSeed(null);setMaskEditMode('select');setNaming(false);setToast('Edit the outline, then save it to update this surface.');};
  const finishDrawing = () => {
    if (!canFinish) return;
    if(areaMode==='edit'&&selectedId!==null){const shape=makeCurrentShape();updateSelections(v=>v.map(s=>s.id===selectedId?{...s,shapes:[shape]}:s));paintCache.current.delete(selectedId);setPoints([]);setDrawing(false);setAreaMode('new');setToast('Surface outline updated.');return;}
    if (areaMode === 'new') { setNaming(true); return; }
    if (selectedId === null) return;
    const shape=makeCurrentShape();
    updateSelections(v=>v.map(s=>s.id!==selectedId?s:areaMode==='add'?{...s,shapes:[...s.shapes,shape]}:{...s,holes:[...s.holes,shape]}));
    paintCache.current.delete(selectedId); setPoints([]);setMaskShape(null); setDrawing(false); setAreaMode('new'); setToast(areaMode==='add'?'Area added to the paint mask.':'Object cut out of the paint mask.');
  };
  const finishMaskTrace = () => {if(!maskShape||points.length<3||!imageRef.current)return;const mode=maskEditMode==='trace-erase'?'erase':'add';const next=editMaskWithPath(maskShape,makePath(points),points,mode,imageRef.current.naturalWidth,imageRef.current.naturalHeight);setMaskShape(next);setPoints([]);setCurveDrag(null);setColorSeed(null);setTool('wand');setMaskEditMode('select');setToast(mode==='add'?'Traced region added to the color selection.':next?'Traced region removed from the color selection.':'Color selection cleared.');};
  const apply = () => { if (!selected) return; updateSelections(v => v.map(s => s.id === selected.id ? { ...s, color: color.colorValue, colorName: color.colorName, colorCode: color.colorCode } : s)); setToast(`${color.colorName} applied to ${selected.name}.`); };
  const setOpacity = (opacity: number) => { if (selected) updateSelections(v => v.map(s => s.id === selected.id ? { ...s, opacity } : s),false); };
  const remove = () => { updateSelections(v => v.filter(s => s.id !== selectedId)); if(selectedId!==null)paintCache.current.delete(selectedId); setSelectedId(null); };
  const clearPaint = () => { if(!selected)return;updateSelections(v=>v.map(s=>s.id===selected.id?{...s,color:null,colorName:undefined,colorCode:undefined}:s));paintCache.current.delete(selected.id);setToast('Paint removed from this surface.'); };
  const mergeSelected = () => { const ids=new Set([...(selectedId===null?[]:[selectedId]),...multiSelectedIds]);if(ids.size<2)return;const parts=selections.filter(s=>ids.has(s.id));const active=parts.find(s=>s.id===selectedId)??parts[0];const merged:Selection={id:Date.now(),name:parts.map(s=>s.name).join(' + '),shapes:parts.flatMap(s=>s.shapes),holes:parts.flatMap(s=>s.holes),color:active.color,colorName:active.colorName,colorCode:active.colorCode,opacity:active.opacity,mergedFrom:parts};updateSelections(v=>[...v.filter(s=>!ids.has(s.id)),merged]);parts.forEach(s=>paintCache.current.delete(s.id));setSelectedId(merged.id);setMultiSelectedIds([]);setToast(`${parts.length} surfaces merged. You can split them again.`);};
  const splitSelected = () => {if(!selected?.mergedFrom)return;const originals=selected.mergedFrom;updateSelections(v=>[...v.filter(s=>s.id!==selected.id),...originals]);paintCache.current.delete(selected.id);setSelectedId(originals[0]?.id??null);setMultiSelectedIds([]);setToast('Merged surfaces split back into their original areas.');};
  const exportImage = () => { const c = canvasRef.current; if (!c || !image) return; const out = document.createElement('canvas'); out.width = c.width; out.height = c.height; const ctx = out.getContext('2d'); if (!ctx) return; draw(ctx, false, []); const jpg=exportFormat==='jpg'; const a = document.createElement('a'); a.download = `room-preview.${exportFormat}`; a.href = out.toDataURL(jpg?'image/jpeg':'image/png', jpg?0.92:undefined); a.click(); setToast(`Your ${jpg?'JPG':'PNG'} preview is ready to share.`); };

  return <div className="app-shell" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files[0]); }}>
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark"><Palette size={19}/></span><span>hue<span className="brand-light">house</span></span></a><div className="export-controls"><select aria-label="Export format" value={exportFormat} onChange={e=>setExportFormat(e.target.value as 'png'|'jpg')}><option value="png">PNG</option><option value="jpg">JPG</option></select><button className="export-button" disabled={!image} onClick={exportImage}><ArrowDownToLine size={16}/> Export</button></div></header>
    <main className="workspace">
      <section className="main-column">
        <div className={`canvas-card ${image ? 'has-image' : ''}`}>
          {!image && <div className="upload-empty"><div className="upload-icon"><ImagePlus size={25}/></div><h2>Start with a photo of your space</h2><p>For best results, use a clear, well-lit photo with the surface you want to recolor in view.</p><button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={17}/> Upload a photo</button><span className="file-note">JPG, PNG or WEBP · stored on your device</span><div className="drop-hint">or drop an image anywhere in this area</div></div>}
          <canvas ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} className={image ? (drawing ? 'drawing-canvas' : zoom > 1 ? 'panning-canvas' : 'view-canvas') : 'hidden-canvas'} />
          {image && <div className="canvas-caption"><span><span className="live-dot"/>{drawing ? 'Click points · Shift-drag edge to curve · Space-drag to pan' : zoom > 1 ? 'Drag to pan · Space-drag anytime' : 'Your room · Space-drag to pan'}</span><div className="canvas-tools"><button aria-label="Zoom out" title="Zoom out" disabled={zoom<=1} onClick={()=>changeZoom(zoom-.25)}><ZoomOut size={14}/></button><span>{Math.round(zoom*100)}%</span><button aria-label="Zoom in" title="Zoom in" disabled={zoom>=4} onClick={()=>changeZoom(zoom+.25)}><ZoomIn size={14}/></button><button onClick={()=>changeZoom(1)}>Fit</button><button onClick={() => fileRef.current?.click()}><RotateCcw size={14}/> Change photo</button></div></div>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => upload(e.target.files?.[0])}/>
      </section>
      <aside className="side-panel"><div className="panel-heading"><div><span className="panel-kicker">YOUR PROJECT</span><h2>Color your space</h2></div><span className="count-pill">{selections.length} {selections.length === 1 ? 'area' : 'areas'}</span></div>
        <div className="area-section"><div className="section-label"><span>SURFACES <small>{selections.length ? `${selections.length} saved` : 'Optional'}</small></span><div className="history-controls"><button aria-label="Undo surface change" title="Undo (Ctrl+Z)" disabled={!selectionHistory.current.past.length} onClick={undoSurfaces}><Undo2 size={14}/></button><button aria-label="Redo surface change" title="Redo (Ctrl+Y)" disabled={!selectionHistory.current.future.length} onClick={redoSurfaces}><Redo2 size={14}/></button></div></div>
          {selections.length === 0 ? <div className="empty-areas"><div className="empty-area-icon"><Plus size={17}/></div><div><b>No surfaces yet</b><p>{image ? 'Create a surface or select a color region.' : 'Upload a photo, then create a surface.'}</p></div></div> : <details className="surface-dropdown"><summary><span className="surface-current"><b>{selected?.name??'Choose a surface'}</b><small>{selected?.colorName??'Select an area to edit or paint'}</small></span><ChevronDown size={15}/></summary><div className="area-list">{selections.map(s => <button key={s.id} className={`area-row ${selectedId===s.id||multiSelectedIds.includes(s.id)?'active':''}`} onClick={e=>{if(e.shiftKey){setMultiSelectedIds(v=>v.includes(s.id)?v.filter(id=>id!==s.id):[...v,s.id]);}else{setSelectedId(s.id);setMultiSelectedIds([]);e.currentTarget.closest('details')?.removeAttribute('open');}}}><span className="area-swatch" style={{background:s.color || '#eee8e2'}}/><span className="area-text"><b>{s.name}</b><small>{s.colorName || 'No paint applied'}</small></span><span className="area-arrow">{multiSelectedIds.includes(s.id)?'Grouped':selectedId===s.id?'Selected':'›'}</span></button>)}</div></details>}
          {selections.length>1&&!drawing&&<p className="surface-help">Shift-click areas to select multiple for merging.</p>}
          {selected && !drawing && <div className="surface-actions"><button onClick={editSurface} disabled={!canEditSurface} title={canEditSurface?'Edit this surface outline':'Editing is available for single traced surfaces without cutouts'}>Edit surface</button><button onClick={()=>{setName(selected.name);setRenaming(true);setNaming(true);}}>Rename surface</button><button className="remove-surface" onClick={remove}>Remove surface</button>{selected.mergedFrom&&<button onClick={splitSelected}>Split merged area</button>}{new Set([selectedId,...multiSelectedIds]).size>1&&<button onClick={mergeSelected}>Merge selected</button>}</div>}
          {image && <div className={`area-actions ${drawing?'drawing-actions':'mask-actions'}`}>{drawing ? <><button className="secondary-button" onClick={() => {if(isMaskTrace){setTool('wand');setMaskEditMode('select');setPoints([]);setCurveDrag(null);setGesture(false);setColorSeed(null);}else{setDrawing(false);setGesture(false);setCurveDrag(null);setPoints([]);setMaskShape(null);setColorSeed(null);setAreaMode('new');}}}><X size={15}/> {isMaskTrace?'Cancel trace':'Cancel'}</button><button className="primary-button compact" disabled={isMaskTrace?points.length<3:!canFinish} onClick={isMaskTrace?finishMaskTrace:finishDrawing}><Check size={15}/> {isMaskTrace?'Apply to selection':areaMode==='new'?'Finish area':areaMode==='edit'?'Save outline':'Finish mask'}</button></> : <><button className="outline-button" onClick={() => startDrawing('new')}><Plus size={16}/> Create surface</button>{selected && <><button className="mask-action" onClick={() => startDrawing('add')}><Plus size={13}/> Add to mask</button><button className="mask-action subtract" onClick={() => startDrawing('subtract')}><X size={13}/> Cut object out</button></>}</>}</div>}
          {drawing && <>{!isMaskTrace&&<div className="tool-picker" aria-label="Surface drawing tools">
            <button className={tool==='polygon'?'active':''} onClick={()=>{setTool('polygon');setMaskShape(null);setColorSeed(null);setMaskEditMode('select');setGesture(false);setCurveDrag(null);setPoints([]);}}><Pencil size={15}/> Point trace</button>
            <button className={tool==='freehand'?'active':''} onClick={()=>{setTool('freehand');setMaskShape(null);setColorSeed(null);setMaskEditMode('select');setGesture(false);setCurveDrag(null);setPoints([]);}}><Pencil size={15}/> Freehand</button>
            <button className={tool==='wand'?'active':''} onClick={()=>{setTool('wand');setPoints([]);setMaskShape(null);setColorSeed(null);setMaskEditMode('select');setGesture(false);setCurveDrag(null);}}><Wand2 size={15}/> Select similar color</button>
          </div>}{tool==='polygon' && <><button className={`edge-snap ${edgeSnap?'active':''}`} onClick={()=>setEdgeSnap(v=>!v)}><Magnet size={13}/>{edgeSnap?'Edge snap on':'Snap clicks to edges'}</button><p className="drawing-tip curve-help">{isMaskTrace?'Click to add outline points. Shift-drag an anchor or edge to bend it. Green adds; red removes.':'Click to add straight points. Shift-drag a point to curve adjoining edges, or shift-drag an edge to bend only that segment.'}</p></>}{tool==='wand'&&<><label className="tolerance-control">Color tolerance <b>{colorTolerance}%</b><input aria-label="Color tolerance" type="range" min="8" max="100" value={colorTolerance} onChange={e=>setColorTolerance(Number(e.target.value))}/></label><label className="color-scope-control"><input type="checkbox" checked={colorScope==='image'} onChange={e=>setColorScope(e.target.checked?'image':'connected')}/><span><b>Match across whole image</b><small>Select disconnected regions with similar colors.</small></span></label>{maskShape&&<><div className="mask-edit-tools" aria-label="Edit selected color mask"><button className={maskEditMode==='select'?'active':''} onClick={()=>setMaskEditMode('select')}>Select</button><button className={maskEditMode==='add'?'active':''} onClick={()=>setMaskEditMode('add')}>Restore brush</button><button className={maskEditMode==='erase'?'active':''} onClick={()=>setMaskEditMode('erase')}>Erase brush</button><button className={maskEditMode==='trace-add'?'active':''} onClick={()=>{setMaskEditMode('trace-add');setTool('polygon');setPoints([]);setCurveDrag(null);setGesture(false);}}>Trace add</button><button className={maskEditMode==='trace-erase'?'active':''} onClick={()=>{setMaskEditMode('trace-erase');setTool('polygon');setPoints([]);setCurveDrag(null);setGesture(false);}}>Trace erase</button></div>{(maskEditMode==='add'||maskEditMode==='erase')&&<label className="tolerance-control brush-control">Brush size <b>{brushSize}px</b><input aria-label="Mask brush size" type="range" min="6" max="120" value={brushSize} onChange={e=>setBrushSize(Number(e.target.value))}/></label>}</>}<p className="drawing-tip">{areaMode==='subtract'?'Trace or select the window, furniture, or object to keep paint off it.':areaMode==='add'?'Add another patch to this paint mask.':maskShape&&maskEditMode==='erase'?'Drag over unwanted parts of the selection to erase them.':maskShape&&maskEditMode==='add'?'Drag to restore missed surface areas.':maskShape?'Color selection is green. Adjust tolerance or refine it before applying.':colorScope==='image'?'Click a color to select matching areas across the photo.':'Click a color region; change tolerance to update the selection.'}</p></>}</>}
        </div>
        <div className="palette-section"><div className="section-label">COLOR PALETTE <span>{palette.length.toLocaleString()} colors</span></div><div className="selected-color"><span className="selected-dot" style={{background:color.colorValue}}/><div><b>{color.colorName}</b><small>{color.colorCode} · {color.colorTone}</small></div><span className="finish-tag">SAMPLE</span></div><div className="palette-filters"><select aria-label="Color family" value={family} onChange={e=>setFamily(e.target.value)}>{['All colors','Whites','Neutrals','Blacks','Reds','Oranges','Yellows','Greens','Cyans','Blues','Purples','Pinks'].map(f=><option key={f}>{f}</option>)}</select><label className="search-box"><Palette size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a color or finish"/><kbd>/</kbd></label></div><div className="swatch-grid color-list" onScroll={e=>{const el=e.currentTarget;if(el.scrollTop+el.clientHeight>=el.scrollHeight-24)setVisibleCount(v=>Math.min(v+64,palette.length));}}>{palette.slice(0, visibleCount).map(c => <button key={c.colorCode} title={`${c.colorName} · ${c.colorCode}`} aria-label={`Choose ${c.colorName}`} onClick={() => setColor(c)} className={`color-list-item ${color.colorCode===c.colorCode?'chosen':''}`}><span className="color-chip" style={{background:c.colorValue}}/><span className="color-list-copy"><b>{c.colorName}</b><small>{c.colorCode}</small></span>{color.colorCode===c.colorCode&&<Check size={13}/>}</button>)}</div><p className="palette-foot">Showing {Math.min(palette.length,visibleCount).toLocaleString()} of {palette.length.toLocaleString()} · scroll for more</p>
          {selected && <label className="opacity-control"><span>Paint coverage <b>{Math.round(selected.opacity*100)}%</b></span><input aria-label="Paint coverage" type="range" min="25" max="100" value={Math.round(selected.opacity*100)} onChange={e=>setOpacity(Number(e.target.value)/100)}/><small>At 100%, paint covers the old color while keeping the photo’s lighting and texture.</small></label>}
          <button className="apply-button" disabled={!selected} onClick={apply}><Paintbrush size={16}/>{selected ? 'Apply colour' : 'Select a surface first'}</button>{selected?.color&&<button className="clear-paint-button" onClick={clearPaint}>Remove paint from surface</button>}
        </div><div className="privacy-note"><span>✳</span><p>Your photo stays on this device. We never upload or store your images.</p></div>
      </aside>
    </main>
    {naming && <div className="modal-backdrop" onMouseDown={e => {if(e.target===e.currentTarget){setNaming(false);setRenaming(false);}}}><form className="name-modal" onSubmit={e => {e.preventDefault();saveArea();}}><button type="button" className="modal-close" onClick={() => {setNaming(false);setRenaming(false);}}><X size={18}/></button><span className="panel-kicker">{renaming?'SURFACE OPTIONS':'NEW SURFACE'}</span><h2>{renaming?'Rename surface':'Name this area'}</h2><p>{renaming?'Choose a clear name for this part of your project.':'Give your surface a name so you can keep track of your color ideas.'}</p><input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Living room wall"/><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => {setNaming(false);setRenaming(false);}}>Cancel</button><button className="primary-button compact" type="submit"><Check size={15}/> {renaming?'Save name':'Save surface'}</button></div></form></div>}
    {toast && <div className="toast"><Check size={15}/>{toast}</div>}
  </div>;
}

export default App;
