<template>
  <svg class="loading-mirror" viewBox="-27 -28 54 56" aria-hidden="true">
    <defs>
      <!-- One gradient across the whole aperture, so the segments read as one
           gold-coated mirror rather than 18 separately lit tiles. -->
      <linearGradient id="lmir-gold" gradientUnits="userSpaceOnUse" x1="-20" y1="-24" x2="20" y2="24">
        <stop offset="0" stop-color="#ffe2a3" />
        <stop offset="0.45" stop-color="#f0ab52" />
        <stop offset="1" stop-color="#9a5a18" />
      </linearGradient>
    </defs>

    <g :style="{ opacity: fade }">
      <!-- Wings first, so while folded they sit BEHIND the centre section, as
           they do on the real telescope. -->
      <g v-for="w in wings" :key="w.side" :transform="w.transform">
        <g v-for="s in w.segs" :key="s.key">
          <polygon :points="s.points" class="seg" :style="{ fillOpacity: 0.55 + 0.45 * w.lit }" />
          <polygon :points="s.points" class="edge wing-edge" />
          <polygon :points="s.points" class="glint" :style="{ opacity: s.glint }" />
        </g>
      </g>

      <g v-for="s in centre" :key="s.key">
        <polygon :points="s.points" class="seg" :style="{ fillOpacity: s.fill }" />
        <polygon
          :points="s.points"
          class="edge"
          pathLength="1"
          :style="{ strokeDashoffset: 1 - s.edge, opacity: s.edge > 0 ? 1 : 0 }"
        />
        <polygon :points="s.points" class="glint" :style="{ opacity: s.glint }" />
      </g>

      <!-- Secondary mirror on its three struts (a vertical one up top and two
           lower ones), drawn in once the primary is complete. -->
      <g :style="{ opacity: struts > 0 ? 1 : 0 }">
        <path
          v-for="(d, i) in strutPaths"
          :key="'s' + i"
          :d="d"
          class="strut"
          pathLength="1"
          :style="{ strokeDashoffset: 1 - struts }"
        />
        <circle r="2.1" class="secondary" :style="{ opacity: struts }" />
      </g>
    </g>
  </svg>
</template>

<script lang="ts">
import { defineComponent } from "vue";

// The loading mark: Webb's primary mirror assembling itself. The layout is the
// real one -- 18 flat-topped hexagons, a radius-2 hex grid with the centre cell
// left empty, columns of 3-4-4-4-3. The 12 centre-section segments trace in one
// by one, then the two 3-segment wings unfold from behind (as they did in
// January 2022), the secondary mirror's struts draw in, a glint sweeps across
// the aligned mirror, and it all fades to start again. Transparent background.

const CYCLE_MS = 4200;
const S = 6;                    // hex circumradius in drawing units
const GAP = 0.9;                // drawn hex size vs grid pitch (leaves the seams)
const SQRT3 = Math.sqrt(3);

// Timeline, as fractions of a cycle.
const SEG_STEP = 0.026;         // stagger between centre segments
const SEG_DUR = 0.11;           // each segment's outline-then-fill
const WING_T0 = 0.4, WING_T1 = 0.56;
const STRUT_T0 = 0.54, STRUT_T1 = 0.64;
const GLINT_T0 = 0.64, GLINT_T1 = 0.82;
const FADE_T0 = 0.9;
const STILL_T = 0.86;           // the frame shown under prefers-reduced-motion

interface Cell { q: number; r: number; x: number; y: number; points: string; key: string }

const f = (n: number): string => n.toFixed(2);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const ramp = (t: number, t0: number, t1: number): number => clamp01((t - t0) / (t1 - t0));
const smooth = (v: number): number => v * v * (3 - 2 * v);

function hexPoints(cx: number, cy: number, r: number): string {
  const out: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    out.push(`${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`);
  }
  return out.join(" ");
}

function buildCells(): Cell[] {
  const cells: Cell[] = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      if (ring === 0 || ring > 2) { continue; }
      const x = 1.5 * S * q;
      const y = SQRT3 * S * (r + q / 2);
      cells.push({ q, r, x, y, points: hexPoints(x, y, S * GAP), key: `${q},${r}` });
    }
  }
  return cells;
}

const CELLS = buildCells();
const angleOf = (c: Cell): number => (Math.atan2(c.y, c.x) + 2.5 * Math.PI) % (2 * Math.PI); // from 12 o'clock
const ringOf = (c: Cell): number => Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r));
// Centre section in draw order: inner ring clockwise from the top, then the outer.
const CENTRE = CELLS.filter((c) => Math.abs(c.q) < 2)
  .sort((a, b) => ringOf(a) - ringOf(b) || angleOf(a) - angleOf(b));
const WING_L = CELLS.filter((c) => c.q === -2);
const WING_R = CELLS.filter((c) => c.q === 2);
// Hinge: the wings fold about the inner vertices of their own column.
const HINGE_X = 1.5 * S * 2 - S;

// Struts run from the secondary to the rim: straight up, and down at 30 deg
// either side of vertical. (Their diffraction spikes are why Webb's stars show
// the faint horizontal pair alongside the six big ones.)
const STRUT_LEN = 23;
const STRUTS = [Math.PI / 2, -Math.PI / 3, -2 * Math.PI / 3].map((a) =>
  `M0,0L${f(STRUT_LEN * Math.cos(a))},${f(-STRUT_LEN * Math.sin(a))}`);

export default defineComponent({
  name: "LoadingMirror",

  data() {
    return { t: STILL_T, raf: 0, start: 0, strutPaths: STRUTS };
  },

  computed: {
    /** Glint centre along the sweep axis, in drawing units (off-mirror when idle). */
    sweep(): number {
      const g = ramp(this.t, GLINT_T0, GLINT_T1);
      return g <= 0 || g >= 1 ? 1e3 : -34 + 68 * g;
    },

    centre(): { key: string; points: string; edge: number; fill: number; glint: number }[] {
      return CENTRE.map((c, i) => {
        const t0 = i * SEG_STEP;
        const p = ramp(this.t, t0, t0 + SEG_DUR);
        return {
          key: c.key,
          points: c.points,
          edge: clamp01(p / 0.6),                 // outline traces first...
          fill: smooth(clamp01((p - 0.45) / 0.55)), // ...then the gold floods in
          glint: this.glintAt(c),
        };
      });
    },

    wings(): { side: string; transform: string; lit: number; segs: { key: string; points: string; glint: number }[] }[] {
      const u = smooth(ramp(this.t, WING_T0, WING_T1));
      // Seen face-on, a wing hinged at x = ±HINGE_X foreshortens by cos(angle).
      const k = Math.max(0.001, u);
      return [
        { side: "L", cells: WING_L, sign: -1 },
        { side: "R", cells: WING_R, sign: 1 },
      ].map(({ side, cells, sign }) => {
        const hx = sign * HINGE_X;
        return {
          side,
          transform: `translate(${f(hx)},0) scale(${k.toFixed(3)},1) translate(${f(-hx)},0)`,
          lit: u,
          segs: cells.map((c) => ({ key: c.key, points: c.points, glint: this.glintAt(c) })),
        };
      });
    },

    struts(): number {
      return smooth(ramp(this.t, STRUT_T0, STRUT_T1));
    },

    fade(): number {
      return 1 - smooth(ramp(this.t, FADE_T0, 1));
    },
  },

  mounted() {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { return; }
    this.start = performance.now();
    const tick = (now: number): void => {
      this.t = ((now - this.start) % CYCLE_MS) / CYCLE_MS;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },

  beforeUnmount() {
    cancelAnimationFrame(this.raf);
  },

  methods: {
    /** A soft diagonal band of light, upper-left to lower-right. */
    glintAt(c: Cell): number {
      const d = (c.x + 0.6 * c.y) - this.sweep;
      return 0.55 * Math.exp(-(d * d) / 60);
    },
  },
});
</script>

<style lang="less">
.loading-mirror {
  width: 4.5rem;
  height: auto;
  flex: none;
  overflow: visible;

  .seg { fill: url(#lmir-gold); }
  .edge {
    fill: none;
    stroke: #ffd38a;
    stroke-width: 0.55;
    stroke-linejoin: round;
    stroke-dasharray: 1;
  }
  .wing-edge { stroke-dasharray: none; }
  .glint { fill: #fff; mix-blend-mode: screen; }
  .strut {
    fill: none;
    stroke: rgba(153, 200, 255, 0.75);
    stroke-width: 0.6;
    stroke-linecap: round;
    stroke-dasharray: 1;
  }
  .secondary { fill: #172133; stroke: #ffd38a; stroke-width: 0.6; }
}
</style>
