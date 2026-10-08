// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

/* eslint-disable */

/* === Galaxy3D ============================================================
 * Procedural 3D point-cloud Milky Way for the WWT solar-system (3D) view.
 *
 * v2 — Milky Way realism pass. Major changes over the original four-fold
 * symmetric model:
 *   1. Per-arm parameter table (Scutum-Centaurus, Perseus, Sagittarius-
 *      Carina, Norma, Local Arm), anchored to the bar ends per GLIMPSE /
 *      Churchwell 2009. Per-arm pitch, weight, and width-in-pc.
 *   2. Dust lanes offset to the trailing/inner edge of each stellar arm,
 *      plus two straight bar dust lanes and a ~4 kpc molecular ring.
 *   3. 3D dust-density voxel grid + line-of-sight extinction from the
 *      Sun, reproducing the Zone of Avoidance.
 *   4. Boxy/peanut bulge deformation + redder integrated color.
 *   5. Spherical, slightly red halo.
 *   6. HII region (pink) + OB association (blue) knots along arm peaks.
 *   7. Per-star luminosity sampling (a few bright, many dim) feeds into
 *      both color attenuation and per-point world-space size.
 *   8. Outer-disk warp + radial flare.
 *
 * To remove entirely, delete this file and the two short blocks marked
 * "=== Galaxy3D ===" in src/exo-sonification.vue.
 *
 * To disable without uninstalling, set GALAXY3D_ENABLED below to false.
 * ========================================================================*/

import {
  Color, Coordinates, Dates, Grids, PointList,
  SpaceTimeController, Vector3d
} from "@wwtelescope/engine";


// ── Master switch ─────────────────────────────────────────────────────────
export const GALAXY3D_ENABLED = false;

// ── Adaptive particle budget ──────────────────────────────────────────────
function targetStarCount(): number {
  const coarse = typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(pointer: coarse)").matches;
  return coarse ? 100_000 : 1_500_000;
}

// ── Galactic structure constants ──────────────────────────────────────────
const PC_TO_AU       = 206264.806;
const R0_PC          = 8200;
const DISK_R_INNER   = 200;
const DISK_R_OUTER   = 15000;
const HR_THIN        = 2600;
const HZ_THIN        = 300;
const HR_THICK       = 2000;
const HZ_THICK       = 900;
const BULGE_SCALE    = 700;
const BAR_HALF_LEN   = 5000;
const BAR_HALF_WID   = 1000;
const BAR_HALF_HGT   = 500;
// Bar position angle to Sun-GC line. Negative because the near end of the
// bar lies at positive Galactic longitude (l ≈ +27°), so in our
// "Sun at galactocentric (-R0, 0, 0)" frame the bar's near (negative-x) end
// must rotate to positive y.
const BAR_PA_RAD     = -27 * Math.PI / 180;
const HALO_SCALE     = 8000;
const HALO_R_MAX     = 30000;

// ── (8) Disk warp & flare ─────────────────────────────────────────────────
// Warp: the outer disk bends sinusoidally out of the b=0 plane. WARP_PHI_RAD
// is the line-of-nodes azimuth. Amplitude tuned so the warp reaches ±450 pc
// at r = 15 kpc.
const WARP_R0_PC     = 8500;
const WARP_AMP       = 0.07;
const WARP_PHI_RAD   = Math.PI / 2;
// Flare: HZ multiplier grows linearly beyond FLARE_START_PC.
const FLARE_START_PC = 6000;
const FLARE_RATE     = 0.5 / 4000;

// ── Population fractions of the total budget ──────────────────────────────
const FRAC_THIN      = 0.62;
const FRAC_THICK     = 0.12;
const FRAC_BULGE     = 0.16;
const FRAC_BAR       = 0.05;
// HII / OB knots are drawn from the thin-disk fraction.
const FRAC_KNOTS     = 0.005;
// Halo is whatever's left (~0.05).

// ── (1) Spiral arm table ──────────────────────────────────────────────────
// Each arm is a logarithmic spiral; given anchor (r0, φ0) and pitch p, the
// arm centerline azimuth as a function of r is φ(r) = φ0 + ln(r/r0)/tan(p).
// The two major arms (Scutum-Centaurus, Perseus) emerge from opposite ends
// of the bar — anchored at φ = BAR_PA_RAD and BAR_PA_RAD + π respectively.
// Two secondary arms (Sagittarius-Carina, Norma) are weaker and offset by
// ±90°. The Local Arm is a short feature passing near the Sun and is the
// most visible structure from inside the disk.
//
// Widths are constant in pc — converted to radians by sigmaPc/r at lookup
// so a given arm reads the same physical thickness at every radius.
interface ArmDef {
  name: string;
  phi0Rad: number;
  r0Pc: number;
  rMinPc: number;
  rMaxPc: number;
  pitchRad: number;
  weight: number;
  sigmaPc: number;
}

const ARMS: ArmDef[] = [
  { name: "Scutum-Centaurus",   phi0Rad: BAR_PA_RAD,                r0Pc: 3200, rMinPc: 2800, rMaxPc: 16000, pitchRad: 12 * Math.PI / 180, weight: 1.00, sigmaPc: 600 },
  { name: "Perseus",            phi0Rad: BAR_PA_RAD + Math.PI,      r0Pc: 3500, rMinPc: 2800, rMaxPc: 16000, pitchRad: 13 * Math.PI / 180, weight: 1.00, sigmaPc: 600 },
  { name: "Sagittarius-Carina", phi0Rad: BAR_PA_RAD + Math.PI / 2,  r0Pc: 3500, rMinPc: 3000, rMaxPc: 14000, pitchRad: 11 * Math.PI / 180, weight: 0.55, sigmaPc: 500 },
  { name: "Norma",              phi0Rad: BAR_PA_RAD - Math.PI / 2,  r0Pc: 3500, rMinPc: 3000, rMaxPc: 14000, pitchRad:  9 * Math.PI / 180, weight: 0.55, sigmaPc: 500 },
  { name: "Local (Orion)",      phi0Rad: Math.PI,                   r0Pc: 7800, rMinPc: 6500, rMaxPc:  9500, pitchRad: 12 * Math.PI / 180, weight: 0.40, sigmaPc: 350 },
];

const ARM_DENSITY_BOOST = 4.0;
const ARM_FADE_R_START  = 11000;
const ARM_FADE_R_SCALE  = 4500;
// (2) Dust-lane azimuthal offset: trailing/concave side of the arm peak.
// Distance corresponds to ~220 pc inward of the stellar ridge; the sign is
// chosen so the lane lies on the inner (concave) side under our convention
// where phi(r) increases with r.
const DUST_LANE_INWARD_PC = 220;
const DUST_LANE_SIGN      = -1;

function phiOfArm(arm: ArmDef, r: number): number {
  return arm.phi0Rad + Math.log(r / arm.r0Pc) / Math.tan(arm.pitchRad);
}

function angDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d >  Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Sum-of-arms gaussian density boost in [0, ARM_DENSITY_BOOST * Σ weights].
// Uses sum (not max) so where two arms cross they reinforce.
function armBoost(x: number, y: number): number {
  const r = Math.hypot(x, y);
  if (r < 1500 || r > DISK_R_OUTER) return 0;
  const phi = Math.atan2(y, x);
  const fadeOuter = r > ARM_FADE_R_START ? Math.exp(-(r - ARM_FADE_R_START) / ARM_FADE_R_SCALE) : 1;
  let total = 0;
  for (let i = 0; i < ARMS.length; i++) {
    const arm = ARMS[i];
    if (r < arm.rMinPc || r > arm.rMaxPc) continue;
    const d = angDiff(phi, phiOfArm(arm, r));
    const sigmaRad = arm.sigmaPc / r;
    total += arm.weight * Math.exp(-(d * d) / (2 * sigmaRad * sigmaRad));
  }
  return ARM_DENSITY_BOOST * fadeOuter * total;
}

// ── (2) Dust cloud population ─────────────────────────────────────────────
const DUST_CLOUDS_DESKTOP_ARM  = 520;
const DUST_CLOUDS_MOBILE_ARM   = 200;
const RING_CLOUDS_DESKTOP      = 90;
const RING_CLOUDS_MOBILE       = 40;
const BAR_LANE_CLOUDS_PER_SIDE = 40;

interface DustCloud {
  cx: number; cy: number; cz: number;
  rx: number; ry: number; rz: number;
  cosPhi: number; sinPhi: number;
  opacity: number;  // peak τ contribution per pc of path
}

function makeArmLaneCloud(): DustCloud {
  // Skip the Local Arm — its dust lane is not a coherent visual feature.
  const arm = ARMS[Math.floor(Math.random() * (ARMS.length - 1))];
  const rLo = Math.max(arm.rMinPc, 3000);
  const rHi = Math.min(arm.rMaxPc, 13500);
  const r = rLo + Math.pow(Math.random(), 0.5) * (rHi - rLo);
  const phiArm = phiOfArm(arm, r);
  const phi = phiArm
            + DUST_LANE_SIGN * (DUST_LANE_INWARD_PC / r)
            + (Math.random() - 0.5) * 0.06;
  const cx = r * Math.cos(phi);
  const cy = r * Math.sin(phi);
  const cz = (Math.random() - 0.5) * 90;
  const tangent = phi + Math.PI / 2 - arm.pitchRad;
  return {
    cx, cy, cz,
    rx: 300 + Math.pow(Math.random(), 0.7) * 1200,
    ry: 60  + Math.random() * 150,
    rz: 30  + Math.random() * 40,
    cosPhi: Math.cos(tangent),
    sinPhi: Math.sin(tangent),
    opacity: 0.0011 + Math.random() * 0.0014,
  };
}

function makeBarLaneCloud(side: number): DustCloud {
  // Two thin straight dust lanes along the leading edges of the bar, the
  // signature feature of barred spirals. The bar major axis is along
  // (cos BAR_PA, sin BAR_PA); the perpendicular ("width") direction is
  // (-sin BAR_PA, cos BAR_PA). `side` ∈ {-1, +1} picks which leading edge.
  const t = (Math.random() * 2 - 1) * BAR_HALF_LEN * 0.95;
  const offset = side * (BAR_HALF_WID * 0.55 + (Math.random() - 0.5) * 90);
  const cBar = Math.cos(BAR_PA_RAD), sBar = Math.sin(BAR_PA_RAD);
  const cx = t * cBar - offset * sBar;
  const cy = t * sBar + offset * cBar;
  const cz = (Math.random() - 0.5) * 60;
  return {
    cx, cy, cz,
    rx: 350 + Math.random() * 250,
    ry: 50 + Math.random() * 30,
    rz: 25 + Math.random() * 25,
    cosPhi: cBar,
    sinPhi: sBar,
    opacity: 0.0020 + Math.random() * 0.0012,
  };
}

function makeRingCloud(): DustCloud {
  // ~4 kpc molecular ring — broad torus interior to the spiral arms.
  const r = 3500 + Math.random() * 1500;
  const phi = Math.random() * 2 * Math.PI;
  const cx = r * Math.cos(phi);
  const cy = r * Math.sin(phi);
  const cz = (Math.random() - 0.5) * 70;
  const tangent = phi + Math.PI / 2;
  return {
    cx, cy, cz,
    rx: 400 + Math.random() * 500,
    ry: 80 + Math.random() * 120,
    rz: 30 + Math.random() * 30,
    cosPhi: Math.cos(tangent),
    sinPhi: Math.sin(tangent),
    opacity: 0.0010 + Math.random() * 0.0010,
  };
}

function buildDustClouds(armCount: number, ringCount: number): DustCloud[] {
  const out: DustCloud[] = [];
  for (let i = 0; i < armCount; i++) out.push(makeArmLaneCloud());
  for (let i = 0; i < ringCount; i++) out.push(makeRingCloud());
  for (let i = 0; i < BAR_LANE_CLOUDS_PER_SIDE; i++) {
    out.push(makeBarLaneCloud(+1));
    out.push(makeBarLaneCloud(-1));
  }
  return out;
}

// ── (3) Dust voxel grid + LOS extinction from the Sun ─────────────────────
// Splatting each cloud into a 3D grid lets us evaluate dust column density
// along arbitrary rays in O(LOS_SAMPLES) per star instead of O(clouds).
// The Sun sits inside the disk, so almost every star is seen *through* some
// amount of dust — this is what produces the Zone of Avoidance in our sky.
const GRID_NX = 192;
const GRID_NY = 192;
const GRID_NZ = 16;
const GRID_HALF_XY = 18000;
const GRID_HALF_Z  = 500;
const LOS_SAMPLES  = 10;

interface DustGrid { data: Float32Array; }

function buildDustGrid(clouds: DustCloud[]): DustGrid {
  const data = new Float32Array(GRID_NX * GRID_NY * GRID_NZ);
  const dxCell = (2 * GRID_HALF_XY) / GRID_NX;
  const dyCell = (2 * GRID_HALF_XY) / GRID_NY;
  const dzCell = (2 * GRID_HALF_Z)  / GRID_NZ;
  for (const c of clouds) {
    const minX = c.cx - c.rx, maxX = c.cx + c.rx;
    const minY = c.cy - c.rx, maxY = c.cy + c.rx;
    const minZ = c.cz - c.rz, maxZ = c.cz + c.rz;
    const i0 = Math.max(0,            Math.floor((minX + GRID_HALF_XY) / dxCell));
    const i1 = Math.min(GRID_NX - 1,  Math.floor((maxX + GRID_HALF_XY) / dxCell));
    const j0 = Math.max(0,            Math.floor((minY + GRID_HALF_XY) / dyCell));
    const j1 = Math.min(GRID_NY - 1,  Math.floor((maxY + GRID_HALF_XY) / dyCell));
    const k0 = Math.max(0,            Math.floor((minZ + GRID_HALF_Z)  / dzCell));
    const k1 = Math.min(GRID_NZ - 1,  Math.floor((maxZ + GRID_HALF_Z)  / dzCell));
    for (let k = k0; k <= k1; k++) {
      const zCell = -GRID_HALF_Z + (k + 0.5) * dzCell;
      const dz = zCell - c.cz;
      for (let j = j0; j <= j1; j++) {
        const yCell = -GRID_HALF_XY + (j + 0.5) * dyCell;
        for (let i = i0; i <= i1; i++) {
          const xCell = -GRID_HALF_XY + (i + 0.5) * dxCell;
          const ddx = xCell - c.cx, ddy = yCell - c.cy;
          const lx =  c.cosPhi * ddx + c.sinPhi * ddy;
          const ly = -c.sinPhi * ddx + c.cosPhi * ddy;
          const d2 = (lx / c.rx) * (lx / c.rx)
                   + (ly / c.ry) * (ly / c.ry)
                   + (dz / c.rz) * (dz / c.rz);
          if (d2 < 1) {
            data[(k * GRID_NY + j) * GRID_NX + i] += c.opacity * (1 - d2);
          }
        }
      }
    }
  }
  return { data };
}

function gridSample(grid: DustGrid, x: number, y: number, z: number): number {
  const dxCell = (2 * GRID_HALF_XY) / GRID_NX;
  const dyCell = (2 * GRID_HALF_XY) / GRID_NY;
  const dzCell = (2 * GRID_HALF_Z)  / GRID_NZ;
  const i = Math.floor((x + GRID_HALF_XY) / dxCell);
  const j = Math.floor((y + GRID_HALF_XY) / dyCell);
  const k = Math.floor((z + GRID_HALF_Z)  / dzCell);
  if (i < 0 || i >= GRID_NX || j < 0 || j >= GRID_NY || k < 0 || k >= GRID_NZ) return 0;
  return grid.data[(k * GRID_NY + j) * GRID_NX + i];
}

// Returns transmission ∈ [0, 1] from the Sun at (-R0, 0, 0) to (x, y, z).
function losTransmission(grid: DustGrid, x: number, y: number, z: number): number {
  const x0 = -R0_PC, y0 = 0, z0 = 0;
  const dx = (x - x0) / LOS_SAMPLES;
  const dy = (y - y0) / LOS_SAMPLES;
  const dz = (z - z0) / LOS_SAMPLES;
  const stepPc = Math.hypot(dx, dy, dz);
  let tau = 0;
  for (let s = 1; s < LOS_SAMPLES; s++) {
    tau += gridSample(grid, x0 + dx * s, y0 + dy * s, z0 + dz * s);
  }
  tau *= stepPc;
  if (tau > 8) return 0;
  return Math.exp(-tau);
}

// ── Per-star draw size (world-space AU) ───────────────────────────────────
// Tuned so the disk fills the field nicely from a 50-kpc vantage point.
// (7) Per-star luminosity multiplies these.
const STAR_SIZE_AU       = 1.6e7;
const STAR_SIZE_HALO_AU  = 1.4e7;
const STAR_SIZE_BULGE_AU = 1.8e7;
const STAR_SIZE_KNOT_AU  = 4.5e7;   // HII / OB knots — large & saturated

// ── Galactic → ICRS rotation matrix (J2000) ───────────────────────────────
const M_GE_00 = -0.054875560; const M_GE_01 =  0.494109440; const M_GE_02 = -0.867666150;
const M_GE_10 = -0.873437090; const M_GE_11 = -0.444829620; const M_GE_12 = -0.198076380;
const M_GE_20 = -0.483835020; const M_GE_21 =  0.746982140; const M_GE_22 =  0.455983820;

function galacticToWorldAU(xPc: number, yPc: number, zPc: number, eclipticRad: number): Vector3d {
  const xh = (xPc + R0_PC) * PC_TO_AU;
  const yh =  yPc           * PC_TO_AU;
  const zh =  zPc           * PC_TO_AU;
  const xe = M_GE_00 * xh + M_GE_01 * yh + M_GE_02 * zh;
  const ye = M_GE_10 * xh + M_GE_11 * yh + M_GE_12 * zh;
  const ze = M_GE_20 * xh + M_GE_21 * yh + M_GE_22 * zh;
  // WWT swaps Y↔Z — see project CLAUDE.md "WWT solar-system Cartesian
  // convention (footgun)" for full details.
  const v  = Vector3d.create(xe, ze, ye);
  v.rotateX(eclipticRad);
  return v;
}

// ── (4, 5, 6) Stellar palette ─────────────────────────────────────────────
// Bulge shifted noticeably warmer (real bulge integrated light is K-giant
// dominated, not yellow-white). Halo shifted yellow-red (metal-poor old
// population dominated by K giants). New HII / OB knot colors.
const COL_BULGE_HOT  : [number, number, number] = [255, 205, 155];
const COL_BULGE_COOL : [number, number, number] = [255, 160, 105];
const COL_BAR        : [number, number, number] = [255, 195, 135];
const COL_ARM_BLUE   : [number, number, number] = [180, 210, 255];
const COL_ARM_WHITE  : [number, number, number] = [240, 245, 255];
const COL_INTERARM   : [number, number, number] = [255, 235, 200];
const COL_THICK      : [number, number, number] = [255, 205, 160];
const COL_HALO       : [number, number, number] = [230, 215, 200];
const COL_HII        : [number, number, number] = [255, 130, 145];
const COL_OB         : [number, number, number] = [185, 220, 255];

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function makeColor(rgb: [number, number, number], att: number): Color {
  const r = Math.max(0, Math.min(255, Math.round(rgb[0] * att)));
  const g = Math.max(0, Math.min(255, Math.round(rgb[1] * att)));
  const b = Math.max(0, Math.min(255, Math.round(rgb[2] * att)));
  return Color.fromArgb(255, r, g, b);
}

// ── Random helpers ────────────────────────────────────────────────────────
function rndExp(scale: number): number {
  return -scale * Math.log(1 - Math.random());
}

function rndDoubleExp(scale: number): number {
  const sign = Math.random() < 0.5 ? -1 : 1;
  return sign * rndExp(scale);
}

function rndGauss(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// (7) Per-star luminosity multiplier. Most stars dim, a few bright — the
// "speckled with bright stars" look. 99% in [0.5, 1.4], the top 1% up
// to ~4×. Multiplies both color brightness and point size.
function rndLuminosity(): number {
  const u = Math.random();
  if (u < 0.99) return 0.5 + Math.pow(Math.random(), 1.5) * 0.9;
  return 1.5 + Math.pow(Math.random(), 0.5) * 2.5;
}

// ── (8) Disk warp & flare helpers ─────────────────────────────────────────
function diskZScaleAt(r: number): number {
  if (r <= FLARE_START_PC) return 1;
  return 1 + (r - FLARE_START_PC) * FLARE_RATE;
}

function warpOffsetAt(r: number, phi: number): number {
  if (r <= WARP_R0_PC) return 0;
  return WARP_AMP * (r - WARP_R0_PC) * Math.sin(phi - WARP_PHI_RAD);
}

// ── Component samplers ────────────────────────────────────────────────────

function sampleThinDisk(): [number, number, number] {
  let r: number;
  do { r = rndExp(HR_THIN); } while (r < DISK_R_INNER || r > DISK_R_OUTER);
  const phi = Math.random() * 2 * Math.PI;
  let z = rndDoubleExp(HZ_THIN * diskZScaleAt(r));
  z += warpOffsetAt(r, phi);
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

function sampleThickDisk(): [number, number, number] {
  let r: number;
  do { r = rndExp(HR_THICK); } while (r < DISK_R_INNER || r > DISK_R_OUTER);
  const phi = Math.random() * 2 * Math.PI;
  let z = rndDoubleExp(HZ_THICK * diskZScaleAt(r));
  z += warpOffsetAt(r, phi);
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

// (4) Boxy/peanut bulge. The bulge sample is rotated into bar-aligned
// coordinates, where |z| is amplified as a function of |along-bar
// distance|. Face-on this still reads round; edge-on it produces the
// X / peanut shape seen in the WISE bulge isophotes.
function sampleBulge(): [number, number, number] {
  const r = BULGE_SCALE * Math.pow(-Math.log(1 - Math.random()), 1 / 4);
  const u = Math.random() * 2 - 1;
  const t = Math.random() * 2 * Math.PI;
  const sx = Math.sqrt(1 - u * u) * Math.cos(t);
  const sy = Math.sqrt(1 - u * u) * Math.sin(t);
  const sz = u;
  const c = Math.cos(BAR_PA_RAD), s = Math.sin(BAR_PA_RAD);
  // Galactocentric → bar-aligned.
  let ax =  c * (r * sx) + s * (r * sy);
  let ay = -s * (r * sx) + c * (r * sy);
  let az = r * 0.6 * sz;
  // Peanut: |z| grows with along-bar distance.
  const peanut = 0.35 * Math.min(1, Math.abs(ax) / (BULGE_SCALE * 1.2));
  az *= 1 + peanut;
  // Slight along-bar elongation gives bulge → long-bar continuity.
  ax *= 1.3;
  // Back to galactocentric.
  const x = c * ax - s * ay;
  const y = s * ax + c * ay;
  return [x, y, az];
}

function sampleBar(): [number, number, number] {
  const ax = rndGauss() * BAR_HALF_LEN * 0.5;
  const ay = rndGauss() * BAR_HALF_WID * 0.5;
  const az = rndGauss() * BAR_HALF_HGT * 0.5;
  const c = Math.cos(BAR_PA_RAD), s = Math.sin(BAR_PA_RAD);
  return [c * ax - s * ay, s * ax + c * ay, az];
}

// (5) Spherical halo — old metal-poor populations are essentially round.
function sampleHalo(): [number, number, number] {
  let r: number;
  do {
    r = HALO_SCALE * Math.tan(Math.random() * (Math.PI / 2 - 0.05));
  } while (r > HALO_R_MAX);
  const u = Math.random() * 2 - 1;
  const t = Math.random() * 2 * Math.PI;
  const sx = Math.sqrt(1 - u * u) * Math.cos(t);
  const sy = Math.sqrt(1 - u * u) * Math.sin(t);
  const sz = u;
  return [r * sx, r * sy, r * sz];
}

// (6) HII / OB knot sampling. Tightly placed on an arm centerline — the
// scatter is ~200 pc — with a thin vertical layer. Tagged hii=true for
// pink HII regions, false for blue OB associations.
function sampleKnot(): { x: number; y: number; z: number; hii: boolean } {
  const arm = ARMS[Math.floor(Math.random() * ARMS.length)];
  // HII regions prefer the inner / middle disk where star formation is
  // strongest; bias r toward the smaller end.
  const r = arm.rMinPc + Math.pow(Math.random(), 0.7) * (arm.rMaxPc - arm.rMinPc);
  const phiArm = phiOfArm(arm, r);
  const phi = phiArm + rndGauss() * (200 / r);
  let z = rndDoubleExp(60);
  z += warpOffsetAt(r, phi);
  const x = r * Math.cos(phi);
  const y = r * Math.sin(phi);
  return { x, y, z, hii: Math.random() < 0.6 };
}

// ── Build the PointList (cached after first build) ────────────────────────
let _galaxyList: PointList | null = null;
let _galaxyBuilding = false;

function buildGalaxy(renderContext): PointList {
  const total = targetStarCount();
  const mobile = total < 300_000;
  const armCloudCount  = mobile ? DUST_CLOUDS_MOBILE_ARM : DUST_CLOUDS_DESKTOP_ARM;
  const ringCloudCount = mobile ? RING_CLOUDS_MOBILE     : RING_CLOUDS_DESKTOP;

  const clouds = buildDustClouds(armCloudCount, ringCloudCount);
  const grid   = buildDustGrid(clouds);

  const list = new PointList(renderContext);
  list.depthBuffered = false;
  list.showFarSide   = true;
  list.scale         = 1;
  list.minSize       = 1;
  list.timeSeries    = false;

  const ecliptic = Coordinates.meanObliquityOfEcliptic(SpaceTimeController.get_jNow()) / 180 * Math.PI;

  const N_KNOTS = Math.round(total * FRAC_KNOTS);
  const N_THIN  = Math.round(total * FRAC_THIN) - N_KNOTS;
  const N_THICK = Math.round(total * FRAC_THICK);
  const N_BULGE = Math.round(total * FRAC_BULGE);
  const N_BAR   = Math.round(total * FRAC_BAR);
  const N_HALO  = total - N_THIN - N_THICK - N_BULGE - N_BAR - N_KNOTS;

  const dates = new Dates(0, 1);

  // ── Thin disk: arms bias both density and color; LOS dust dims. (1,3,7,8)
  let placed = 0, attempts = 0;
  while (placed < N_THIN && attempts < N_THIN * 4) {
    attempts++;
    const [x, y, z] = sampleThinDisk();
    const boost = armBoost(x, y);
    if (Math.random() > (1 + boost) / (1 + ARM_DENSITY_BOOST)) continue;
    const trans = losTransmission(grid, x, y, z);
    if (trans < 0.02 && Math.random() > trans * 8) continue;

    const lum = rndLuminosity();
    const inArm = boost > 1.2;
    const palette = inArm
      ? lerpColor(COL_ARM_WHITE, COL_ARM_BLUE, Math.random() * 0.85)
      : lerpColor(COL_INTERARM, COL_ARM_WHITE, Math.random() * 0.4);
    const v = galacticToWorldAU(x, y, z, ecliptic);
    list.addPoint(v, makeColor(palette, trans * lum), dates, STAR_SIZE_AU * lum);
    placed++;
  }

  // ── Thick disk: redder, no arm boost, partial LOS attenuation.
  for (let i = 0; i < N_THICK; i++) {
    const [x, y, z] = sampleThickDisk();
    const trans = losTransmission(grid, x, y, z);
    const att = 0.4 + 0.6 * trans;
    const lum = rndLuminosity() * 0.85;
    const palette = lerpColor(COL_THICK, COL_INTERARM, Math.random() * 0.4);
    const v = galacticToWorldAU(x, y, z, ecliptic);
    list.addPoint(v, makeColor(palette, att * lum), dates, STAR_SIZE_AU * lum);
  }

  // ── Bulge (4): boxy/peanut shape, redder palette, *with* LOS dust ──
  // The Sun's view of the bulge is heavily extincted (visual extinction
  // toward the GC reaches A_V ≈ 30); attenuating bulge stars by LOS
  // transmission reproduces the characteristic dark veins running across
  // the inner glow rather than a uniformly bright core.
  for (let i = 0; i < N_BULGE; i++) {
    const [x, y, z] = sampleBulge();
    const trans = losTransmission(grid, x, y, z);
    const palette = lerpColor(COL_BULGE_HOT, COL_BULGE_COOL, Math.random());
    const v = galacticToWorldAU(x, y, z, ecliptic);
    list.addPoint(v, makeColor(palette, trans), dates, STAR_SIZE_BULGE_AU);
  }

  // ── Bar ──
  for (let i = 0; i < N_BAR; i++) {
    const [x, y, z] = sampleBar();
    const trans = losTransmission(grid, x, y, z);
    const v = galacticToWorldAU(x, y, z, ecliptic);
    list.addPoint(v, makeColor(COL_BAR, trans), dates, STAR_SIZE_BULGE_AU);
  }

  // ── Halo (5): spherical, faint, yellow-red ──
  for (let i = 0; i < N_HALO; i++) {
    const [x, y, z] = sampleHalo();
    const v = galacticToWorldAU(x, y, z, ecliptic);
    list.addPoint(v, makeColor(COL_HALO, 0.45), dates, STAR_SIZE_HALO_AU);
  }

  // ── HII / OB knots (6): bright, saturated, exactly on arm centerlines ──
  // A small population that does most of the visual work of "look, arms".
  for (let i = 0; i < N_KNOTS; i++) {
    const k = sampleKnot();
    const trans = losTransmission(grid, k.x, k.y, k.z);
    const palette = k.hii ? COL_HII : COL_OB;
    const lum = 1.0 + Math.random() * 0.8;
    const v = galacticToWorldAU(k.x, k.y, k.z, ecliptic);
    list.addPoint(v, makeColor(palette, trans * lum), dates, STAR_SIZE_KNOT_AU);
  }

  return list;
}

// ── Public entry point: drop-in replacement for Grids.drawGalaxyImage ─────
export function drawGalaxy3D(renderContext, _opacity: number) {
  if (!GALAXY3D_ENABLED) return;

  if (_galaxyList == null && !_galaxyBuilding) {
    _galaxyBuilding = true;
    try {
      _galaxyList = buildGalaxy(renderContext);
    } finally {
      _galaxyBuilding = false;
    }
  }
  if (_galaxyList == null) return;

  const zoom = renderContext.viewCamera.zoom;
  const opacity = Math.min(1, Math.max(0, (Math.log(Math.max(1, zoom)) - 14) / 6));
  if (opacity <= 0) return;

  _galaxyList.draw(renderContext, opacity, false);
}

// ── Installer ─────────────────────────────────────────────────────────────
export function installGalaxy3D(): void {
  if (!GALAXY3D_ENABLED) return;
  // @ts-ignore -- monkey-patch
  Grids.drawGalaxyImage = drawGalaxy3D;
}

export function rebuildGalaxy3D(): void {
  _galaxyList = null;
}
