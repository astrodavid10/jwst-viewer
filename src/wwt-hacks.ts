// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

/* eslint-disable */

import {
  CameraParameters, Color, Colors, Constellations, Coordinates, Grids,
  LayerManager, LayerMap, Matrix3d, PushPin, RenderContext, Settings, SimpleLineShader, SpaceTimeController,
  SpreadSheetLayer, Text3d, Text3dBatch, TextShader, Texture, URLHelpers,
  Vector3d, WWTControl
} from "@wwtelescope/engine";

// Custom glow-disc renderer for the JWST 3D markers (ported/trimmed from exo's
// exoplanet-renderer). layerManagerDraw calls drawMarkerCloud on the Sky-frame
// pass; it's a cheap no-op outside 3D mode.
import { drawMarkerCloud, setMarkerCloudZoomFade } from "./marker-renderer";
// Optional COSMOS-Web galaxy field (off by default, toggled in the viewer).
import { drawCosmosWebField } from "./cosmosweb-field";
// 2D image-footprint outlines (off by default, toggled in the viewer). Cheap
// no-op in 3D / when hidden.
import { drawFootprints } from "./footprints";
// Milky Way frame (single source of truth for the planar-image transform) and
// the Galaxy3D v3 slice stack (h=0 base plane + volume slices), which replaces
// WWT's own galaxy-image quad while active.
import { MW_ANGLE_SCALE, imageUnitsToWorld } from "./galaxy-frame";
import { drawGalaxyEnsemble, ensembleHandlesBasePlane } from "./galaxy3d";

// ── Constellation figure fade ─────────────────────────────────────────────────
// WWT's SimpleLineShader hardcodes alpha=1 for sky lines. We patch it once here
// to re-set the alpha uniform whenever a constellation draw is in flight.
const CONSTELLATION_FADE_MS = 400;
// 3D figures look too bright at full opacity once they're projected onto real
// star positions; dim them so they sit visually behind the exoplanet field.
const CONSTELLATION_3D_OPACITY = 0.35;
let _consFigAnimStart = 0;
let _consFigAlphaFrom = 0;
let _consFigAlphaTo = 0;
let _consFigAlpha = 0;     // current animated value, read each frame in drawSkyOverlays
let _inConsDraw = false;   // flag set only during constellationsFigures.draw()
let _consUserTarget = 0;   // last user-requested target (0 or 1), before mode dimming

function _modeDimFactor(): number {
  const ctl = WWTControl.singleton;
  const is3D = ctl && typeof ctl.get_solarSystemMode === 'function' && ctl.get_solarSystemMode();
  return is3D ? CONSTELLATION_3D_OPACITY : 1.0;
}

function _retargetConsAlpha() {
  _consFigAnimStart = performance.now();
  _consFigAlphaFrom = _consFigAlpha;
  _consFigAlphaTo = _consUserTarget * _modeDimFactor();
}

export function setConstellationFiguresTarget(target: number) {
  _consUserTarget = target;
  _retargetConsAlpha();
}

// Re-apply the current user target with the active mode's dim factor.
// Call after a 2D↔3D switch so the displayed alpha smoothly retargets
// (e.g. 1.0 → 0.7 going 2D→3D when constellations are on).
export function notifyConstellationModeChange() {
  _retargetConsAlpha();
}

Settings.get_globalSettings().set_constellationFigureColor('Color:255:100:180:255');

// ── 2D figure pop-in fix ─────────────────────────────────────────────────────
// Constellations.draw sets Constellations._maxSeperation =
//   max(0.6, cos(fovAngle*2)), and _drawSingleConstellation early-returns when
// dot(viewPoint, centroid) < _maxSeperation. The result: as the user pans,
// new figures pop in at full _consFigAlpha instead of fading.
//
// Fix: neutralize _maxSeperation for the duration of each _drawSingleConstellation
// call so the cull never fires. All 88 figures draw every frame; at 2D zoom
// levels this is only a few thousand line segments — trivial GPU cost, and the
// per-constellation line list is built lazily on first draw then cached on the
// instance, so subsequent frames just rebind the existing vertex buffers.
// Labels don't have a software cull (single Text3dBatch.draw) so this fix only
// needs to touch the figure path.
const _origDrawSingleConstellation = (Constellations as any).prototype._drawSingleConstellation;
function _patchedDrawSingleConstellation(renderContext, ls, opacity) {
  const saved = (Constellations as any)._maxSeperation;
  (Constellations as any)._maxSeperation = -2; // dot ∈ [-1, 1] is always ≥ -2
  try {
    _origDrawSingleConstellation.call(this, renderContext, ls, opacity);
  } finally {
    (Constellations as any)._maxSeperation = saved;
  }
}

const _origSimpleLineShaderUse = SimpleLineShader.use;
function _patchedSimpleLineShaderUse(renderContext, vertex, lineColor, useDepth) {
  _origSimpleLineShaderUse.call(this, renderContext, vertex, lineColor, useDepth);
  if (_inConsDraw && renderContext.gl && SimpleLineShader.lineColorLoc != null) {
    renderContext.gl.uniform4f(
      SimpleLineShader.lineColorLoc,
      lineColor.r / 255, lineColor.g / 255, lineColor.b / 255,
      _consFigAlpha
    );
  }
}

// WWT's TextShader fragment shader is `gl_FragColor = texture2D(...)` with no
// opacity uniform, so the `opacity` arg to Text3dBatch.draw is ignored on the
// WebGL path. Constellation label fade therefore doesn't work out of the box.
// We compile a parallel program with a uOpacity uniform and bind it in place
// of WWT's program only while _inConsDraw is true (i.e. only for the names
// batch). All other Text3dBatch callers (grid labels, planet text, …) are
// unaffected.
let _consTextProg: WebGLProgram | null = null;
let _consTextProgLocs: {
  vert: number; tex: number;
  mv: WebGLUniformLocation | null; proj: WebGLUniformLocation | null;
  samp: WebGLUniformLocation | null; opacity: WebGLUniformLocation | null;
} | null = null;

function _ensureConsTextProg(gl: WebGLRenderingContext) {
  if (_consTextProg) return;
  const vertSrc =
    'attribute vec3 aVertexPosition;\n' +
    'attribute vec2 aTextureCoord;\n' +
    'uniform mat4 uMVMatrix;\n' +
    'uniform mat4 uPMatrix;\n' +
    'varying vec2 vTextureCoord;\n' +
    'void main(void) {\n' +
    '  gl_Position = uPMatrix * uMVMatrix * vec4(aVertexPosition, 1.0);\n' +
    '  vTextureCoord = aTextureCoord;\n' +
    '}\n';
  const fragSrc =
    'precision mediump float;\n' +
    'varying vec2 vTextureCoord;\n' +
    'uniform sampler2D uSampler;\n' +
    'uniform float uOpacity;\n' +
    'void main(void) {\n' +
    '  vec4 c = texture2D(uSampler, vTextureCoord);\n' +
    '  gl_FragColor = vec4(c.rgb, c.a * uOpacity);\n' +
    '}\n';
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, vertSrc); gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, fragSrc); gl.compileShader(fs);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  _consTextProg = prog;
  _consTextProgLocs = {
    vert: gl.getAttribLocation(prog, 'aVertexPosition'),
    tex: gl.getAttribLocation(prog, 'aTextureCoord'),
    mv: gl.getUniformLocation(prog, 'uMVMatrix'),
    proj: gl.getUniformLocation(prog, 'uPMatrix'),
    samp: gl.getUniformLocation(prog, 'uSampler'),
    opacity: gl.getUniformLocation(prog, 'uOpacity'),
  };
}

const _origTextShaderUse = TextShader.use;
function _patchedTextShaderUse(renderContext, vertex, texture) {
  if (!_inConsDraw || !renderContext.gl) {
    return _origTextShaderUse.call(this, renderContext, vertex, texture);
  }
  const gl = renderContext.gl as WebGLRenderingContext;
  _ensureConsTextProg(gl);
  const locs = _consTextProgLocs!;
  gl.useProgram(_consTextProg);
  // Matrix3d is exposed globally by the WWT engine at runtime (see CLAUDE.md
  // note on the layerManagerDraw implicit-Matrix3d caveat).
  const mvMat = Matrix3d.multiplyMatrix(renderContext.get_world(), renderContext.get_view());
  gl.uniformMatrix4fv(locs.mv, false, mvMat.floatArray());
  gl.uniformMatrix4fv(locs.proj, false, renderContext.get_projection().floatArray());
  gl.uniform1i(locs.samp, 0);
  gl.uniform1f(locs.opacity, _consFigAlpha);
  if (renderContext.space) gl.disable(gl.DEPTH_TEST);
  else gl.enable(gl.DEPTH_TEST);
  gl.disableVertexAttribArray(0);
  gl.disableVertexAttribArray(1);
  gl.disableVertexAttribArray(2);
  gl.disableVertexAttribArray(3);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertex);
  gl.enableVertexAttribArray(locs.vert);
  gl.enableVertexAttribArray(locs.tex);
  gl.vertexAttribPointer(locs.vert, 3, gl.FLOAT, false, 20, 0);
  gl.vertexAttribPointer(locs.tex, 2, gl.FLOAT, false, 20, 12);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

// ── Tile sharpness ────────────────────────────────────────────────────────────
// TILE_QUALITY_SCALE > 1 makes isTileBigEnough() recurse into finer tile levels
// by dividing the apparent fovScale (arcsec/pixel). Value of 2 = one extra level
// on every screen. Raise to 4 for two extra levels (heavier network load).
// This is orthogonal to the physical-canvas patch below: TILE_QUALITY_SCALE
// requests extra depth on top of whatever the physical pixel count warrants.
// Safe: WWT silently caps at the deepest available level, so over-requesting
// a level the server lacks is harmless.
export const TILE_QUALITY_SCALE = 4;

const _origGetFovScale = RenderContext.prototype.get_fovScale;
function _patchedGetFovScale() {
  return _origGetFovScale.call(this) / TILE_QUALITY_SCALE;
}

// Compensate pan sensitivity: move() uses get_fovScale() to convert pixel
// deltas to sky angle. In solar-system/3D mode the scale is hardcoded to 0.06
// (unaffected by get_fovScale), so only multiply back in sky/2D mode.
const _origMove = WWTControl.prototype.move;
function _patchedMove(x, y) {
  if (this.get_solarSystemMode() || this.get_planetLike()) {
    _origMove.call(this, x, y);
  } else {
    _origMove.call(this, x * TILE_QUALITY_SCALE, y * TILE_QUALITY_SCALE);
  }
}

// ── P3.6: Distance-driven 3D visibility (cosmos fade-in / marker fade-to-floor) ─
// Close-in 3D (near the Milky Way / marker field): JWST markers render at full
// strength and WWT's SDSS "cosmos" point cloud stays off. Zooming far out past
// the Milky Way ensemble fade (MW_FADE_* further down this file) smoothly
// brings in the all-sky cosmos while the JWST markers fade toward a floor so
// they don't clutter that full-cosmos view. Both transitions share one
// smoothstep band positioned just past the MW_FADE_* band (18.6–20.9 in
// ln(zoom); see below) so the choreography reads: close = markers only, mid =
// Milky Way appears, far = cosmos in / markers floored.
//
// Threshold values are ln(zoom) (natural log), matching the MW_FADE_* and
// _consFigAlpha-style constants elsewhere in this file — WWT's "zoom" spans
// many orders of magnitude, so tuning in log space is the usable knob.
const COSMOS_ZOOM_ON = 21.0;    // ln(zoom) where the cosmos starts fading in / markers start dropping
const COSMOS_ZOOM_RANGE = 2.3;  // ln(zoom) width of the fade band (~1 decade, same convention as MW_FADE_RANGE)
const MARKER_FAR_FLOOR = 0.15;  // marker opacity floor at the far end of the band

function _smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Shared "how far zoomed out" fraction (0 = close-in/below the band, 1 = fully
// past it) for a given zoom, honoring the live-tunable knob when present.
function _farZoomFadeT(zoom: number): number {
  const w = window as any;
  const lo = typeof w.__cosmosZoomOn === 'number' ? w.__cosmosZoomOn : COSMOS_ZOOM_ON;
  return _smoothstep(lo, lo + COSMOS_ZOOM_RANGE, Math.log(Math.max(1, zoom)));
}

// Grids.drawCosmos3D has its own internal zoom→alpha curve (`distAlpha`, log
// base 4, effectively ln(zoom) ≈ 21.5–25.4, engine index.js:26930) hardcoded
// deep in the engine — a plain linear ramp with a hard early-return below its
// floor, not smoothstep-shaped, and not under our control. Rather than
// compound two independent curves (ours × the engine's), this patch fully
// replaces drawCosmos3D's body with a version that draws the SAME prefetched
// sprites/textures (Grids._cosmosSprites / Grids._galaxyTextures — populated
// by prefetchCosmos() during 2D idle time, with the identical lazy-init
// fallback below in case 3D is entered before the prefetch timer fires) at
// OUR smoothstep opacity instead. No new network activity — just an alpha
// swap on the same draw loop the engine already runs, which is about as cheap
// as this toggle gets.
//
// Ordering note: the engine calls Grids.drawCosmos3D from
// WWTControl.prototype.renderOneFrame's solar-system branch BEFORE it calls
// LayerManager._draw for the Sky frame (our layerManagerDraw hook below) in
// the same render pass (engine index.js:67357 vs. :67373) — so this patch
// reads renderContext.viewCamera.zoom directly rather than consuming a value
// stashed by the Sky-frame hook, which would lag one frame behind on fast
// zooms. The marker floor (part b of P3.6) has no such ordering constraint
// and is computed directly in layerManagerDraw, right at the drawMarkerCloud()
// call site.
const _origDrawCosmos3D = Grids.drawCosmos3D;
function _patchedDrawCosmos3D(renderContext, _opacity) {
  const ctl = WWTControl.singleton;
  if (!(ctl && typeof ctl.get_solarSystemMode === 'function' && ctl.get_solarSystemMode())) return;
  const t = _farZoomFadeT(renderContext.viewCamera.zoom);
  if (t <= 0.002) return;
  // Same lazy-init the original performs (normally already satisfied by
  // prefetchCosmos() well before 3D is ever entered).
  Grids.initCosmosVertexBuffer();
  if (Grids._galaxyTextures == null && Grids._largeSet) {
    Grids._galaxyTextures = new Array(256);
    for (let i = 0; i < 256; i++) {
      const num = i.toString().padStart(4, '0');
      Grids._galaxyTextures[i] = Texture.fromUrl(
        URLHelpers.singleton.engineAssetUrl('galimg/gal_' + num + '.jpg'));
    }
  }
  if (Grids._cosmosReady) {
    for (let i = 0; i < 256; i++) {
      Grids._cosmosSprites[i].drawTextured(renderContext, Grids._galaxyTextures[i].texture2d, t);
    }
  }
}

// Debug/verification helper (harmless to reassign on module re-eval — same
// pattern as __gxSpriteInfo etc.): read the live P3.6 fade state for a given
// or current zoom, without needing pixel sampling.
if (typeof window !== 'undefined') {
  (window as any).__zoomFadeInfo = function (zoomOverride?: number) {
    const ctl = WWTControl.singleton;
    const zoom = zoomOverride ?? ctl?.renderContext?.viewCamera?.zoom;
    if (zoom == null) return null;
    const w = window as any;
    const t = _farZoomFadeT(zoom);
    const floor = typeof w.__markerFarFloor === 'number' ? w.__markerFarFloor : MARKER_FAR_FLOOR;
    return {
      zoom,
      lnZoom: Math.log(Math.max(1, zoom)),
      cosmosOpacity: t,
      markerFadeFactor: 1 - t * (1 - floor),
    };
  };
}

// ── Install the patches above (double-eval guard) ────────────────────────────
// Everything above this point only captures originals and defines wrapper
// closures — cheap and side-effect-free even if re-run. The actual
// prototype/static ASSIGNMENTS happen only here, gated by a sentinel on
// `window`. Without this guard, a second evaluation of this module (HMR,
// duplicated chunk, etc.) would capture the ALREADY-PATCHED methods as
// "originals" and wrap them again — e.g. `get_fovScale` divides by
// TILE_QUALITY_SCALE once; double-wrapped it would divide by
// TILE_QUALITY_SCALE² (÷16 instead of ÷4), and the other four wrappers would
// each run their extra logic (constellation cull neutralization, line/text
// shader alpha, pan-speed compensation) twice per call. The sixth entry
// (drawCosmos3D, P3.6) fully replaces the engine's method rather than
// wrapping it, but the same double-install hazard applies: re-running the
// assignment is harmless (it just reassigns the same function reference), so
// it's included in this guarded block purely for consistency with the rest.
if (!(window as any).__wwtHacksInstalled) {
  (Constellations as any).prototype._drawSingleConstellation = _patchedDrawSingleConstellation;
  SimpleLineShader.use = _patchedSimpleLineShaderUse;
  TextShader.use = _patchedTextShaderUse;
  RenderContext.prototype.get_fovScale = _patchedGetFovScale;
  WWTControl.prototype.move = _patchedMove;
  Grids.drawCosmos3D = _patchedDrawCosmos3D;
  (window as any).__wwtHacksInstalled = true;
}

// ── Physical-pixel canvas for HiDPI dot/circle sharpness ─────────────────────
// WWT sizes its WebGL canvas in CSS pixels and keeps renderContext.width/height
// in CSS pixels too. On HiDPI displays (DPR > 1) the GL framebuffer is at CSS
// resolution and then upscaled by the browser — making dot edges blurry.
//
// This function (call once after WWTControl initialises) installs two shims:
//
//   canvas.width / canvas.height  (instance property, shadows prototype)
//     getter → returns CSS size, so WWT's every-frame resize check
//              (canvas.width !== parentNode.clientWidth) never triggers a reset
//     setter → stores physical size in the actual canvas buffer;
//              also updates canvas.style.width/height so the browser still
//              displays at CSS size rather than the larger physical size
//
//   renderContext.width / renderContext.height  (instance property)
//     renderOneFrame does:  renderContext.width = canvas.width  (CSS via getter)
//     Our setter multiplies by DPR, so WWT uses physical dims for the GL viewport
//     and fovScale = (fovAngle / physicalHeight) × 3600 (correct for HiDPI).
//     The TILE_QUALITY_SCALE patch then adds extra depth on top.
//
// Coordinate impact: findScreenPointForRADec() returns physical pixels;
// findRADecForScreenPoint() expects physical pixels. Callers must scale by DPR.
// See SCREEN_DPR usages in exo-sonification.vue.
//
// To revert: remove this function, its call in mounted(), and the SCREEN_DPR
// coordinate scaling in closestInView() and spawnPing().
// NOTE: not wired; remove or wire before release (this app has no mounted()
// call site or SCREEN_DPR scaling — those references above are from the
// exo-sonification app this was ported from).
export function installHiDpiCanvas() {
  const dpr = window.devicePixelRatio ?? 1;
  if (dpr <= 1) return;

  const ctl = WWTControl.singleton;
  const canvas = ctl.canvas;
  const rc = ctl.renderContext;

  // Canvas property shim
  const canvasProto = HTMLCanvasElement.prototype;
  const origW = Object.getOwnPropertyDescriptor(canvasProto, 'width')!;
  const origH = Object.getOwnPropertyDescriptor(canvasProto, 'height')!;

  Object.defineProperty(canvas, 'width', {
    get(): number { return Math.round(origW.get!.call(this) / dpr); },
    set(cssW: number) {
      origW.set!.call(this, Math.round(cssW * dpr));
      (this as HTMLCanvasElement).style.width = cssW + 'px';
    },
    configurable: true,
  });
  Object.defineProperty(canvas, 'height', {
    get(): number { return Math.round(origH.get!.call(this) / dpr); },
    set(cssH: number) {
      origH.set!.call(this, Math.round(cssH * dpr));
      (this as HTMLCanvasElement).style.height = cssH + 'px';
    },
    configurable: true,
  });

  // renderContext property shim
  let _rcW = Math.round((rc.width || canvas.clientWidth) * dpr);
  let _rcH = Math.round((rc.height || canvas.clientHeight) * dpr);
  Object.defineProperty(rc, 'width', {
    get(): number { return _rcW; },
    set(cssW: number) { _rcW = Math.round(cssW * dpr); },
    configurable: true,
  });
  Object.defineProperty(rc, 'height', {
    get(): number { return _rcH; },
    set(cssH: number) { _rcH = Math.round(cssH * dpr); },
    configurable: true,
  });

  // Force initial physical sizing
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}

export function zoom(factor: number) {
  this.renderContext.targetCamera.zoom *= factor;
  if (this.renderContext.targetCamera.zoom > this.get_zoomMax()) {
    this.renderContext.targetCamera.zoom = this.get_zoomMax();
  }
  if (this.renderContext.targetCamera.zoom < this.get_zoomMin()) {
    this.renderContext.targetCamera.zoom = this.get_zoomMin();
  }

  if (!Settings.get_globalSettings().get_smoothPan()) {
    this.renderContext.viewCamera = this.renderContext.targetCamera.copy();
  }
}

export function drawSkyOverlays() {
  // Advance the fade animation FIRST so 3D drawing (which happens later in the
  // frame, from the patched Grids.drawStars3D) sees the up-to-date alpha.
  const t = Math.min(1, (performance.now() - _consFigAnimStart) / CONSTELLATION_FADE_MS);
  _consFigAlpha = _consFigAlphaFrom + (_consFigAlphaTo - _consFigAlphaFrom) * t;

  // In solar-system (3D) mode the 2D sky-sphere overlays are wrong: this
  // function runs under the 100000× sky-sphere matrix and would re-project
  // figures back onto a sphere. Real 3D figures are drawn from the
  // Grids.drawStars3D hook below, where the world matrix is set for absolute
  // AU positions. Labels are skipped in 3D entirely (per design).
  const ctl = WWTControl.singleton;
  if (ctl && typeof ctl.get_solarSystemMode === 'function' && ctl.get_solarSystemMode()) {
    return;
  }

  if (_consFigAlpha > 0) {
    // Wrap the names + figures draws with _inConsDraw so the patched
    // TextShader.use binds the opacity-aware program for label fade and the
    // patched SimpleLineShader.use applies _consFigAlpha to figure lines.
    // try/finally ensures the flag is cleared even if a draw throws — a stuck
    // `true` would silently fade unrelated text/lines in subsequent frames.
    _inConsDraw = true;
    try {
      Constellations.drawConstellationNames(this.renderContext, _consFigAlpha, Colors.get_yellow());
      if (WWTControl.constellationsFigures == null) {
        WWTControl.constellationsFigures = Constellations.create('Constellations', URLHelpers.singleton.engineAssetUrl('figures.txt'), false, false, false);
      }
      WWTControl.constellationsFigures.draw(this.renderContext, false, 'UMA', false);
    } finally {
      _inConsDraw = false;
    }
  }
  if (Settings.get_active().get_showAltAzGrid()) {
    const altAzColor = Color.fromArgb(1, 3, 92, 134);
    Grids.drawAltAzGrid(this.renderContext, 1, altAzColor);
    if (Settings.get_active().get_showAltAzGridText()) {
      Grids.drawAltAzGridText(this.renderContext, 1, altAzColor);
    }
  }
}

export function initializeConstellationNames() {
  if (Constellations.constellationCentroids == null) {
    return;
  }
  const textSize = 50;
  Constellations._namesBatch = new Text3dBatch(textSize);
  Object.keys(Constellations.constellationCentroids).forEach(key => {
    const centroid = Constellations.constellationCentroids[key];
    const center = Coordinates.raDecTo3dAu(centroid.get_RA(), centroid.get_dec(), 1);
    const up = Vector3d.create(0, 1, 0);
    let name = centroid.get_name();
    if (centroid.get_name() === 'Triangulum Australe') {
      name = name.replace(" ", "\n   ");
    }
    Constellations._namesBatch.add(new Text3d(center, up, name, textSize, 0.000125));
  });
};

export function makeAltAzGridText() {
  if (Grids._altAzTextBatch == null) {
    const glyphHeight = 70;
    Grids._altAzTextBatch = new Text3dBatch(glyphHeight);
    const sign = SpaceTimeController.get_location().get_lat() < 0 ? -1 : 1;
    const alt = 0.03 * sign;
    const up = Vector3d.create(0, sign, 0);
    const directions = [
      [[0, alt, -1], "N"],
      [[-1, alt, 0], "E"],
      [[0, alt, 1], "S"],
      [[1, alt, -0.0095], "V"],
      [[1, alt, 0.0095], "V"]
    ]
    directions.forEach(([v, text]) => {
      Grids._altAzTextBatch.add(new Text3d(Vector3d.create(...v), up, text, 75, 0.00018));
    });
  }
}

export function drawSpreadSheetLayer(renderContext, opacity, flat) {
  // (JWST: no exoplanet short-circuit — every spreadsheet layer, including the
  // JWST 3D marker layer, renders through the standard path below. The override
  // is kept because it honors get_showFarSide()/get_markerScale() for the point
  // pass, which the marker layer relies on.)
  var device = renderContext;
  if (this.version !== this.lastVersion) {
    this.cleanUp();
  }
  this.lastVersion = this.version;
  if (this.bufferIsFlat !== flat) {
    this.cleanUp();
    this.bufferIsFlat = flat;
  }
  if (this.dirty) {
    this.prepVertexBuffer(device, opacity);
  }
  var jNow = SpaceTimeController.get_jNow() - SpaceTimeController.utcToJulian(this.baseDate);
  var adjustedScale = this.scaleFactor * 3;
  if (flat && this.astronomical && (this._markerScale$1 === 1)) {
    adjustedScale = (this.scaleFactor / (renderContext.viewCamera.zoom / 360));
  }
  if (this.triangleList2d != null) {
    this.triangleList2d.decay = this.decay;
    this.triangleList2d.sky = this.get_astronomical();
    this.triangleList2d.timeSeries = this.timeSeries;
    this.triangleList2d.jNow = jNow;
    this.triangleList2d.draw(renderContext, opacity * this.get_opacity(), 1);
  }
  if (this.triangleList != null) {
    this.triangleList.decay = this.decay;
    this.triangleList.sky = this.get_astronomical();
    this.triangleList.timeSeries = this.timeSeries;
    this.triangleList.jNow = jNow;
    this.triangleList.draw(renderContext, opacity * this.get_opacity(), 1);
  }
  if (this.pointList != null) {
    this.pointList.depthBuffered = false;
    this.pointList.showFarSide = this.get_showFarSide();
    this.pointList.decay = (this.timeSeries) ? this.decay : 0;
    this.pointList.sky = this.get_astronomical();
    this.pointList.timeSeries = this.timeSeries;
    this.pointList.jNow = jNow;
    this.pointList.scale = (this._markerScale$1 === 1) ? adjustedScale : -adjustedScale;
    switch (this._plotType$1) {
      case 0:
        this.pointList.draw(renderContext, opacity * this.get_opacity(), false);
        break;
      case 2:
        this.pointList.drawTextured(renderContext, SpreadSheetLayer.get__circleTexture$1().texture2d, opacity * this.get_opacity());
        break;
      case 1:
        this.pointList.drawTextured(renderContext, PushPin.getPushPinTexture(19), opacity * this.get_opacity());
        break;
      case 3:
        this.pointList.drawTextured(renderContext, PushPin.getPushPinTexture(35), opacity * this.get_opacity());
        break;
      case 5:
      case 4:
        this.pointList.drawTextured(renderContext, PushPin.getPushPinTexture(this._markerIndex$1), opacity * this.get_opacity());
        break;
      default:
        break;
    }
  }
  if (this.lineList != null) {
    this.lineList.sky = this.get_astronomical();
    this.lineList.decay = this.decay;
    this.lineList.timeSeries = this.timeSeries;
    this.lineList.jNow = jNow;
    this.lineList.drawLines(renderContext, opacity * this.get_opacity());
  }
  if (this.lineList2d != null) {
    this.lineList2d.sky = this.get_astronomical();
    this.lineList2d.decay = this.decay;
    this.lineList2d.timeSeries = this.timeSeries;
    this.lineList2d.showFarSide = this.get_showFarSide();
    this.lineList2d.jNow = jNow;
    this.lineList2d.drawLines(renderContext, opacity * this.get_opacity());
  }
  return true;
}

// ── Cosmos (SDSS galaxies) prefetch ───────────────────────────────────────────
// WWT lazily kicks off BOTH cosmos downloads on the FIRST 3D cosmos frame:
// the galaxy binary (catalog.aspx?Q=cosmosnewbin → 256 PointList buckets) and
// 256 separate bucket sprite textures (galimg/gal_0000.jpg … gal_0255.jpg).
// drawCosmos3D only renders a bucket once its texture has arrived, so the
// galaxies trickle in bucket-by-bucket for many seconds after entering 3D.
// Prefetching both during quiet 2D time makes the first 3D entry instant.
// The delay lets the WTML + gallery thumbnails win the network first.
export function prefetchCosmos(delayMs = 6000) {
  setTimeout(() => {
    try {
      // Galaxy position binary; on arrival the engine builds the 256 buckets.
      Grids.initCosmosVertexBuffer();
      // Bucket textures, exactly as drawCosmos3D would create them
      // (_largeSet is statically true in the web engine).
      if (Grids._galaxyTextures == null && Grids._largeSet) {
        Grids._galaxyTextures = new Array(256);
        for (let i = 0; i < 256; i++) {
          const num = i.toString().padStart(4, '0');
          Grids._galaxyTextures[i] = Texture.fromUrl(
            URLHelpers.singleton.engineAssetUrl('galimg/gal_' + num + '.jpg'));
        }
      }
    } catch (e) {
      console.warn('[prefetchCosmos] failed (3D will lazy-load as before):', e);
    }
  }, delayMs);
}

// ── Milky Way texture fade + size override ────────────────────────────────────
// WWT computes: opacity = clamp((log(zoom) - FADE_ZERO) / FADE_RANGE, 0, 1)
// Stock values: FADE_ZERO = 17.9, FADE_RANGE = 2.3
const MW_FADE_ZERO   = 18.6;  // ← raise to fade out sooner when zooming in
const MW_FADE_RANGE  = 2.3;   // ← widen for a softer fade
// MW_ANGLE_SCALE (now in galaxy-frame.ts) expands the ±64° lat/lng quad extents
// built by _createGalaxyImage. The camera sits at the origin so world-matrix
// scaling has no angular effect; we instead rebuild the GL vertex buffer with a
// larger angular footprint. The position/scale/rotation math lives in
// galaxy-frame.ts:imageUnitsToWorld so the Galaxy3D slices share it exactly.

let _galaxyVertexBufferPatched = false;

function _patchGalaxyVertexBuffer(renderContext) {
  if (!Grids._galaxyImageVertexBuffer) return;
  const subdivs  = 50;
  const ecliptic = Coordinates.meanObliquityOfEcliptic(SpaceTimeController.get_jNow()) / 180 * Math.PI;
  const step     = 1 / subdivs;
  const data     = new Float32Array((subdivs + 1) * (subdivs + 1) * 5);
  for (let y1 = 0; y1 <= subdivs; y1++) {
    // Original WWT formula: latMin=64, latMax=-64, latDegrees=-128
    // → lat runs from -64 at y1=0 to +64 at y1=50.  Mirror exactly, scaled.
    const lat = (-64 + 128 * y1 * step) * MW_ANGLE_SCALE;
    for (let x1 = 0; x1 <= subdivs; x1++) {
      const lng = (-64 + 128 * x1 * step) * MW_ANGLE_SCALE;
      const pt  = imageUnitsToWorld(lng, lat, 0, ecliptic);
      const vi = (y1 * (subdivs + 1) + x1) * 5;
      data[vi]     = pt.x;
      data[vi + 1] = pt.y;
      data[vi + 2] = pt.z;
      data[vi + 3] = 1 - x1 * step;  // u  (matches original)
      data[vi + 4] = y1 * step;       // v  (matches original)
    }
  }
  const gl = renderContext.gl;
  gl.bindBuffer(gl.ARRAY_BUFFER, Grids._galaxyImageVertexBuffer.vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

const _origDrawGalaxyImage = Grids.drawGalaxyImage;
export function drawGalaxyImage(renderContext, _opacity) {
  const zoom    = renderContext.viewCamera.zoom;
  const opacity = Math.min(1, Math.max(0, (Math.log(zoom) - MW_FADE_ZERO) / MW_FADE_RANGE));
  if (opacity > 0) {
    if (ensembleHandlesBasePlane()) {
      // Galaxy3D v3 stack: vignetted h=0 base plane (replaces WWT's square
      // quad) + volume slices, same zoom-fade opacity. Cheap no-op until the
      // Gaia texture has streamed in.
      drawGalaxyEnsemble(renderContext, opacity);
    } else {
      // Fallback (kill switch / shader link failure): WWT's original quad.
      _origDrawGalaxyImage.call(this, renderContext, opacity);
      if (!_galaxyVertexBufferPatched && Grids._galaxyImageVertexBuffer) {
        _patchGalaxyVertexBuffer(renderContext);
        _galaxyVertexBufferPatched = true;
      }
    }
  }
}

export function layerManagerDraw(renderContext, opacity, astronomical, referenceFrame, nested, cosmos) {
  if (!(referenceFrame in LayerManager.get_allMaps())) {
    return;
  }
  var thisMap = LayerManager.get_allMaps()[referenceFrame];
  // The Sky frame must always proceed even with zero layers: this app draws its
  // 3D markers (drawMarkerCloud), sky overlays, and 3D constellation figures off
  // the Sky-frame pass below, not off a layer. (The native marker SpreadSheetLayer
  // that used to keep this map non-empty was replaced by the custom renderer.)
  if (!thisMap.enabled || (referenceFrame !== 'Sky' && !thisMap.layers.length && !(thisMap.frame.showAsPoint || thisMap.frame.showOrbitPath))) {
    return;
  }
  var matOld = renderContext.get_world();
  var matOldNonRotating = renderContext.get_worldBaseNonRotating();
  var oldNominalRadius = renderContext.get_nominalRadius();
  if ((thisMap.frame.reference === 18 | thisMap.frame.reference === 18) === 1) {
    thisMap.computeFrame(renderContext);
    if (thisMap.frame.referenceFrameType !== 1 && thisMap.frame.referenceFrameType !== 2) {
      renderContext.set_world(Matrix3d.multiplyMatrix(thisMap.frame.worldMatrix, renderContext.get_world()));
    }
    else {
      renderContext.set_world(Matrix3d.multiplyMatrix(thisMap.frame.worldMatrix, renderContext.get_worldBaseNonRotating()));
    }
    renderContext.set_nominalRadius(thisMap.frame.meanRadius);
  }
  //console.log("========");
  for (const layer of LayerManager.get_allMaps()[referenceFrame].layers) {
    if (layer.enabled) {
      //console.log(layer);
      var layerStart = SpaceTimeController.utcToJulian(layer.get_startTime());
      var layerEnd = SpaceTimeController.utcToJulian(layer.get_endTime());
      var fadeIn = SpaceTimeController.utcToJulian(layer.get_startTime()) - ((layer.get_fadeType() === 1 || layer.get_fadeType() === 3) ? (layer.get_fadeSpan() / 864000000) : 0);
      var fadeOut = SpaceTimeController.utcToJulian(layer.get_endTime()) + ((layer.get_fadeType() === 2 || layer.get_fadeType() === 3) ? (layer.get_fadeSpan() / 864000000) : 0);
      if (SpaceTimeController.get_jNow() > fadeIn && SpaceTimeController.get_jNow() < fadeOut) {
        var fadeOpacity = 1;
        if (SpaceTimeController.get_jNow() < layerStart) {
          fadeOpacity = ((SpaceTimeController.get_jNow() - fadeIn) / (layer.get_fadeSpan() / 864000000));
        }
        if (SpaceTimeController.get_jNow() > layerEnd) {
          fadeOpacity = ((fadeOut - SpaceTimeController.get_jNow()) / (layer.get_fadeSpan() / 864000000));
        }
        layer.set_astronomical(astronomical);
        layer.draw(renderContext, opacity * fadeOpacity, cosmos);
      }
    }
  }
  renderContext.set_nominalRadius(oldNominalRadius);
  renderContext.set_world(matOld);
  renderContext.set_worldBaseNonRotating(matOldNonRotating);

  // Custom glow-disc marker pass (3D only; cheap no-op otherwise). The world
  // matrix has been restored above, so we render in absolute-AU coords — which
  // is what the marker rows pre-compute (rotateX(ecliptic) baked in).
  if (referenceFrame === 'Sky') {
    drawFootprints(renderContext);      // 2D-only image footprints (no-op in 3D)
    drawCosmosWebField(renderContext);  // galaxy field first (behind the markers)

    // P3.6 (part b): fade the marker cloud toward a floor as the camera zooms
    // far out (see the COSMOS_ZOOM_ON/_farZoomFadeT block above, which drives
    // the matching cosmos fade-in via the patched Grids.drawCosmos3D). Gate on
    // 3D explicitly — this Sky-frame hook also runs in 2D, and
    // renderContext.viewCamera.zoom is only meaningful (and drawMarkerCloud
    // only draws) in solar-system mode. Never read curBackgroundImagesetName
    // here (the 3D-mode gotcha) — get_solarSystemMode() is the safe check.
    const ctlMarkerFade = WWTControl.singleton;
    const is3DMarkerFade = ctlMarkerFade && typeof ctlMarkerFade.get_solarSystemMode === 'function' && ctlMarkerFade.get_solarSystemMode();
    if (is3DMarkerFade) {
      const t = _farZoomFadeT(renderContext.viewCamera.zoom);
      const w = window as any;
      const floor = typeof w.__markerFarFloor === 'number' ? w.__markerFarFloor : MARKER_FAR_FLOOR;
      setMarkerCloudZoomFade(1 - t * (1 - floor));
    } else {
      setMarkerCloudZoomFade(1);
    }

    drawMarkerCloud(renderContext);
  }

  // WWT only calls _drawSkyOverlays() in 2D mode when showSolarSystem is true,
  // but this app disables that. Invoke it here whenever LayerManager draws the
  // Sky frame — nested is always true in WWT's call, so !nested would never fire.
  if (referenceFrame === 'Sky') {
    WWTControl.singleton._drawSkyOverlays();

    // 3D constellation figures: this LayerManager Sky-frame call fires in 3D
    // mode under the absolute-AU world matrix (same one used to render the
    // exoplanet layers), which is exactly what drawFigures3D needs. Hooking
    // here also avoids the Grids.drawStars3D gate — this app sets
    // solarSystemStars=false, so that hook would never fire.
    const ctl = WWTControl.singleton;
    const is3D = ctl && typeof ctl.get_solarSystemMode === 'function' && ctl.get_solarSystemMode();
    if (is3D && _consFigAlpha > 0) {
      _inConsDraw = true;
      try { drawFigures3D(renderContext); }
      finally { _inConsDraw = false; }
    }
  }
};

// ── 3D constellation figures ────────────────────────────────────────────────
// In solar-system (3D) mode, draw constellation figures by connecting the
// actual 3D positions of their member stars (from WWT's bundled Hipparcos
// catalog), instead of projecting endpoints onto the sky sphere. Most figures
// "shatter" visibly when seen from outside Earth because their constituent
// stars are at wildly different distances — Orion's belt spans ~700–2000 ly,
// while the Big Dipper's stars range from ~25 to ~125 pc.
//
// Match strategy: figures.txt endpoints carry only RA/Dec (sparse star names
// are free-text and unreliable), so each endpoint is matched to its nearest
// naked-eye Hipparcos star by angular separation within a tolerance. Falls
// back to a fixed-distance sphere projection if no candidate is close enough.
//
// Render hook: we patch Grids.drawStars3D rather than _drawSkyOverlays because
// _drawSkyOverlays runs under a 100000× sky-sphere world matrix, which would
// collapse our absolute-AU line endpoints back to a sphere. drawStars3D runs
// later in _drawSolarSystem with the world matrix set for real 3D positions —
// the same one that places the Hipparcos sprites we're connecting.

const FIG3D_MATCH_TOLERANCE_DEG = 2.5;
const FIG3D_MATCH_BRIGHT_MAG = 6.5;     // naked-eye limit for candidate stars
const FIG3D_FALLBACK_DIST_PC = 150;     // sphere radius for unmatched endpoints
const FIG3D_AU_PER_PC = 206264.806;

let _figures3dBuffer: WebGLBuffer | null = null;
let _figures3dVertexCount = 0;
let _figures3dBuilt = false;
let _figures3dLogged = false;

function _ensure3DConstellationsFigures(): boolean {
  if (WWTControl.constellationsFigures == null) {
    WWTControl.constellationsFigures = Constellations.create(
      'Constellations',
      URLHelpers.singleton.engineAssetUrl('figures.txt'),
      false, false, false
    );
  }
  return WWTControl.constellationsFigures.lines != null;
}

function _starsReadyForFigures3D(renderContext): boolean {
  if (Grids._stars == null) {
    // Triggers async getStarFile + downstream initStarVertexBuffer
    Grids.initStarVertexBuffer(renderContext);
    return false;
  }
  if (Grids._stars.length === 0) return false;
  // star.position is populated by initStarVertexBuffer once _starSprites builds.
  if (Grids._starSprites == null) {
    Grids.initStarVertexBuffer(renderContext);
  }
  return Grids._stars[0].position != null;
}

function _buildFigures3D(renderContext) {
  const lines = WWTControl.constellationsFigures.lines;

  // Candidate stars: bright and already 3D-positioned.
  const stars: any[] = [];
  for (const s of Grids._stars) {
    if (s.magnitude < FIG3D_MATCH_BRIGHT_MAG && s.position != null) {
      stars.push(s);
    }
  }

  // Pre-compute unit direction vectors for candidates. Any consistent
  // convention works for the angular-separation dot product — use raw ICRS
  // here; star.position (in the swapped/ecliptic-rotated frame) is used only
  // for emitting line geometry.
  const n = stars.length;
  const sUx = new Float64Array(n);
  const sUy = new Float64Array(n);
  const sUz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = stars[i];
    const a = s.RA * Math.PI / 12;
    const d = s.dec * Math.PI / 180;
    const cd = Math.cos(d);
    sUx[i] = Math.cos(a) * cd;
    sUy[i] = Math.sin(a) * cd;
    sUz[i] = Math.sin(d);
  }
  const minDot = Math.cos(FIG3D_MATCH_TOLERANCE_DEG * Math.PI / 180);
  const ecliptic = Coordinates.meanObliquityOfEcliptic(SpaceTimeController.get_jNow()) / 180 * Math.PI;
  const fallbackDistAU = FIG3D_FALLBACK_DIST_PC * FIG3D_AU_PER_PC;

  const verts: number[] = [];
  let totalEndpoints = 0, matched = 0;
  for (const lineset of lines) {
    let prevPos: any = null;
    for (const lp of lineset.points) {
      totalEndpoints++;
      const a = lp.RA * Math.PI / 12;
      const d = lp.dec * Math.PI / 180;
      const cd = Math.cos(d);
      const ux = Math.cos(a) * cd;
      const uy = Math.sin(a) * cd;
      const uz = Math.sin(d);

      let bestDot = -1, bestIdx = -1;
      for (let i = 0; i < n; i++) {
        const dot = ux * sUx[i] + uy * sUy[i] + uz * sUz[i];
        if (dot > bestDot) { bestDot = dot; bestIdx = i; }
      }

      let pos;
      if (bestDot >= minDot && bestIdx >= 0) {
        pos = stars[bestIdx].position;
        matched++;
      } else {
        // Same transform pipeline as star.position so frames match.
        pos = Coordinates.raDecTo3dAu(lp.RA, lp.dec, fallbackDistAU);
        pos.rotateX(ecliptic);
      }

      // Linepoint.pointType: 3=start, 0=move, 1=line, 2=dash. Emit a segment
      // for 1/2 only; 0/3 just advance the cursor.
      if (prevPos && (lp.pointType === 1 || lp.pointType === 2)) {
        verts.push(prevPos.x, prevPos.y, prevPos.z, pos.x, pos.y, pos.z);
      }
      prevPos = pos;
    }
  }

  if (!_figures3dLogged) {
    console.log(`[constellations3d] matched ${matched}/${totalEndpoints} endpoints to Hipparcos stars (tol ${FIG3D_MATCH_TOLERANCE_DEG}°, mag<${FIG3D_MATCH_BRIGHT_MAG}, ${n} candidates)`);
    _figures3dLogged = true;
  }

  const gl = renderContext.gl;
  _figures3dBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, _figures3dBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  _figures3dVertexCount = verts.length / 3;
  _figures3dBuilt = true;
}

// Eagerly drive the figures.txt + Hipparcos loads and build the 3D vertex
// buffer as soon as both are ready, without drawing anything. Calling this
// repeatedly (e.g. on a poll) until it returns true means the data is already
// in GPU memory by the time the user first toggles constellations on, so the
// fade-in animation is smooth from frame 1 instead of snapping to the current
// alpha when the async loads finally finish mid-fade. Safe to call in either
// 2D or 3D mode — only needs a live renderContext.gl.
export function prebuildFigures3D(renderContext): boolean {
  if (_figures3dBuilt) return true;
  if (!renderContext || !renderContext.gl) return false;
  if (!_ensure3DConstellationsFigures()) return false;
  if (!_starsReadyForFigures3D(renderContext)) return false;
  _buildFigures3D(renderContext);
  return _figures3dBuilt;
}

function drawFigures3D(renderContext) {
  if (!renderContext.gl) return;
  if (!_figures3dBuilt) {
    if (!_ensure3DConstellationsFigures()) return;
    if (!_starsReadyForFigures3D(renderContext)) return;
    _buildFigures3D(renderContext);
  }
  if (_figures3dVertexCount === 0) return;

  // Caller must set _inConsDraw=true so SimpleLineShader.use applies _consFigAlpha.
  const lineColor = Color.load(Settings.get_globalSettings().get_constellationFigureColor());
  SimpleLineShader.use(renderContext, _figures3dBuffer, lineColor, false);
  renderContext.gl.drawArrays(renderContext.gl.LINES, 0, _figures3dVertexCount);
}

// Note: drawFigures3D is invoked from layerManagerDraw above (Sky-frame branch
// in 3D mode), not via a Grids.drawStars3D wrapper — this app disables
// `solarSystemStars`, so the engine never calls drawStars3D and any wrapper
// there would be dead code.

export function ViewMoverSlewHacked() {
    this._upTargetTime = 0;
    this._downTargetTime = 0;
    this._toTargetTime = 0;
    this._upTimeFactor = 0.6;
    this._downTimeFactor = 0.6;
    this._travelTimeFactor = 7;
    this._midpointFired = false;
    this._complete = false;
}

ViewMoverSlewHacked.create = function (from, to, duration) {
    var temp = new ViewMoverSlewHacked();
    temp.init(from, to);
    if (duration) {
      const originalTargetTime = temp._toTargetTime;
      const upFraction = temp._upTargetTime / originalTargetTime;
      const downFraction = temp._downTargetTime / originalTargetTime;
      temp._upTargetTime = duration * upFraction;
      temp._downTargetTime = duration * downFraction;
      temp._toTargetTime = duration; 
    }
    return temp;
};

ViewMoverSlewHacked.createUpDown = function (from, to, upDowFactor) {
    var temp = new ViewMoverSlew();
    temp._upTimeFactor = temp._downTimeFactor = upDowFactor;
    temp.init(from.copy(), to.copy());
    return temp;
};

function logN(value, base) {
  return Math.log(value) / Math.log(base);
}

ViewMoverSlewHacked.prototype.init = function (from, to) {
    if (Math.abs(from.lng - to.lng) > 180) {
        if (from.lng > to.lng) {
            from.lng -= 360;
        }
        else {
            from.lng += 360;
        }
    }
    if (to.zoom <= 0) {
        to.zoom = 360;
    }
    if (from.zoom <= 0) {
        from.zoom = 360;
    }
    this._from = from;
    this._to = to;
    this._fromTime = SpaceTimeController.get_metaNow();
    var zoomUpTarget = 360;
    var travelTime;
    var lngDist = Math.abs(from.lng - to.lng);
    var latDist = Math.abs(from.lat - to.lat);
    var distance = Math.sqrt(latDist * latDist + lngDist * lngDist);
    zoomUpTarget = Math.ceil(Math.log(Math.max(from.zoom, to.zoom)) / Math.log(10));
    travelTime = (distance / 180) * Math.log(WWTControl.singleton.get_zoomMax() / zoomUpTarget) * this._travelTimeFactor;
    var rotateTime = Math.max(Math.abs(from.angle - to.angle), Math.abs(from.rotation - to.rotation));
    var logDistUp = Math.max(Math.abs(logN(zoomUpTarget, 2) - logN(from.zoom, 2)), rotateTime);
    this._upTargetTime = this._upTimeFactor * logDistUp;
    this._downTargetTime = this._upTargetTime + travelTime;
    var logDistDown = Math.abs(logN(zoomUpTarget, 2) - logN(to.zoom, 2));
    this._toTargetTime = this._downTargetTime + Math.max((this._downTimeFactor * logDistDown), rotateTime);
    this._fromTop = from.copy();
    this._fromTop.zoom = zoomUpTarget;
    this._fromTop.angle = (from.angle + to.angle) / 2;
    this._fromTop.rotation = (from.rotation + to.rotation) / 2;
    this._toTop = to.copy();
    this._toTop.zoom = this._fromTop.zoom;
    this._toTop.angle = this._fromTop.angle;
    this._toTop.rotation = this._fromTop.rotation;
};

ViewMoverSlewHacked.prototype.get_complete = function () {
    return this._complete;
};

ViewMoverSlewHacked.prototype.get_currentPosition = function () {
    var elapsed = SpaceTimeController.get_metaNow() - this._fromTime;
    var elapsedSeconds = (elapsed) / 1000;
    if (elapsedSeconds < this._upTargetTime) {
        // Log interpolate from from to fromTop
        return CameraParameters.interpolate(this._from, this._fromTop, elapsedSeconds / this._upTargetTime, 3, false);
    } else if (elapsedSeconds < this._downTargetTime) {
        elapsedSeconds -= this._upTargetTime;
        if (Settings.get_active().get_galacticMode() && WWTControl.singleton.renderContext.space) {
            return CameraParameters.interpolateGreatCircle(this._fromTop, this._toTop, elapsedSeconds / (this._downTargetTime - this._upTargetTime), 3, false);
        }
        // interpolate linear fromTop and toTop
        return CameraParameters.interpolate(this._fromTop, this._toTop, elapsedSeconds / (this._downTargetTime - this._upTargetTime), 3, false);
    } else {
        if (!this._midpointFired) {
            this._midpointFired = true;
            if (this._midpoint != null) {
                this._midpoint();
            }
        }
        elapsedSeconds -= this._downTargetTime;
        // Interpolate log from toTop and to
        var alpha = elapsedSeconds / (this._toTargetTime - this._downTargetTime);
        if (alpha > 1) {
            alpha = 1;
            this._complete = true;
            return this._to.copy();
        }
        return CameraParameters.interpolate(this._toTop, this._to, alpha, 3, false);
    }
};

ViewMoverSlewHacked.prototype.get_currentDateTime = function () {
    SpaceTimeController.updateClock();
    return SpaceTimeController.get_now();
},

ViewMoverSlewHacked.prototype.get_midpoint = function () {
    return this._midpoint;
};

ViewMoverSlewHacked.prototype.set_midpoint = function (value) {
    this._midpoint = value;
    return value;
};

ViewMoverSlewHacked.prototype.get_moveTime = function () {
    return this._toTargetTime;
};

// ── ViewMoverCinematic ────────────────────────────────────────────────────────
// Duck-typed IViewMover replacement for ViewMoverKenBurnsStyle. WWT's engine
// only ever calls get_complete / get_currentPosition / get_currentDateTime /
// get_midpoint / set_midpoint on a mover (see _updateMover at engine index.js
// line 67279), so we can be a plain class with those methods.
//
// Differences vs the engine's ViewMoverKenBurnsStyle:
//   • `from`/`to` are .copy()'d so the wraparound mutation can't corrupt the
//     live viewCamera (the stock class mutates `from` in-place).
//   • The raw elapsed/total alpha is passed through smootherstep before the
//     CameraParameters.interpolate call. We then pass linear (type=0) to the
//     interpolator so the easing comes entirely from our curve.
class ViewMoverCinematic {
  constructor(from, to, timeSec, fromDateTime, toDateTime) {
    const fromC = from.copy();
    const toC = to.copy();
    if (Math.abs(fromC.lng - toC.lng) > 180) {
      if (fromC.lng > toC.lng) fromC.lng -= 360;
      else fromC.lng += 360;
    }
    this._from = fromC;
    this._to = toC;
    this._toTargetTime = timeSec;
    this._fromDateTime = fromDateTime;
    this._toDateTime = toDateTime;
    this._dateTimeSpan = toDateTime.getTime() - fromDateTime.getTime();
    this._fromTime = SpaceTimeController.get_metaNow();
    this._complete = false;
    this._midpointFired = false;
    this._midpoint = null;
    // CameraParameters.interpolate blends lat/lng linearly but blends zoom in
    // log space against the same alpha, so a deep zoom-in makes the angular
    // motion accelerate as FOV narrows — "space rushing past". For large zoom
    // deltas we run a phased schedule (pan first at the original FOV, then
    // dolly in). Threshold of 0.5 ≈ factor of √2 in zoom — below that a
    // simultaneous slew doesn't really rush.
    this._zoomLogDelta = Math.abs(Math.log2(this._to.zoom / this._from.zoom));
    this._phased = this._zoomLogDelta > 0.5;
  }

  _ease(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  // Replicates CameraParameters.interpolate (linear+log path, ignoring the
  // great-circle and fastDirectionMove branches we don't use here) but with
  // separate alphas for position and zoom.
  _blend(aPos, aZoom) {
    const f = this._from;
    const to = this._to;
    const r = new CameraParameters();
    r.angle = to.angle * aPos + f.angle * (1 - aPos);
    r.rotation = to.rotation * aPos + f.rotation * (1 - aPos);
    r.lat = to.lat * aPos + f.lat * (1 - aPos);
    r.lng = to.lng * aPos + f.lng * (1 - aPos);
    r.zoom = Math.pow(2, Math.log2(to.zoom) * aZoom + Math.log2(f.zoom) * (1 - aZoom));
    r.opacity = to.opacity * aPos + f.opacity * (1 - aPos);
    r.viewTarget = Vector3d.lerp(f.viewTarget, to.viewTarget, aPos);
    r.targetReferenceFrame = to.targetReferenceFrame;
    r.target = (to.target === f.target) ? to.target : 20;
    return r;
  }

  get_complete() { return this._complete; }

  get_currentPosition() {
    const elapsedSeconds = (SpaceTimeController.get_metaNow() - this._fromTime) / 1000;
    const t = elapsedSeconds / this._toTargetTime;
    if (!this._midpointFired && t >= 0.5) {
      this._midpointFired = true;
      if (this._midpoint != null) this._midpoint();
    }
    if (t >= 1) {
      this._complete = true;
      return this._to.copy();
    }
    if (!this._phased) {
      return CameraParameters.interpolate(this._from, this._to, this._ease(t), 0, false);
    }
    // Phased: pan completes by t=0.65, zoom runs from t=0.40 to t=1.00.
    // The 25% overlap (t ∈ [0.40, 0.65]) keeps motion continuous so there's
    // no visible pause when pan finishes — zoom-in is already in progress.
    const aPos = this._ease(Math.min(1, t / 0.65));
    const aZoom = this._ease(Math.max(0, (t - 0.40) / 0.60));
    return this._blend(aPos, aZoom);
  }

  get_currentDateTime() {
    const elapsedSeconds = (SpaceTimeController.get_metaNow() - this._fromTime) / 1000;
    const alpha = Math.min(1, elapsedSeconds / this._toTargetTime);
    const delta = this._dateTimeSpan * alpha;
    return new Date(this._fromDateTime.getTime() + delta);
  }

  get_midpoint() { return this._midpoint; }
  set_midpoint(v) { this._midpoint = v; return v; }
  get_moveTime() { return this._toTargetTime; }
}

export function gotoTargetFullHacked(control, noZoom, instant, cameraParams, studyImageSet, backgroundImageSet, duration) {
    control._tracking = false;
    control._trackingObject = null;
    control._targetStudyImageset = studyImageSet;
    control._targetBackgroundImageset = backgroundImageSet;
    if (noZoom) {
        cameraParams.zoom = control.renderContext.viewCamera.zoom;
        cameraParams.angle = control.renderContext.viewCamera.angle;
        cameraParams.rotation = control.renderContext.viewCamera.rotation;
    } else {
        if (cameraParams.zoom === -1 || !cameraParams.zoom) {
            if (control.renderContext.space) {
                cameraParams.zoom = 1.40625;
            }
            else {
                cameraParams.zoom = 0.09;
            }
        }
    }
    if (instant || control._tooCloseForSlewMove(cameraParams)) {
        control.set__mover(null);
        control.renderContext.targetCamera = cameraParams.copy();
        control.renderContext.viewCamera = control.renderContext.targetCamera.copy();
        if (control.renderContext.space && Settings.get_active().get_galacticMode()) {
            var gPoint = Coordinates.j2000toGalactic(control.renderContext.viewCamera.get_RA() * 15, control.renderContext.viewCamera.get_dec());
            control.renderContext.targetAlt = control.renderContext.alt = gPoint[1];
            control.renderContext.targetAz = control.renderContext.az = gPoint[0];
        }
        else if (control.renderContext.space && Settings.get_active().get_localHorizonMode()) {
            var currentAltAz = Coordinates.equitorialToHorizon(Coordinates.fromRaDec(control.renderContext.viewCamera.get_RA(), control.renderContext.viewCamera.get_dec()), SpaceTimeController.get_location(), SpaceTimeController.get_now());
            control.renderContext.targetAlt = control.renderContext.alt = currentAltAz.get_alt();
            control.renderContext.targetAz = control.renderContext.az = currentAltAz.get_az();
        }
        control._mover_Midpoint();
    } else {
        // Cinematic Ken-Burns: same timing contract as ViewMoverKenBurnsStyle
        // (time is SECONDS, fromDateTime/toDateTime in ms), but alpha is run
        // through smootherstep (6t^5 - 15t^4 + 10t^3) before being handed to
        // CameraParameters.interpolate. Smootherstep has zero 1st AND 2nd
        // derivatives at both endpoints, so the camera eases in and out more
        // gently than the engine's sinh-based easeInOut.
        const durationSec = duration ?? 2;
        const durationMs = durationSec * 1000;
        const start = new Date();
        const end = new Date(start.getTime() + durationMs);
        control.set__mover(new ViewMoverCinematic(control.renderContext.viewCamera, cameraParams, durationSec, start, end));
        control.get__mover().set_midpoint(control._mover_Midpoint.bind(control));
    }
}

// ── gotoRADecZoomCinematic ────────────────────────────────────────────────────
// 2D search-slew helper. Mirrors the engine's WWTControl.gotoRADecZoom (see
// index.js:68345) but routes through gotoTargetFullHacked so the slew uses
// ViewMoverCinematic instead of ViewMoverSlew. To revert to the stock 2D
// slew, just delete this export and its call site in selectSearchResult.
//
//   raHours    target RA in hours
//   decDeg     target Dec in degrees
//   zoomDeg    target zoom in degrees (clamped to [zoomMin, zoomMax])
//   duration   optional seconds; if omitted, scales 1.5–4 s with angular
//              separation (~0.6 + 0.05·angSepDeg, clamped) so nearby targets
//              feel snappy and across-sky slews stay cinematic.
export function gotoRADecZoomCinematic(control, raHours, decDeg, zoomDeg, duration?: number) {
  let ra = raHours;
  while (ra > 24) ra -= 24;
  while (ra < 0) ra += 24;
  const dec = Math.max(-90, Math.min(90, decDeg));
  const zoom = Math.max(control.get_zoomMin(), Math.min(control.get_zoomMax(), zoomDeg));

  const rc = control.renderContext;
  const cam = rc.viewCamera;
  const params = CameraParameters.create(dec, rc.rAtoViewLng(ra), zoom, cam.rotation, cam.angle, cam.opacity);

  let dur = duration;
  if (dur === undefined) {
    const D = Math.PI / 180;
    const ra1 = cam.get_RA() * 15 * D;
    const ra2 = ra * 15 * D;
    const d1 = cam.get_dec() * D;
    const d2 = dec * D;
    const cosSep = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(ra1 - ra2);
    const angDeg = Math.acos(Math.max(-1, Math.min(1, cosSep))) / D;
    dur = Math.max(1.5, Math.min(4.0, 0.6 + 0.05 * angDeg));
  }

  gotoTargetFullHacked(control, false, false, params, rc.get_foregroundImageset(), rc.get_backgroundImageset(), dur);
}
