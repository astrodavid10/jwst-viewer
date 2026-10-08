// ── Footprints ───────────────────────────────────────────────────────────────
// A small custom WebGL renderer that outlines each JWST image's 2D sky footprint
// as a thin colored box, so the user can see where every image sits on the sky
// even when none is in focus. Twin of marker-renderer.ts, but:
//   • draws gl.LINES (outlines) with a per-vertex color, not glowing points;
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
// Live tuning from the browser console:
//   window.__footprints = false   // disable this renderer entirely

import * as Engine from "@wwtelescope/engine";

export interface FootprintVertex {
  x: number;
  y: number;
  z: number;
  /** Hex color ("#rrggbb" / "#rgb" / "#rrggbbaa"). */
  color: string;
}

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
let uOpacity: any = null;

// Vertices are captured at install time; the GPU upload is deferred to the first
// draw (no GL context until the first frame). Re-staging triggers a re-upload.
let stagedVerts: FootprintVertex[] | null = null;
let opacity = 0; // hidden until the user toggles footprints on

const VERT_SRC = `\
attribute vec3 aPos;
attribute vec4 aColor;
uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;
varying vec4 vColor;
void main() {
  gl_Position = uPMatrix * uMVMatrix * vec4(aPos, 1.0);
  vColor = aColor;
}
`;

const FRAG_SRC = `\
precision mediump float;
varying vec4 vColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4(vColor.rgb, vColor.a * uOpacity);
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
  aPos = ctx.getAttribLocation(p, "aPos");
  aColor = ctx.getAttribLocation(p, "aColor");
  uMV = ctx.getUniformLocation(p, "uMVMatrix");
  uProj = ctx.getUniformLocation(p, "uPMatrix");
  uOpacity = ctx.getUniformLocation(p, "uOpacity");
  vbo = ctx.createBuffer();
  gl = ctx;
  initialized = true;
  // A fresh vbo has no data; if we're re-initializing after a context change,
  // drop the stale count rather than draw from an empty buffer. (Re-staging
  // the actual vertex data is out of scope — see the draw-entry comment.)
  vertexCount = 0;
}

function uploadVerts(verts: FootprintVertex[]): void {
  if (!gl || !vbo) { return; }
  const buf = new ArrayBuffer(verts.length * VERT_STRIDE);
  const f32 = new Float32Array(buf);
  const u8 = new Uint8Array(buf);
  const fPerRow = VERT_STRIDE / 4;
  for (let i = 0; i < verts.length; i++) {
    const r = verts[i];
    const fo = i * fPerRow;
    const bo = i * VERT_STRIDE;
    f32[fo + 0] = r.x;
    f32[fo + 1] = r.y;
    f32[fo + 2] = r.z;
    const rgba = hexToRGBA(r.color);
    u8[bo + COLOR_OFFSET + 0] = rgba[0];
    u8[bo + COLOR_OFFSET + 1] = rgba[1];
    u8[bo + COLOR_OFFSET + 2] = rgba[2];
    u8[bo + COLOR_OFFSET + 3] = rgba[3];
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
  vertexCount = verts.length;
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
  ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE_MINUS_SRC_ALPHA);
  ctx.disable(ctx.DEPTH_TEST);
  ctx.depthMask(false);

  ctx.drawArrays(ctx.LINES, 0, vertexCount);

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
