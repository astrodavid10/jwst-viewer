// 3D galaxy quality tier, chosen once at load.
//
//   full — Galaxy3D volume slices + star/dust sprites over the 4K Gaia Milky
//          Way, plus the SDSS galaxy "cosmos" (a binary and 256 textures) when
//          zoomed far out. Best on desktops and recent phones.
//   lite — a single flat Gaia Milky Way quad from a self-hosted 2K texture
//          (~16 MB of GPU memory instead of ~64 MB), no volume slices, no
//          sprites, no SDSS cosmos. Markers, constellations, fly-ins and the
//          kiosk 3D interlude all work the same. For older or low-memory
//          devices, and anything without WebGL2.
//
// ?galaxy=lite or ?galaxy=full forces a tier (works with ?kiosk=1 too).
// Without it, lite is picked automatically for devices that report ≤ 4 GB of
// memory, lack WebGL2, or can't hold a 4096² texture.
import { stringParam } from "./urlParams";

export type GalaxyTier = "full" | "lite";

function detectTier(): GalaxyTier {
  const forced = stringParam("galaxy");
  if (forced === "lite" || forced === "full") { return forced; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mem = (navigator as any).deviceMemory as number | undefined;
  if (mem !== undefined && mem <= 4) { return "lite"; }
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) { return "lite"; }
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (maxTex < 4096) { return "lite"; }
  } catch {
    return "lite";
  }
  return "full";
}

export const GALAXY_TIER: GalaxyTier = detectTier();
export const GALAXY_LITE = GALAXY_TIER === "lite";

const GAIA_4K_URL = "https://data1.wwtassets.org/packages/2025/01_gaia_milky_way/Gaia-HighContrast-MilkyWay-4k.jpg";
// Same image downsampled to 2048² (public/gaia-milkyway-2k.jpg); relative so it
// resolves under any deploy path.
const GAIA_2K_URL = "gaia-milkyway-2k.jpg";

export function gaiaMilkyWayUrl(): string {
  return GALAXY_LITE ? new URL(GAIA_2K_URL, document.baseURI).href : GAIA_4K_URL;
}
