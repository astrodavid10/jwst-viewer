// ── Footprints ───────────────────────────────────────────────────────────────
// A small custom WebGL renderer that outlines each JWST image's 2D sky footprint
// as a thin colored box, so the user can see where every image sits on the sky
// even when none is in focus. Twin of marker-renderer.ts, but:
//   • draws extruded screen-space QUADS (gl.TRIANGLES), not gl.LINES — WebGL
//     clamps line width to 1px on most drivers, which reads too faint. Each
//     edge becomes a thin quad: two vertices per edge endpoint (side = -1/+1),
//     offset perpendicular to the screen-space edge direction by a pixel-based
//     half-width computed in the vertex shader, with a smoothstep AA falloff
//     across the quad's width in the fragment shader.
//   • renders in 2D (sky) mode and is a no-op in 3D — the inverse of the marker
//     gate (markers are 3D-only; footprints are 2D-only).
//
// Vertices are absolute positions on the unit sky sphere (radius 1), the same
// convention WWT's 2D constellation overlays use — jwst-viewer.vue:buildFootprints
// precomputes them via Coordinates.raDecTo3dAu(raHours, dec, 1) (NO ecliptic
// rotation; that tilt is applied only to the 3D markers). We're drawn from
// wwt-hacks.ts:layerManagerDraw's Sky-frame pass with the world matrix restored,
// so mv = world × view + projection projects them exactly like the constellation
// figures drawn a few lines later.
//
// installFootprints() still takes a flat array of LINE-endpoint PAIRS (each
// footprint box contributes its 4 edges as 8 vertices, unchanged from the old
// gl.LINES layout) — uploadVerts() below expands each pair into 6 edge-quad
// vertices (2 triangles) carrying (posA, posB, side) so jwst-viewer.vue's
// buildFootprints() needs no changes.
//
// Live tuning from the browser console:
//   window.__footprints = false   // disable this renderer entirely
//   window.__footprintWidth = 4   // total quad width in CSS px (default below)

import * as Engine from "@wwtelescope/engine";

export interface FootprintVertex {
  x: number;
  y: number;
  z: number;
  /** Hex color ("#rrggbb" / "#rgb" / "#rrggbbaa"). */
  color: string;
}

// Total on-screen width of the outline quads, in CSS px at devicePixelRatio 1.
const FOOTPRINT_WIDTH_PX = 2.5;

// GPU vertex layout: posA vec3 (12) + posB vec3 (12) + side float (4) +
// rgba uint8 (4) = 32 bytes. posA is THIS vertex's own sky position (what
// gl_Position is based on); posB is the edge's other endpoint, used only to
// compute the screen-space edge direction for the perpendicular offset.
const VERT_STRIDE = 32;
const POS_B_OFFSET = 12; // floats 3..5
const SIDE_OFFSET = 24; // float 6
const COLOR_OFFSET = 28;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let gl: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prog: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vbo: any = null;
let vertexCount = 0;
let initialized = false;

let aPosA = -1;
let aPosB = -1;
let aSide = -1;
let aColor = -1;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uMV: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uProj: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uOpacity: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uHalfWidthPx: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uViewportHeight: any = null;

// Vertices are captured at install time; the GPU upload is deferred to the first
// draw (no GL context until the first frame). Re-staging triggers a re-upload.
let stagedVerts: FootprintVertex[] | null = null;
let opacity = 0; // hidden until the user toggles footprints on

// Extruded screen-space quad: each vertex is one endpoint of an edge (aPosA,
// this vertex's own sky position) plus the OTHER endpoint (aPosB, used only to
// compute the edge's screen-space direction) and a side (-1/+1) telling it
// which way to push perpendicular to that direction. Both endpoints are
// projected so the perpendicular is computed in true screen space (not sky
// space), keeping the quad a constant pixel width regardless of zoom.
const VERT_SRC = `\
attribute vec3 aPosA;
attribute vec3 aPosB;
attribute float aSide;
attribute vec4 aColor;
uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;
uniform float uHalfWidthPx;
uniform float uViewportHeight;
varying vec4 vColor;
varying float vSide;
void main() {
  mat4 mvp = uPMatrix * uMVMatrix;
  vec4 clipA = mvp * vec4(aPosA, 1.0);
  vec4 clipB = mvp * vec4(aPosB, 1.0);

  vec2 ndcA = clipA.xy / clipA.w;
  vec2 ndcB = clipB.xy / clipB.w;
  vec2 dir = ndcB - ndcA;
  float len = length(dir);
  // Guard degenerate/near-zero edges so we never divide by ~0 (NaNs).
  vec2 dirN = len > 1.0e-8 ? (dir / len) : vec2(1.0, 0.0);
  vec2 normal = vec2(-dirN.y, dirN.x);

  // Convert a pixel half-width into clip-space units at this vertex's depth.
  float offsetClip = uHalfWidthPx * 2.0 * clipA.w / uViewportHeight;
  clipA.xy += normal * aSide * offsetClip;

  gl_Position = clipA;
  vColor = aColor;
  vSide = aSide;
}
`;

const FRAG_SRC = `\
precision mediump float;
varying vec4 vColor;
varying float vSide;
uniform float uOpacity;
void main() {
  // Soft falloff across the quad's width: solid through the middle, AA'd out
  // toward each edge (vSide interpolates -1..+1 across the quad).
  float d = abs(vSide);
  float edgeFade = 1.0 - smoothstep(0.7, 1.0, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * uOpacity * edgeFade);
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
    console.error("[Footprints] shader compile error:", ctx.getShaderInfoLog(s));
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
    console.error("[Footprints] program link error:", ctx.getProgramInfoLog(p));
  }
  prog = p;
  aPosA = ctx.getAttribLocation(p, "aPosA");
  aPosB = ctx.getAttribLocation(p, "aPosB");
  aSide = ctx.getAttribLocation(p, "aSide");
  aColor = ctx.getAttribLocation(p, "aColor");
  uMV = ctx.getUniformLocation(p, "uMVMatrix");
  uProj = ctx.getUniformLocation(p, "uPMatrix");
  uOpacity = ctx.getUniformLocation(p, "uOpacity");
  uHalfWidthPx = ctx.getUniformLocation(p, "uHalfWidthPx");
  uViewportHeight = ctx.getUniformLocation(p, "uViewportHeight");
  vbo = ctx.createBuffer();
  gl = ctx;
  initialized = true;
  // A fresh vbo has no data; if we're re-initializing after a context change,
  // drop the stale count rather than draw from an empty buffer. (Re-staging
  // the actual vertex data is out of scope — see the draw-entry comment.)
  vertexCount = 0;
}

// Expands the flat LINE-endpoint-pair list (unchanged input contract — every
// consecutive (verts[2i], verts[2i+1]) is one edge) into 6 edge-quad vertices
// per edge (2 triangles): (A,-1) (A,+1) (B,-1) / (A,+1) (B,+1) (B,-1). Each
// output vertex carries its OWN position as posA and the edge's other endpoint
// as posB (for the vertex-shader direction calc), plus its side and color.
function uploadVerts(verts: FootprintVertex[]): void {
  if (!gl || !vbo) { return; }
  const edgeCount = Math.floor(verts.length / 2);
  const outCount = edgeCount * 6;
  const buf = new ArrayBuffer(outCount * VERT_STRIDE);
  const f32 = new Float32Array(buf);
  const u8 = new Uint8Array(buf);
  const fPerRow = VERT_STRIDE / 4;
  const fPosB = POS_B_OFFSET / 4;
  const fSide = SIDE_OFFSET / 4;
  let outIdx = 0;
  const writeVert = (own: FootprintVertex, other: FootprintVertex, side: number) => {
    const fo = outIdx * fPerRow;
    const bo = outIdx * VERT_STRIDE;
    f32[fo + 0] = own.x;
    f32[fo + 1] = own.y;
    f32[fo + 2] = own.z;
    f32[fo + fPosB + 0] = other.x;
    f32[fo + fPosB + 1] = other.y;
    f32[fo + fPosB + 2] = other.z;
    f32[fo + fSide] = side;
    const rgba = hexToRGBA(own.color);
    u8[bo + COLOR_OFFSET + 0] = rgba[0];
    u8[bo + COLOR_OFFSET + 1] = rgba[1];
    u8[bo + COLOR_OFFSET + 2] = rgba[2];
    u8[bo + COLOR_OFFSET + 3] = rgba[3];
    outIdx++;
  };
  for (let e = 0; e < edgeCount; e++) {
    const a = verts[e * 2];
    const b = verts[e * 2 + 1];
    writeVert(a, b, -1);
    writeVert(a, b, 1);
    writeVert(b, a, -1);
    writeVert(a, b, 1);
    writeVert(b, a, 1);
    writeVert(b, a, -1);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
  vertexCount = outCount;
}

/**
 * Stage the footprint geometry; the GPU upload happens on the next draw. `verts`
 * is a flat list of LINE endpoints (pairs) — each footprint contributes its 4
 * edges as 8 vertices.
 */
export function installFootprints(verts: FootprintVertex[]): void {
  stagedVerts = verts;
}

/** Show or hide the footprints (instant; 2D only — no effect while in 3D). */
export function setFootprintsVisible(visible: boolean): void {
  opacity = visible ? 1 : 0;
}

/**
 * Per-frame draw. Only renders in 2D (sky) mode and when opacity > 0, so it's a
 * no-op in 3D. Saves/restores the GL state it touches so it doesn't perturb WWT's
 * renderer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function drawFootprints(renderContext: any): void {
  if (typeof window === "undefined") { return; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.__footprints === false) { return; }
  if (opacity <= 0 || !renderContext || !renderContext.gl) { return; }

  // 2D only — footprint vertices are unit-sphere points for the 2D sky
  // projection; in solar-system (3D) mode the sky sphere isn't the active frame.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctl = (Engine.WWTControl as any).singleton;
  if (ctl && typeof ctl.get_solarSystemMode === "function" && ctl.get_solarSystemMode()) { return; }

  const ctx = renderContext.gl;
  // Cheap context-loss guard: re-init if the context we initialized against
  // is no longer the live one. (Full recovery is out of scope — the engine
  // itself can't survive a real context loss — this just avoids drawing
  // against stale/deleted GL object handles.)
  if (!initialized || gl !== ctx) { init(ctx); }
  if (stagedVerts) { uploadVerts(stagedVerts); stagedVerts = null; }
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
  ctx.uniform1f(uOpacity, opacity);

  // Pixel width → clip-space conversion happens in the vertex shader; both
  // inputs must be in the same pixel units. drawingBufferHeight is the GL
  // viewport's actual device-pixel height, so scale the CSS-px width knob by
  // devicePixelRatio to match (mirrors marker-renderer.ts's `sizePx * dpr`).
  const dpr = window.devicePixelRatio || 1;
  const widthPx = (w.__footprintWidth as number | undefined) ?? FOOTPRINT_WIDTH_PX;
  const viewportHeight = ctx.drawingBufferHeight || 1;
  ctx.uniform1f(uHalfWidthPx, (widthPx * 0.5) * dpr);
  ctx.uniform1f(uViewportHeight, viewportHeight);

  ctx.bindBuffer(ctx.ARRAY_BUFFER, vbo);
  ctx.bindBuffer(ctx.ELEMENT_ARRAY_BUFFER, null);
  // WWT's shaders leave attribs 0–3 enabled; disable defensively.
  ctx.disableVertexAttribArray(0);
  ctx.disableVertexAttribArray(1);
  ctx.disableVertexAttribArray(2);
  ctx.disableVertexAttribArray(3);

  if (aPosA >= 0) {
    ctx.enableVertexAttribArray(aPosA);
    ctx.vertexAttribPointer(aPosA, 3, ctx.FLOAT, false, VERT_STRIDE, 0);
  }
  if (aPosB >= 0) {
    ctx.enableVertexAttribArray(aPosB);
    ctx.vertexAttribPointer(aPosB, 3, ctx.FLOAT, false, VERT_STRIDE, POS_B_OFFSET);
  }
  if (aSide >= 0) {
    ctx.enableVertexAttribArray(aSide);
    ctx.vertexAttribPointer(aSide, 1, ctx.FLOAT, false, VERT_STRIDE, SIDE_OFFSET);
  }
  if (aColor >= 0) {
    ctx.enableVertexAttribArray(aColor);
    ctx.vertexAttribPointer(aColor, 4, ctx.UNSIGNED_BYTE, true, VERT_STRIDE, COLOR_OFFSET);
  }

  ctx.enable(ctx.BLEND);
  ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE_MINUS_SRC_ALPHA);
  ctx.disable(ctx.DEPTH_TEST);
  ctx.depthMask(false);

  ctx.drawArrays(ctx.TRIANGLES, 0, vertexCount);

  if (aPosA >= 0) { ctx.disableVertexAttribArray(aPosA); }
  if (aPosB >= 0) { ctx.disableVertexAttribArray(aPosB); }
  if (aSide >= 0) { ctx.disableVertexAttribArray(aSide); }
  if (aColor >= 0) { ctx.disableVertexAttribArray(aColor); }

  // Restore GL state.
  if (oldBlend) { ctx.enable(ctx.BLEND); } else { ctx.disable(ctx.BLEND); }
  ctx.blendFunc(oldBlendSrc, oldBlendDst);
  if (oldDepth) { ctx.enable(ctx.DEPTH_TEST); } else { ctx.disable(ctx.DEPTH_TEST); }
  ctx.depthMask(oldDepthMask);
  ctx.bindBuffer(ctx.ARRAY_BUFFER, oldArrBuf);
  ctx.useProgram(oldProg);
}
