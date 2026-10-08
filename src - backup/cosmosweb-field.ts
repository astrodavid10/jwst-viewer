// ── CosmosWebField ──────────────────────────────────────────────────────────
// A self-contained, reusable WebGL renderer that draws the COSMOS-Web survey
// galaxies (~164k) as TEXTURED point-sprites in WWT's 3D (solar-system / cosmos)
// mode, in a single draw call. Each point samples a cell of a sprite atlas via
// per-point UV attributes (gl_PointCoord mapped into the atlas cell) and is
// tinted by a per-point redshift color.
//
// It mirrors marker-renderer.ts (one static VBO, gl.POINTS, GL-state
// save/restore, a per-frame drawCosmosWebField(renderContext) hooked off the
// LayerManager Sky-frame pass, rendering only when get_solarSystemMode() is
// true). The added wrinkle vs. marker-renderer is the atlas texture + UV attrs.
//
// Designed to drop into other interactives unchanged: positions live in the asset
// blob as RA/Dec/distance and are run through the engine's own
// Coordinates.raDecTo3dAu + ecliptic rotateX HERE, so the field lands in the same
// frame as the JWST markers (jwst-viewer.vue::buildMarkers) and the sky.
//
// Public API:
//   loadCosmosWebField(baseUrl?)        fetch + decode + stage assets (idempotent)
//   installCosmosWebField(records,atlas) explicit install w/o fetching (reuse/tests)
//   setCosmosWebFieldVisible(bool)       toggle 0/target opacity
//   setCosmosWebFieldOpacity(0..1)       direct opacity
//   drawCosmosWebField(renderContext)    per-frame hook (3D-only, cheap no-op)
//
// Live console tuning (all optional):
//   window.__cwSize  = 22         // CSS-px sprite diameter
//   window.__cwBlend = 'additive' // 'additive' | 'normal' (default 'normal')
//   window.__cwField = false      // disable this renderer entirely
//
// Namespace import: Coordinates/WWTControl are typed, but Matrix3d exists at
// runtime without a .d.ts entry (the gap marker-renderer.ts / wwt-hacks.ts work
// around), so engine internals are reached via `(Engine as any)`. ESLint here
// bans bare @ts-nocheck and PascalCase consts, hence the namespace pattern.
import * as Engine from "@wwtelescope/engine";

// Frame constants — identical to jwst-viewer.vue::buildMarkers so the field
// aligns with the JWST markers and the sky.
const LY_TO_AU = 63239.6717;
const ECLIPTIC_RAD = 23.4392911 * (Math.PI / 180);

export interface CosmosWebRecord {
  /** RA in degrees [0,360). */
  raDeg: number;
  /** Dec in degrees [-90,90]. */
  decDeg: number;
  /** Distance in light-years. */
  dly: number;
  /** 0..255 tint. */
  r: number;
  g: number;
  b: number;
  /** 0..255 base alpha. */
  a: number;
  /** Atlas cell index (0 = generic blob). */
  sprite: number;
}

export interface CosmosWebAtlas {
  cellPx: number;
  atlasCols: number;
  atlasPxW: number;
  atlasPxH: number;
  spriteCount: number;
  /** Decoded atlas bitmap. */
  image: TexImageSource;
}

// vec3 pos (12) + rgba uint8 (4) + uvOffset float32x2 (8) + uvScale float32x2 (8)
const VERT_STRIDE = 32;
const COLOR_OFFSET = 12;
const UVOFF_OFFSET = 16;
const UVSCALE_OFFSET = 24;

const DEFAULT_BASE_URL = "cosmosweb";

const IS_COARSE_POINTER = (typeof window !== "undefined")
  && typeof window.matchMedia === "function"
  && window.matchMedia("(pointer: coarse)").matches;
const DEFAULT_SIZE_PX = IS_COARSE_POINTER ? 14 : 22;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prog: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vbo: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tex: any = null;
let vertexCount = 0;
let initialized = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedGl: any = null; // context this renderer initialized against

let aPos = -1;
let aColor = -1;
let aUVOffset = -1;
let aUVScale = -1;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uMV: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uProj: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uPixelScale: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uOpacity: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uAtlas: any = null;

// Staged at install; GPU upload deferred to the first draw (no GL context until
// then). Re-staging triggers a re-upload.
let stagedBuffer: ArrayBuffer | null = null;
let stagedCount = 0;
let stagedAtlasImage: TexImageSource | null = null;
let opacity = 0; // OFF by default; revealed by the toggle in 3D mode

let loadPromise: Promise<void> | null = null;

const VERT_SRC = `\
attribute vec3 aPos;
attribute vec4 aColor;
attribute vec2 aUVOffset;
attribute vec2 aUVScale;
uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;
uniform float uPixelScale;
varying vec4 vColor;
varying vec2 vUVOffset;
varying vec2 vUVScale;
void main() {
  gl_PointSize = uPixelScale;
  gl_Position = uPMatrix * uMVMatrix * vec4(aPos, 1.0);
  vColor = aColor;
  vUVOffset = aUVOffset;
  vUVScale = aUVScale;
}
`;

// Sample the atlas cell, tint by the per-point color, scale by global opacity and
// the per-point base alpha. gl_PointCoord origin is top-left; the atlas is
// authored top-down so no V flip is needed.
const FRAG_SRC = `\
precision mediump float;
varying vec4 vColor;
varying vec2 vUVOffset;
varying vec2 vUVScale;
uniform sampler2D uAtlas;
uniform float uOpacity;
void main() {
  vec2 uv = vUVOffset + gl_PointCoord * vUVScale;
  vec4 tx = texture2D(uAtlas, uv);
  float a = tx.a * vColor.a * uOpacity;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(tx.rgb * vColor.rgb, a);
}
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function compile(ctx: any, type: number, src: string): any {
  const s = ctx.createShader(type);
  ctx.shaderSource(s, src);
  ctx.compileShader(s);
  if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS)) {
    // eslint-disable-next-line no-console
    console.error("[CosmosWebField] shader compile error:", ctx.getShaderInfoLog(s));
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
    console.error("[CosmosWebField] program link error:", ctx.getProgramInfoLog(p));
  }
  prog = p;
  aPos = ctx.getAttribLocation(p, "aPos");
  aColor = ctx.getAttribLocation(p, "aColor");
  aUVOffset = ctx.getAttribLocation(p, "aUVOffset");
  aUVScale = ctx.getAttribLocation(p, "aUVScale");
  uMV = ctx.getUniformLocation(p, "uMVMatrix");
  uProj = ctx.getUniformLocation(p, "uPMatrix");
  uPixelScale = ctx.getUniformLocation(p, "uPixelScale");
  uOpacity = ctx.getUniformLocation(p, "uOpacity");
  uAtlas = ctx.getUniformLocation(p, "uAtlas");
  vbo = ctx.createBuffer();
  initialized = true;
  cachedGl = ctx;
  // Fresh vbo/tex handles have no data; if re-initializing after a context
  // change, drop the stale state rather than draw from (or rebind onto) an
  // invalid handle. Re-staging the actual atlas/point data is out of scope
  // (matches footprints.ts's drawFootprints).
  vertexCount = 0;
  tex = null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function uploadAtlas(ctx: any, image: TexImageSource): void {
  if (!tex) { tex = ctx.createTexture(); }
  ctx.bindTexture(ctx.TEXTURE_2D, tex);
  ctx.pixelStorei(ctx.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, image);
  // Atlas is power-of-two on a side in the default build, but cells are packed
  // edge-to-edge — use CLAMP + LINEAR and skip mips to avoid bleed between cells.
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
}

/**
 * Build the interleaved VBO buffer from records + atlas layout. Positions are
 * derived HERE via the engine's Coordinates.raDecTo3dAu + ecliptic rotateX, so
 * the field matches the JWST markers exactly.
 */
function buildBuffer(records: CosmosWebRecord[], atlas: CosmosWebAtlas): ArrayBuffer {
  const cosE = Math.cos(ECLIPTIC_RAD);
  const sinE = Math.sin(ECLIPTIC_RAD);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coords = (Engine as any).Coordinates;
  const du = atlas.cellPx / atlas.atlasPxW;
  const dv = atlas.cellPx / atlas.atlasPxH;

  const buf = new ArrayBuffer(records.length * VERT_STRIDE);
  const f32 = new Float32Array(buf);
  const u8 = new Uint8Array(buf);
  const fPerRow = VERT_STRIDE / 4;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const au = rec.dly * LY_TO_AU;
    const v = coords.raDecTo3dAu(rec.raDeg / 15, rec.decDeg, au);
    const xR = v.x;
    const yR = v.y * cosE - v.z * sinE;
    const zR = v.y * sinE + v.z * cosE;

    const fo = i * fPerRow;
    const bo = i * VERT_STRIDE;
    f32[fo + 0] = xR;
    f32[fo + 1] = yR;
    f32[fo + 2] = zR;

    u8[bo + COLOR_OFFSET + 0] = rec.r;
    u8[bo + COLOR_OFFSET + 1] = rec.g;
    u8[bo + COLOR_OFFSET + 2] = rec.b;
    u8[bo + COLOR_OFFSET + 3] = rec.a;

    const col = rec.sprite % atlas.atlasCols;
    const row = Math.floor(rec.sprite / atlas.atlasCols);
    f32[fo + UVOFF_OFFSET / 4 + 0] = col * du;
    f32[fo + UVOFF_OFFSET / 4 + 1] = row * dv;
    f32[fo + UVSCALE_OFFSET / 4 + 0] = du;
    f32[fo + UVSCALE_OFFSET / 4 + 1] = dv;
  }
  return buf;
}

/**
 * Stage a field set (records + atlas) for rendering. GPU upload happens on the
 * next draw. Use this for reuse/tests; loadCosmosWebField calls it internally.
 */
export function installCosmosWebField(records: CosmosWebRecord[], atlas: CosmosWebAtlas): void {
  stagedBuffer = buildBuffer(records, atlas);
  stagedCount = records.length;
  stagedAtlasImage = atlas.image;
}

/** Field opacity, 0..1 (0 = hidden). */
export function setCosmosWebFieldOpacity(o: number): void {
  opacity = Math.max(0, Math.min(1, o));
}

/** Toggle visibility (1.0 / 0.0). */
export function setCosmosWebFieldVisible(visible: boolean): void {
  opacity = visible ? 1.0 : 0.0;
}

interface FieldHeader {
  count: number;
  cellPx: number;
  atlasCols: number;
  spriteCount: number;
}

function decodeBlob(buf: ArrayBuffer): { header: FieldHeader; records: CosmosWebRecord[] } {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "CWF1") {
    throw new Error(`[CosmosWebField] bad magic '${magic}'`);
  }
  const count = dv.getUint32(4, true);
  const cellPx = dv.getUint16(8, true);
  const atlasCols = dv.getUint16(10, true);
  const spriteCount = dv.getUint16(12, true);
  const records: CosmosWebRecord[] = new Array(count);
  let o = 16;
  for (let i = 0; i < count; i++) {
    records[i] = {
      raDeg: dv.getFloat32(o, true),
      decDeg: dv.getFloat32(o + 4, true),
      dly: dv.getFloat32(o + 8, true),
      r: dv.getUint8(o + 12),
      g: dv.getUint8(o + 13),
      b: dv.getUint8(o + 14),
      a: dv.getUint8(o + 15),
      sprite: dv.getUint16(o + 16, true),
    };
    o += 20;
  }
  return { header: { count, cellPx, atlasCols, spriteCount }, records };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`[CosmosWebField] failed to load ${url}`));
    img.src = url;
  });
}

/**
 * Fetch + decode + stage the field assets from `${baseUrl}/{field.bin,atlas.json,
 * atlas.<fmt>}`. Idempotent: returns the in-flight/settled promise on re-call.
 * Does NOT make the field visible — call setCosmosWebFieldVisible(true).
 */
export function loadCosmosWebField(baseUrl: string = DEFAULT_BASE_URL): Promise<void> {
  if (loadPromise) { return loadPromise; }
  const base = baseUrl.replace(/\/$/, "");
  loadPromise = (async () => {
    const meta = await fetch(`${base}/atlas.json`).then((r) => {
      if (!r.ok) { throw new Error(`[CosmosWebField] atlas.json ${r.status}`); }
      return r.json();
    });
    const blob = await fetch(`${base}/field.bin`).then((r) => {
      if (!r.ok) { throw new Error(`[CosmosWebField] field.bin ${r.status}`); }
      return r.arrayBuffer();
    });
    const fmt = meta.format === "webp" ? "webp" : "png";
    const image = await loadImage(`${base}/atlas.${fmt}`);

    const { records } = decodeBlob(blob);
    const atlas: CosmosWebAtlas = {
      cellPx: meta.cellPx,
      atlasCols: meta.atlasCols,
      atlasPxW: meta.atlasPxW,
      atlasPxH: meta.atlasPxH,
      spriteCount: meta.spriteCount,
      image,
    };
    installCosmosWebField(records, atlas);
  })();
  // Reset on failure so a later retry can re-fetch.
  loadPromise.catch(() => { loadPromise = null; });
  return loadPromise;
}

/**
 * Per-frame draw. Renders only in 3D (solar-system) mode when opacity > 0, so
 * it's a cheap no-op in 2D. Saves/restores the GL state it touches.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function drawCosmosWebField(renderContext: any): void {
  if (typeof window === "undefined") { return; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.__cwField === false) { return; }
  if (opacity <= 0 || !renderContext || !renderContext.gl) { return; }

  // 3D only — positions are real-AU vertices, meaningless under WWT's 2D
  // unit-sphere projection.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctl = (Engine.WWTControl as any).singleton;
  if (!(ctl && typeof ctl.get_solarSystemMode === "function" && ctl.get_solarSystemMode())) { return; }

  const ctx = renderContext.gl;
  // Cheap context-loss guard — see footprints.ts's drawFootprints for the
  // rationale (full recovery is out of scope).
  if (!initialized || cachedGl !== ctx) { init(ctx); }
  if (stagedBuffer) {
    ctx.bindBuffer(ctx.ARRAY_BUFFER, vbo);
    ctx.bufferData(ctx.ARRAY_BUFFER, stagedBuffer, ctx.STATIC_DRAW);
    vertexCount = stagedCount;
    stagedBuffer = null;
  }
  if (stagedAtlasImage) {
    uploadAtlas(ctx, stagedAtlasImage);
    stagedAtlasImage = null;
  }
  if (vertexCount === 0 || !prog || !vbo || !tex) { return; }

  // Save the GL state we touch.
  const oldProg = ctx.getParameter(ctx.CURRENT_PROGRAM);
  const oldArrBuf = ctx.getParameter(ctx.ARRAY_BUFFER_BINDING);
  const oldBlend = ctx.isEnabled(ctx.BLEND);
  const oldBlendSrc = ctx.getParameter(ctx.BLEND_SRC_RGB);
  const oldBlendDst = ctx.getParameter(ctx.BLEND_DST_RGB);
  const oldDepth = ctx.isEnabled(ctx.DEPTH_TEST);
  const oldDepthMask = ctx.getParameter(ctx.DEPTH_WRITEMASK);
  const oldActive = ctx.getParameter(ctx.ACTIVE_TEXTURE);
  // This draw always binds its texture on TEXTURE0 (below), so the binding it
  // actually clobbers is TEXTURE0's — snapshot that *after* switching, not
  // whatever unit happened to be active beforehand (matches galaxy-sprites.ts).
  ctx.activeTexture(ctx.TEXTURE0);
  const oldTex = ctx.getParameter(ctx.TEXTURE_BINDING_2D);

  ctx.useProgram(prog);

  // mv = world × view (WWT's Matrix3d row order).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mv = (Engine as any).Matrix3d.multiplyMatrix(renderContext.get_world(), renderContext.get_view());
  ctx.uniformMatrix4fv(uMV, false, mv.floatArray());
  ctx.uniformMatrix4fv(uProj, false, renderContext.get_projection().floatArray());

  const sizePx = (w.__cwSize as number | undefined) ?? DEFAULT_SIZE_PX;
  const dpr = window.devicePixelRatio || 1;
  ctx.uniform1f(uPixelScale, sizePx * dpr);
  ctx.uniform1f(uOpacity, opacity);

  ctx.activeTexture(ctx.TEXTURE0);
  ctx.bindTexture(ctx.TEXTURE_2D, tex);
  ctx.uniform1i(uAtlas, 0);

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
  if (aUVOffset >= 0) {
    ctx.enableVertexAttribArray(aUVOffset);
    ctx.vertexAttribPointer(aUVOffset, 2, ctx.FLOAT, false, VERT_STRIDE, UVOFF_OFFSET);
  }
  if (aUVScale >= 0) {
    ctx.enableVertexAttribArray(aUVScale);
    ctx.vertexAttribPointer(aUVScale, 2, ctx.FLOAT, false, VERT_STRIDE, UVSCALE_OFFSET);
  }

  ctx.enable(ctx.BLEND);
  if (w.__cwBlend === "additive") {
    ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE);
  } else {
    ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE_MINUS_SRC_ALPHA);
  }
  ctx.disable(ctx.DEPTH_TEST);
  ctx.depthMask(false);

  ctx.drawArrays(ctx.POINTS, 0, vertexCount);

  if (aPos >= 0) { ctx.disableVertexAttribArray(aPos); }
  if (aColor >= 0) { ctx.disableVertexAttribArray(aColor); }
  if (aUVOffset >= 0) { ctx.disableVertexAttribArray(aUVOffset); }
  if (aUVScale >= 0) { ctx.disableVertexAttribArray(aUVScale); }

  // Restore GL state.
  if (oldBlend) { ctx.enable(ctx.BLEND); } else { ctx.disable(ctx.BLEND); }
  ctx.blendFunc(oldBlendSrc, oldBlendDst);
  if (oldDepth) { ctx.enable(ctx.DEPTH_TEST); } else { ctx.disable(ctx.DEPTH_TEST); }
  ctx.depthMask(oldDepthMask);
  // Rebind TEXTURE0's original binding while still on TEXTURE0, then switch
  // back to whatever unit was active before this draw.
  ctx.bindTexture(ctx.TEXTURE_2D, oldTex);
  ctx.activeTexture(oldActive);
  ctx.bindBuffer(ctx.ARRAY_BUFFER, oldArrBuf);
  ctx.useProgram(oldProg);
}
