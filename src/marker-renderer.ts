// ── MarkerCloud ────────────────────────────────────────────────────────────
// A small custom WebGL renderer that draws each JWST image's 3D marker as a
// soft-glowing disc in one draw call, replacing WWT's native textured
// point-sprite path for a crisper, more cinematic look (and per-point color).
//
// Trimmed port of exo-sonification's exoplanet-renderer.ts: the exoplanet
// version also carried a timeline date cutoff, a discovery-method category-bit
// mask, a 2D unit-sphere vertex path, and an animated ping/search-ring pass.
// JWST markers only ever render in 3D (solar-system) mode and need none of
// that, so this keeps just the dot pass: one static VBO of (xR,yR,zR + rgba),
// a smoothstep glow fragment shader, a screen-space pixel size, and an opacity.
//
// Hook point: wwt-hacks.ts:layerManagerDraw calls drawMarkerCloud() on the
// Sky-frame pass, after the LayerManager has drawn its layers, when the world
// matrix is back to identity — so we render in absolute AU coords, which is
// exactly what MarkerRow.{xR,yR,zR} pre-compute (rotateX(ecliptic) baked in,
// matching the hit-test cache in jwst-viewer.vue).
//
// Live tuning from the browser console (all optional):
//   window.__markerSize     = 26       // CSS-px diameter (both device classes)
//   window.__markerBlend    = 'additive'  // 'additive' | 'normal' (default)
//   window.__markerCloud    = false     // disable this renderer entirely
//   window.__markerFarFloor = 0.15      // P3.6 far-zoom opacity floor (wwt-hacks.ts drives the fade itself)
//   window.__cosmosZoomOn   = 21.0      // P3.6 fade-band start, ln(zoom) — see wwt-hacks.ts

// Namespace import: WWTControl is typed, but Matrix3d exists at runtime without
// a .d.ts entry (the same gap wwt-hacks.ts works around), so it's reached via an
// `any` cast on the namespace below.
import * as Engine from "@wwtelescope/engine";

export interface MarkerRow {
  xR: number;
  yR: number;
  zR: number;
  /** Hex color ("#rrggbb" / "#rgb" / "#rrggbbaa"). */
  color: string;
}

// Coarse pointer ≈ phone/tablet; phones have high DPR, so the same CSS-px size
// reads much chunkier — default them smaller.
const IS_COARSE_POINTER = (typeof window !== "undefined")
  && typeof window.matchMedia === "function"
  && window.matchMedia("(pointer: coarse)").matches;
// Phones have high DPR, so a CSS-px ring reads much chunkier — keep mobile small.
const DEFAULT_SIZE_PX = IS_COARSE_POINTER ? 6.5 : 26;

const VERT_STRIDE = 16; // vec3 pos (12) + rgba uint8 (4)
const COLOR_OFFSET = 12;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let gl: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prog: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vbo: any = null;
let vertexCount = 0;
let initialized = false;

let aPos = -1;
let aColor = -1;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uMV: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uProj: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uPixelScale: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uOpacity: any = null;

// Rows are captured at install time; the GPU upload is deferred to the first
// draw (no GL context until the first frame). Re-staging triggers a re-upload.
let stagedRows: MarkerRow[] | null = null;
let opacity = 0; // hidden until 3D mode reveals the markers

// P3.6: multiplier (0..1) layered on top of `opacity`, driven every 3D frame
// from wwt-hacks.ts's layerManagerDraw Sky-frame hook — 1 close-in, fading
// toward a floor as the camera zooms far out so the marker cloud doesn't
// clutter the full SDSS-cosmos view. Independent of `opacity`'s hard 2D/3D
// on/off gate (set via setMarkerCloudOpacity on mode switches) so the two
// don't fight: opacity says "are we in 3D at all", zoomFadeFactor says "how
// far zoomed out are we right now".
let zoomFadeFactor = 1;

// Selection highlight: a larger white ring drawn over the focused marker until
// the viewer pans/zooms away. Stored as a world-space position; its 1-vertex VBO
// is (re)uploaded lazily on the next draw when highlightDirty is set.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let highlightVbo: any = null;
let highlightPos: [number, number, number] | null = null;
let highlightDirty = false;
const HIGHLIGHT_SCALE = 2.2; // highlight ring diameter relative to a normal marker

const VERT_SRC = `\
attribute vec3 aPos;
attribute vec4 aColor;
uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;
uniform float uPixelScale;
varying vec4 vColor;
void main() {
  gl_PointSize = uPixelScale;
  gl_Position = uPMatrix * uMVMatrix * vec4(aPos, 1.0);
  vColor = aColor;
}
`;

// An open RING (annulus) with anti-aliased inner and outer edges — a clean
// hollow circle rather than a filled dot. The solid band sits between ~0.72 and
// ~0.92 of the sprite half-extent; the smoothstep transitions give a ~1px AA on
// each side so it reads crisp at any size.
const FRAG_SRC = `\
precision mediump float;
varying vec4 vColor;
uniform float uOpacity;
void main() {
  float r = length(gl_PointCoord - vec2(0.5)) * 2.0; // 0 center → 1.0 at sprite edge
  float outer = smoothstep(1.00, 0.92, r); // 1 inside the outer edge, AA to 0 at rim
  float inner = smoothstep(0.62, 0.72, r); // 0 in the hollow center, AA up to 1
  float a = outer * inner;                 // ring = inside outer AND outside inner
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, a * uOpacity * vColor.a);
}
`;

function hexToRGBA(hex: string): [number, number, number, number] {
  let h = (hex || "").trim().replace(/^#/, "");
  if (h.length === 3) { h = h.split("").map((c) => c + c).join(""); }
  if (h.length === 6) { h += "ff"; }
  if (h.length !== 8) { return [255, 255, 255, 255]; }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = parseInt(h.slice(6, 8), 16);
  if ([r, g, b, a].some((v) => Number.isNaN(v))) { return [255, 255, 255, 255]; }
  return [r, g, b, a];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function compile(ctx: any, type: number, src: string): any {
  const s = ctx.createShader(type);
  ctx.shaderSource(s, src);
  ctx.compileShader(s);
  if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS)) {
    // eslint-disable-next-line no-console
    console.error("[MarkerCloud] shader compile error:", ctx.getShaderInfoLog(s));
  }
  return s;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function init(ctx: any): void {
  const v = compile(ctx, ctx.VERTEX_SHADER, VERT_SRC);
  const f = compile(ctx, ctx.FRAGMENT_SHADER, FRAG_SRC);
  const p = ctx.createProgram();
  ctx.attachShader(p, v);
  ctx.attachShader(p, f);
  ctx.linkProgram(p);
  if (!ctx.getProgramParameter(p, ctx.LINK_STATUS)) {
    // eslint-disable-next-line no-console
    console.error("[MarkerCloud] program link error:", ctx.getProgramInfoLog(p));
  }
  prog = p;
  aPos = ctx.getAttribLocation(p, "aPos");
  aColor = ctx.getAttribLocation(p, "aColor");
  uMV = ctx.getUniformLocation(p, "uMVMatrix");
  uProj = ctx.getUniformLocation(p, "uPMatrix");
  uPixelScale = ctx.getUniformLocation(p, "uPixelScale");
  uOpacity = ctx.getUniformLocation(p, "uOpacity");
  vbo = ctx.createBuffer();
  gl = ctx;
  initialized = true;
  // A fresh vbo has no data; if re-initializing after a context change, drop
  // the stale count rather than draw from an empty buffer (re-staging the
  // main marker set is out of scope, matches footprints.ts). The highlight
  // ring's tiny 1-vertex buffer IS cheap to recover, since highlightPos is
  // plain data, not a GL handle — force it to rebuild on the next draw.
  vertexCount = 0;
  highlightVbo = null;
  highlightDirty = true;
}

function uploadRows(rows: MarkerRow[]): void {
  if (!gl || !vbo) { return; }
  const buf = new ArrayBuffer(rows.length * VERT_STRIDE);
  const f32 = new Float32Array(buf);
  const u8 = new Uint8Array(buf);
  const fPerRow = VERT_STRIDE / 4;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const fo = i * fPerRow;
    const bo = i * VERT_STRIDE;
    f32[fo + 0] = r.xR;
    f32[fo + 1] = r.yR;
    f32[fo + 2] = r.zR;
    const rgba = hexToRGBA(r.color);
    u8[bo + COLOR_OFFSET + 0] = rgba[0];
    u8[bo + COLOR_OFFSET + 1] = rgba[1];
    u8[bo + COLOR_OFFSET + 2] = rgba[2];
    u8[bo + COLOR_OFFSET + 3] = rgba[3];
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
  vertexCount = rows.length;
}

/** Stage the marker set; the GPU upload happens on the next draw. */
export function installMarkerCloud(rows: MarkerRow[]): void {
  stagedRows = rows;
}

/** Marker opacity, 0..1 (0 = hidden). Driven by 2D/3D mode switches. */
export function setMarkerCloudOpacity(o: number): void {
  opacity = Math.max(0, Math.min(1, o));
}

/** Far-zoom fade multiplier, 0..1 (P3.6). Driven every 3D frame by
 *  wwt-hacks.ts; layered on top of setMarkerCloudOpacity's mode-switch gate. */
export function setMarkerCloudZoomFade(factor: number): void {
  zoomFadeFactor = Math.max(0, Math.min(1, factor));
}

/** Highlight (a larger white ring over) the focused marker, or clear it (null). */
export function setMarkerHighlight(pos: { xR: number; yR: number; zR: number } | null): void {
  highlightPos = pos ? [pos.xR, pos.yR, pos.zR] : null;
  highlightDirty = true;
}

/**
 * Per-frame draw. Only renders in 3D (solar-system) mode and when opacity > 0,
 * so it's a no-op in 2D. Saves/restores the GL state it touches so it doesn't
 * perturb WWT's renderer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function drawMarkerCloud(renderContext: any): void {
  if (typeof window === "undefined") { return; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.__markerCloud === false) { return; }
  if (opacity <= 0 || !renderContext || !renderContext.gl) { return; }

  // 3D only — marker positions are real-AU vertices, meaningless under WWT's 2D
  // unit-sphere projection.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctl = (Engine.WWTControl as any).singleton;
  if (!(ctl && typeof ctl.get_solarSystemMode === "function" && ctl.get_solarSystemMode())) { return; }

  const ctx = renderContext.gl;
  // Cheap context-loss guard — see footprints.ts's drawFootprints for the
  // rationale (full recovery is out of scope).
  if (!initialized || gl !== ctx) { init(ctx); }
  if (stagedRows) { uploadRows(stagedRows); stagedRows = null; }
  if (vertexCount === 0 || !prog || !vbo) { return; }

  // Save the GL state we touch.
  const oldProg = ctx.getParameter(ctx.CURRENT_PROGRAM);
  const oldArrBuf = ctx.getParameter(ctx.ARRAY_BUFFER_BINDING);
  const oldBlend = ctx.isEnabled(ctx.BLEND);
  const oldBlendSrc = ctx.getParameter(ctx.BLEND_SRC_RGB);
  const oldBlendDst = ctx.getParameter(ctx.BLEND_DST_RGB);
  const oldDepth = ctx.isEnabled(ctx.DEPTH_TEST);
  const oldDepthMask = ctx.getParameter(ctx.DEPTH_WRITEMASK);

  ctx.useProgram(prog);

  // mv = world × view (WWT's Matrix3d row order).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mv = (Engine as any).Matrix3d.multiplyMatrix(renderContext.get_world(), renderContext.get_view());
  ctx.uniformMatrix4fv(uMV, false, mv.floatArray());
  ctx.uniformMatrix4fv(uProj, false, renderContext.get_projection().floatArray());

  const sizePx = (w.__markerSize as number | undefined) ?? DEFAULT_SIZE_PX;
  const dpr = window.devicePixelRatio || 1;
  ctx.uniform1f(uPixelScale, sizePx * dpr);
  ctx.uniform1f(uOpacity, opacity * zoomFadeFactor);

  ctx.bindBuffer(ctx.ARRAY_BUFFER, vbo);
  ctx.bindBuffer(ctx.ELEMENT_ARRAY_BUFFER, null);
  // WWT's shaders leave attribs 0–3 enabled; disable defensively.
  ctx.disableVertexAttribArray(0);
  ctx.disableVertexAttribArray(1);
  ctx.disableVertexAttribArray(2);
  ctx.disableVertexAttribArray(3);

  if (aPos >= 0) {
    ctx.enableVertexAttribArray(aPos);
    ctx.vertexAttribPointer(aPos, 3, ctx.FLOAT, false, VERT_STRIDE, 0);
  }
  if (aColor >= 0) {
    ctx.enableVertexAttribArray(aColor);
    ctx.vertexAttribPointer(aColor, 4, ctx.UNSIGNED_BYTE, true, VERT_STRIDE, COLOR_OFFSET);
  }

  ctx.enable(ctx.BLEND);
  if (w.__markerBlend === "additive") {
    ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE);
  } else {
    ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE_MINUS_SRC_ALPHA);
  }
  ctx.disable(ctx.DEPTH_TEST);
  ctx.depthMask(false);

  ctx.drawArrays(ctx.POINTS, 0, vertexCount);

  // Selection highlight: one larger white ring over the focused marker. Drawn
  // with the same program/attribs but its own 1-vertex VBO and a bigger size.
  if (highlightPos) {
    if (!highlightVbo) { highlightVbo = ctx.createBuffer(); }
    if (highlightDirty) {
      const hb = new ArrayBuffer(VERT_STRIDE);
      const hf = new Float32Array(hb);
      const hu = new Uint8Array(hb);
      hf[0] = highlightPos[0];
      hf[1] = highlightPos[1];
      hf[2] = highlightPos[2];
      hu[COLOR_OFFSET + 0] = 255;
      hu[COLOR_OFFSET + 1] = 255;
      hu[COLOR_OFFSET + 2] = 255;
      hu[COLOR_OFFSET + 3] = 255;
      ctx.bindBuffer(ctx.ARRAY_BUFFER, highlightVbo);
      ctx.bufferData(ctx.ARRAY_BUFFER, hb, ctx.DYNAMIC_DRAW);
      highlightDirty = false;
    }
    ctx.bindBuffer(ctx.ARRAY_BUFFER, highlightVbo);
    if (aPos >= 0) { ctx.vertexAttribPointer(aPos, 3, ctx.FLOAT, false, VERT_STRIDE, 0); }
    if (aColor >= 0) { ctx.vertexAttribPointer(aColor, 4, ctx.UNSIGNED_BYTE, true, VERT_STRIDE, COLOR_OFFSET); }
    ctx.uniform1f(uPixelScale, sizePx * dpr * HIGHLIGHT_SCALE);
    ctx.drawArrays(ctx.POINTS, 0, 1);
  }

  if (aPos >= 0) { ctx.disableVertexAttribArray(aPos); }
  if (aColor >= 0) { ctx.disableVertexAttribArray(aColor); }

  // Restore GL state.
  if (oldBlend) { ctx.enable(ctx.BLEND); } else { ctx.disable(ctx.BLEND); }
  ctx.blendFunc(oldBlendSrc, oldBlendDst);
  if (oldDepth) { ctx.enable(ctx.DEPTH_TEST); } else { ctx.disable(ctx.DEPTH_TEST); }
  ctx.depthMask(oldDepthMask);
  ctx.bindBuffer(ctx.ARRAY_BUFFER, oldArrBuf);
  ctx.useProgram(oldProg);
}
