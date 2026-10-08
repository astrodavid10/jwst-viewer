/**
 * Curated object-type classification for the JWST image collection. Drives the
 * colored corner badge on each gallery thumbnail (and, later, the 3D markers)
 * plus the gallery's filter/legend chips.
 *
 * The WTML carries no reliable object-type field (Place.Classification is mostly
 * Unidentified here), so these are hand-curated from each target's literature —
 * the same source and the same groupings used in `jwstDistances.ts`. Variants of
 * one object (MIRI/NIRCam/composite crops) share a type.
 *
 * Keys are NORMALIZED via the shared `normalizeName` (curly vs straight
 * apostrophes and casing don't cause misses). Look up with `typeForName(name)`.
 *
 * Two levels:
 *  - A fine `JwstType` per image → drives the badge (icon + color + label).
 *  - A broader `JwstGroup` (each type belongs to one) → drives the filter chips,
 *    so "show only galaxies / nebulae / clusters" stays a short, legible row.
 */

import { normalizeName } from "./jwstDistances";

/** Fine-grained object type. Drives the per-thumbnail badge. */
export type JwstType =
  | "debrisDisk"
  | "nebula"
  | "planetaryNebula"
  | "supernovaRemnant"
  | "protostar"
  | "star"
  | "starCluster"
  | "galaxy"
  | "galaxyMerger"
  | "galaxyCluster"
  | "gravitationalLens"
  | "quasar"
  | "deepField"
  | "exoplanet";

/** Broad bucket for the gallery filter chips. */
export type JwstGroup =
  | "starsAndDiscs"
  | "nebulae"
  | "starClusters"
  | "galaxies"
  | "deepAndDistant";

export interface JwstTypeMeta {
  /** Short human label, used in the badge tooltip. */
  label: string;
  /** Badge color (also the marker color in 3D later). */
  color: string;
  /** FontAwesome free-solid icon name (kebab-case, e.g. "hurricane"). Must be
   *  registered in main.ts. */
  icon: string;
  /** Filter-chip bucket this type rolls up into. */
  group: JwstGroup;
}

/** Type → presentation. Colors are grouped by hue family where sensible so the
 *  badges read as related to their filter group, while staying distinct. */
export const TYPE_META: Record<JwstType, JwstTypeMeta> = {
  // ── Stars & discs (warm/gold family) ────────────────────────────────────
  star:            { label: "Star",                color: "#ffe066", icon: "star",          group: "starsAndDiscs" },
  protostar:       { label: "Protostar / Jet",     color: "#ff9e4a", icon: "star-of-life",  group: "starsAndDiscs" },
  debrisDisk:      { label: "Debris Disk",         color: "#ffd1a3", icon: "compact-disc",  group: "starsAndDiscs" },
  exoplanet:       { label: "Exoplanet",           color: "#ffc14d", icon: "globe",         group: "starsAndDiscs" },
  // ── Nebulae ─────────────────────────────────────────────────────────────
  nebula:          { label: "Nebula",              color: "#c77dff", icon: "cloud",         group: "nebulae" },
  planetaryNebula: { label: "Planetary Nebula",    color: "#5ee0c5", icon: "circle-dot",    group: "nebulae" },
  supernovaRemnant:{ label: "Supernova Remnant",   color: "#ff6b6b", icon: "burst",         group: "nebulae" },
  // ── Star clusters ───────────────────────────────────────────────────────
  starCluster:     { label: "Star Cluster",        color: "#9ad0ff", icon: "braille",       group: "starClusters" },
  // ── Galaxies ────────────────────────────────────────────────────────────
  galaxy:          { label: "Galaxy",              color: "#6db3ff", icon: "hurricane",     group: "galaxies" },
  galaxyMerger:    { label: "Interacting Galaxies",color: "#ff7fb0", icon: "circle-nodes",  group: "galaxies" },
  // ── Galaxy clusters, lensing, deep & distant ────────────────────────────
  galaxyCluster:   { label: "Galaxy Cluster",      color: "#7cfc9b", icon: "layer-group",  group: "deepAndDistant" },
  // Was #5ee0c5, identical to planetaryNebula, so the two were
  // indistinguishable as 3D markers (audit J10).
  gravitationalLens:{ label: "Gravitational Lens", color: "#c6f36b", icon: "ring",          group: "deepAndDistant" },
  quasar:          { label: "Quasar / AGN",        color: "#d8b4ff", icon: "bolt",          group: "deepAndDistant" },
  deepField:       { label: "Deep Field / Survey", color: "#b0b6c8", icon: "table-cells",   group: "deepAndDistant" },
};

export interface JwstGroupMeta {
  label: string;
  color: string;
  /** A representative icon for the chip (one of the group's member types). */
  icon: string;
}

/** Filter-chip buckets, in display order. */
export const GROUP_META: Record<JwstGroup, JwstGroupMeta> = {
  starsAndDiscs:  { label: "Stars & Discs",     color: "#ffe066", icon: "star" },
  nebulae:        { label: "Nebulae",           color: "#c77dff", icon: "cloud" },
  starClusters:   { label: "Star Clusters",     color: "#9ad0ff", icon: "braille" },
  galaxies:       { label: "Galaxies",          color: "#6db3ff", icon: "hurricane" },
  deepAndDistant: { label: "Galaxy Clusters & Deep Fields", color: "#7cfc9b", icon: "layer-group" },
};

/** Group keys in display order (object insertion order is stable for strings). */
export const GROUP_ORDER = Object.keys(GROUP_META) as JwstGroup[];

// Keyed by normalized name. Same readable add() helper as jwstDistances.ts.
const RAW: Record<string, JwstType> = {};
function add(names: string | string[], t: JwstType): void {
  (Array.isArray(names) ? names : [names]).forEach((n) => {
    RAW[normalizeName(n)] = t;
  });
}

// ── Solar neighborhood / debris discs ──────────────────────────────────────
add("Webb inspects dusty debris disc around Fomalhaut", "debrisDisk");
add("Webb investigates a dusty and dynamic disc", "debrisDisk"); // Beta Pictoris

// ── Milky Way: star-forming regions, nebulae, protostars ────────────────────
add("Peeking into Perseus", "nebula");                 // NGC 1333 star-forming region
add("A prominent protostar in Perseus", "protostar");
add("HH 211 (NIRCam image)", "protostar");             // Herbig-Haro outflow
add("Herbig-Haro 46/47 (NIRCam image)", "protostar");
add("Protostar L1527", "protostar");
add("Star Cluster IC 348 (NIRCam image)", "starCluster");
add(["Horsehead Nebula (MIRI image)", "Horsehead Nebula (NIRCam image)"], "nebula");
add("Rho Ophiuchi cloud complex", "nebula");
add("Webb’s View of the Molecular Cloud Chameleon I", "nebula");
add(["Long-wavelength NIRCam Orion Nebula", "Short-wavelength NIRCam Orion Nebula",
  "The Orion Bar region (NIRCam image)", "The Orion Bar region (upscaled MIRI image)"], "nebula");
add(["Carina Nebula Jets (NIRCam Narrowband Filters)", "JWST Carina MIRI"], "nebula");
add("Pillars of Creation (NIRCam and MIRI Composite Image)", "nebula");
add("Webb Takes a Stunning, Star-Filled Portrait of the Pillars of Creation", "nebula");
add("Sagittarius C (NIRCam Image)", "nebula");

// ── Planetary nebulae & supernova remnants ──────────────────────────────────
add(["Webb captures detailed beauty of Ring Nebula (MIRI image)", "Webb captures detailed beauty of Ring Nebula (NIRCam image)"], "planetaryNebula");
add(["Southern Ring Nebula’s Gas (NIRCam and MIRI Composite Compass Image)",
  "Southern Ring Nebula’s Spokes (NIRCam and MIRI Composite Image)"], "planetaryNebula");
add("Webb’s new view of the Crab Nebula", "supernovaRemnant");
add(["Cas A (NIRCam image)", "Cassiopeia A (MIRI Image)"], "supernovaRemnant");
add("The life and times of dust", "supernovaRemnant"); // likely Cas A

// ── Massive clusters, Wolf-Rayet stars, engineering star images ─────────────
add(["The exotic stellar population of Westerlund 1", "Westerlund 1 (wide-field view)"], "starCluster");
add("Westerlund 2", "starCluster");
add("Webb Observes a Globular Cluster Sparkling with Separate Stars", "starCluster");
add("A massive cluster is born", "starCluster");
add(["Wolf-Rayet 124 (MIRI image)", "Wolf-Rayet 124 (NIRCam and MIRI composite image)"], "star");
add("Webb Finds Star Duo Forms ‘Fingerprint’ in Space", "star"); // Wolf-Rayet 140
add("JWST Telescope Alignment Evaluation Image", "star");
add("Webb’s Fine Guidance Sensor Provides a Preview", "star");

// ── Magellanic Clouds ───────────────────────────────────────────────────────
add(["Tarantula Nebula (MIRI Image)", "Tarantula Nebula (NIRCam Image)"], "nebula");
add("S1 LMC N79 (cropped)", "nebula");
add(["NGC 346 (MIRI image)", "Webb Inspects NGC 346 (NIRCam Image)"], "nebula");
add("SN 1987A (NIRCam image)", "supernovaRemnant");

// ── Nebulae inside nearby galaxies ──────────────────────────────────────────
add(["NGC 604 (MIRI image)", "NGC 604 (NIRCam image)"], "nebula"); // H II region in M33

// ── Galaxies (individual / spirals) ─────────────────────────────────────────
add("NIRCam’s view of NGC 6822", "galaxy");
add(["NGC 1087", "NGC 1300", "NGC 1365", "NGC 1365 (MIRI Image)", "NGC 1385",
  "NGC 1433", "NGC 1433 (MIRI Image)", "NGC 1512", "NGC 1566", "NGC 1672",
  "NGC 2835", "NGC 3351", "NGC 3627", "NGC 4254", "NGC 4303", "NGC 4321",
  "NGC 4535", "NGC 5068", "NGC 5068 (JWST MIRI)", "NGC 5068 (JWST NIRCam)",
  "NGC 628", "NGC 7496", "NGC 7496 (MIRI Image)", "IC 5332"], "galaxy");
add("Webb peers behind bars (JWST NIRCam and MIRI)", "galaxy");
add("Webb visits a star-forming spiral", "galaxy");
add(["M51 (MIRI image)", "M51 (NIRCam image)"], "galaxy");
add(["M82 (NIRCam image - longer wavelengths)", "M82 (NIRCam image - shorter wavelengths)"], "galaxy");
add(["No tricks, just treats (M83 MIRI image)", "No tricks, just treats (M83 NIRCam image)"], "galaxy");
add("The hidden intricacies of Messier 106", "galaxy");
add(["Catching the edge of the Phantom Galaxy", "Catching the edge of the Phantom Galaxy (NIRCam image)",
  "The Phantom Galaxy Across the Spectrum", "Webb Inspects the Heart of the Phantom Galaxy"], "galaxy");
add(["NGC 4449 (MIRI)", "NGC 4449 (NIRCam image - cropped)", "NGC 4449 (NIRCam)", "A FEAST for the eyes"], "galaxy");
add("NGC 5468 — Cepheid host galaxy", "galaxy");
add("A Wreath of Star Formation in NGC 7469", "galaxy");
add("A Spiral Amongst Thousands", "galaxy"); // LEDA 2046648, deep-field background spiral

// ── Interacting / merging galaxies ──────────────────────────────────────────
add("Cartwheel Galaxy (JWST NIRCam and MIRI Composite Image)", "galaxyMerger");
add("Webb captures the spectacular galactic merger Arp 220", "galaxyMerger");
add("Webb Explores a Pair of Merging Galaxies", "galaxyMerger");
add("VV191", "galaxyMerger");
add(["Galactic Get-Together (JWST)", "Galactic gathering"], "galaxyMerger");
add("Clash of the Titans", "galaxyMerger");

// ── Galaxy clusters & gravitational lensing ─────────────────────────────────
add("Webb Delivers Deepest Infrared Image of Universe Yet: SMACS 0723", "galaxyCluster");
add("Galaxy cluster MACS0416 (Hubble and Webb composite image)", "galaxyCluster");
add("Webb Uncovers New Details in Pandora’s Cluster", "galaxyCluster");
add("Webb spotlights gravitational arcs in ‘El Gordo’ galaxy cluster (NIRCam image)", "galaxyCluster");
add("Galaxy cluster WHL0137-08", "galaxyCluster");
add("Cosmic Seahorse", "galaxyCluster");          // lensed galaxy behind a cluster
add("Jewelled ring", "galaxyCluster");            // Einstein ring / lensing
add("Seeing Triple", "galaxyCluster");            // lensed supernova in a cluster
add("Webb spots a second lensed supernova in a distant galaxy", "galaxyCluster");
add("A galactic treasury", "galaxyCluster");      // ambiguous; likely a cluster

// ── Quasars / AGN ───────────────────────────────────────────────────────────
add("Quasar J0100+2802 (NIRCam Image)", "quasar");
add("Webb’s View of the Extremely Red Quasar SDSS J165202.64+172852.3", "quasar");
add("Webb identifies the earliest strands of the cosmic web", "quasar"); // quasar field

// ── Deep fields / surveys ───────────────────────────────────────────────────
add("Lyman-α emitting galaxy EGSY8p7 (NIRCam image)", "deepField");
add("CEERS NIRCam 220804", "deepField");
add("Cosmic Evolution Early Release Science (CEERS) survey (NIRCam image)", "deepField");
add(["GOODS-North field (clean)", "GOODS-S field (NIRCam image)"], "deepField");
add("JWST Advanced Deep Extragalactic Survey (JADES)", "deepField");
add("Webb observes the Hubble Ultra Deep Field", "deepField");

// ════════════════════════════════════════════════════════════════════════════
// 2026-06-11 expansion: ~138 new Places from the refreshed jwst.wtml (273 total).
// Non-JWST comparison frames ("Hubble's view of…", HST/ALMA/Optical) share the
// object's type. New types this batch: `exoplanet`, `gravitationalLens`.
// ════════════════════════════════════════════════════════════════════════════

// ── Exoplanets & discs ──────────────────────────────────────────────────────
add("Exoplanet Epsilon Indi Ab (MIRI image)", "exoplanet");
add(["Oph 163131 (wide view)", "Tau 042021"], "debrisDisk");         // edge-on protoplanetary discs
add(["Dusty wisps round a dusty disc", "Zoom in on a dusty disc"], "debrisDisk");

// ── Protostars / Herbig-Haro jets / forming star systems ────────────────────
add("L1527 (MIRI image)", "protostar");
add("HH 211 (NIRCam image, cropped)", "protostar");
add("Herbig-Haro 49/50 (NIRCam and MIRI Image)", "protostar");
add("Actively forming star system Lynds 483 (NIRCam image)", "protostar");
add("Stellar jet in Sh2-284 (NIRCam image)", "protostar");
add("Serpens Nebula North – aligned outflows crop (NIRCam image)", "protostar");
add("A beacon of light in swirls of dust", "protostar");
add("Parallel field to protostar IRAS23385", "deepField");           // parallel field = background galaxies

// ── Nebulae (star-forming regions, molecular clouds) ────────────────────────
add(["NIRCam Image of the “Cosmic Cliffs” in Carina",
  "Combined NIRCam and MIRI Image of the “Cosmic Cliffs” in Carina"], "nebula");
add("Peeking into Perseus (wide field view)", "nebula");
add(["Serpens Nebula (NIRCam image)", "Serpens Nebula centre crop (NIRCam image)"], "nebula");
add("Cat’s Paw Nebula (NIRCam)", "nebula");
add(["Sagittarius B2 (NIRCam image)", "Sagittarius B2 (MIRI image)"], "nebula");
add("Digel Cloud 2S", "nebula");
add(["Exposed Cranium Nebula (NIRCam image)", "Exposed Cranium Nebula (MIRI image)"], "nebula");
add("The Orion Bar region (Hubble image)", "nebula");
add("NGC 602 (NIRCam and MIRI image)", "starCluster");               // young cluster + nebula in SMC
add(["NGC 602 (Hubble image)", "NGC 602 (Webb image)"], "starCluster");
add("NGC 346 (Webb)", "nebula");

// ── Planetary nebulae ───────────────────────────────────────────────────────
add(["The Red Spider Nebula, caught by Webb", "Red Spider Nebula NGC 6537 (Hubble’s view)",
  "Webb zooms in on the Red Spider Nebula, NGC 6537"], "planetaryNebula");
add(["Southern Ring Nebula (NIRCam Image)", "Southern Ring Nebula (MIRI Image)"], "planetaryNebula");
add(["Webb captures detailed beauty of Ring Nebula (NIRCam image - cropped)",
  "Webb captures detailed beauty of Ring Nebula (MIRI image - cropped)",
  "Hubble’s view of the Ring Nebula (2013 image - cropped)"], "planetaryNebula");
add("Planetary Nebula NGC 1514 (MIRI image)", "planetaryNebula");
add(["NGC 6072 (NIRCam image)", "NGC 6072 (MIRI image)"], "planetaryNebula");
add(["Butterfly Nebula NGC 6302 (Webb and ALMA image)",
  "Butterfly Nebula NGC 6302 (Optical Hubble image)",
  "Butterfly Nebula NGC 6302 (Near-infrared Hubble image)"], "planetaryNebula");
add("Helix Nebula (NIRCam image)", "planetaryNebula");

// ── Supernova remnants ──────────────────────────────────────────────────────
add(["The Crab Nebula", "Hubble’s view of the Crab Nebula (2005 image)",
  "Crab Nebula (MIRI and NIRCam image)"], "supernovaRemnant");
add(["Cas A (MIRI image)", "Hubble’s view of Cassiopeia A"], "supernovaRemnant");

// ── Stars, Wolf-Rayet systems, star clusters ────────────────────────────────
add(["Wolf-Rayet 140 (MIRI image) - September 2023", "Wolf-Rayet 140 (MIRI image) - July 2022"], "star");
add("Hubble’s view of Wolf-Rayet 124", "star");
add("Wolf-Rayet Apep (MIRI Image)", "star");
add(["Star-studded cluster", "Star-studded cluster (NGC 6440 NIRCam wide-field image)",
  "Hubble’s view of NGC 6440", "Webb’s view of NGC 6440 (cropped)"], "starCluster");
add("Westerlund 2 (HST image)", "starCluster");
add("A celebrity cluster in the spotlight", "starCluster");
add("Dwarf stars in a glittering sky", "starCluster");
add("Pismis 24 (NIRCam image)", "starCluster");

// ── Galaxies (spirals, dwarfs, individual) ──────────────────────────────────
add("Leo P (NIRCam image)", "galaxy");
add("Dwarf Galaxy WLM", "galaxy");
add(["NGC 6822 (MIRI image)", "NGC 6822 (NIRCam image)"], "galaxy");
add("M51 (MIRI image - cropped)", "galaxy");
add(["M83 (MIRI image, scaled)", "M83 (NIRCam image, scaled)"], "galaxy");
add(["Star-forming regions in M51", "Star-forming region in M51 (close-up)"], "galaxy");
add(["A duo of starbursts in I Zwicky 18", "I Zwicky 18 (wide-field view)"], "galaxy");
add(["NGC 2566 (MIRI image)", "NGC 2566 (HST image)"], "galaxy");
add(["Messier 77 (MIRI + NIRCam)", "Messier 77 (NIRCam)"], "galaxy");
add(["Sombrero Galaxy (NIRCam image)", "Sombrero galaxy (MIRI)"], "galaxy");
add("Webb Reveals IC 5332 (scaled)", "galaxy");
add(["Webb’s MIRI peers behind bars", "Webb’s NIRCam peers behind bars"], "galaxy");
add(["Webb Reveals Complex Galactic Structures", "Hubble Sees the Big Picture of a Complex Galaxy"], "galaxy");
add("Tracing spiral arms in infrared", "galaxy");
add("Viewing a flaky disc", "galaxy");
add("Close look at a local galaxy", "galaxy");
add("The stellar lifecycle in a nearby spiral", "galaxy");
add("A starburst shines in infrared", "galaxy");
add("Fireworks of stellar starbursts", "galaxy");
add("Kilonova and host galaxy (clean)", "galaxy");                   // kilonova transient + host

// ── Interacting / merging galaxies ──────────────────────────────────────────
add("Galaxy Pair VV 191 (Webb and Hubble Composite Image)", "galaxyMerger");
add(["Stephan’s Quintet (MIRI Imaging)", "Stephan’s Quintet (NIRCam + MIRI Imaging)"], "galaxyMerger");
add("Webb Explores a Pair of Merging Galaxies (scaled)", "galaxyMerger");
add("Galactic Get-Together", "galaxyMerger");
add("NGC 3256 (HST)", "galaxyMerger");
add("A dance of dwarf galaxies", "galaxyMerger");
add(["Interacting galaxies Arp 142 (NIRCam and MIRI image)", "Interacting galaxies Arp 142 (MIRI image)",
  "Interacting galaxies Arp 142 (NIRCam image)", "Interacting galaxies Arp 142 (NIRCam image, rotated full-field)"], "galaxyMerger");
add(["Arp 107 composite image (NIRCam + MIRI)", "Arp 107 MIRI image"], "galaxyMerger");
add(["Galaxies IC 2163 and NGC 2207 (Webb and Hubble image)",
  "Galaxies IC 2163 and NGC 2207 (Webb MIRI image)"], "galaxyMerger");
add(["Cartwheel Galaxy (NIRCam and MIRI Composite Image)", "Cartwheel Galaxy (MIRI)"], "galaxyMerger");

// ── Galaxy clusters & protoclusters ─────────────────────────────────────────
add("Bullet Cluster (NIRCam Image)", "galaxyCluster");
add(["Galaxy cluster SPT-CL J0615−5746 (cropped)", "Galaxy cluster SPT-CL J0615−5746 (wide-field view)"], "galaxyCluster");
add("Galaxy cluster MACS J1423 (NIRCam image)", "galaxyCluster");
add(["MACS J1149.5+2223", "Ready for its closeup: MACS J1149.5+2223 (crop)"], "galaxyCluster");
add("MACS J0417.5-1154 Wide Field (NIRCam)", "galaxyCluster");
add("Spiderweb Protocluster (NIRCam)", "galaxyCluster");
add("Webb’s First Deep Field (NIRCam Image)", "galaxyCluster");      // SMACS 0723

// ── Gravitational lenses & lensed sources ───────────────────────────────────
add(["Gravitational lens COSJ100024+021749", "Gravitational lens COSJ100018+022138",
  "Gravitational lens COSJ100024+015334", "Gravitational lens COSJ100013+023424",
  "Gravitational lens COSJ095593+023319", "Gravitational lens COSJ095914+021219",
  "Gravitational lens COSJ100025+015245", "Gravitational lens COSJ095921+020638"], "gravitationalLens");
add("Spying a spiral through a cosmic lens", "gravitationalLens");
add("Lensed Question Mark Galaxy (NIRCam)", "gravitationalLens");
add("Star clusters in the Cosmic Gems arc (cropped)", "gravitationalLens");

// ── Deep fields / surveys / very high-z ──────────────────────────────────────
add("CEERS crop (NIRCam image)", "deepField");
add("Webb finds most distant known galaxy (JADES-GS-z14-0 environment NIRCam image)", "deepField");
add("JADES-GS-z13-1 (NIRCam close-up)", "deepField");
add("ZS7 environment (NIRcam image)", "deepField");
add("Crop of the GOODS-S field: JADES (NIRCam image, clean)", "deepField");
add(["A visual feast of galaxies", "A visual feast of galaxies, from infrared to X-ray"], "deepField");
add("A glimpse of the distant past", "deepField");
add(["A fresh look at a classic deep field", "Portion of the Hubble eXtreme Deep Field"], "deepField");
add(["Webb Takes a Stunning, Star-Filled Portrait of the Pillars of Creation (Cropped)"], "nebula");

// ════════════════════════════════════════════════════════════════════════════
// 2026-07 expansion: 12 new Places from jwst-july2026.wtml (269 total after).
// See jwstDistances.ts for matching distances and CATALOG_UPDATE.md for process.
// No new fine types this batch — all roll into existing groups/chips.
// ════════════════════════════════════════════════════════════════════════════
add(["Centaurus A (MIRI + NIRCam image wide-field view)", "Centaurus A (MIRI + NIRCam image)",
  "Centaurus A (MIRI image)", "Centaurus A (NIRCam image)"], "galaxy");            // NGC 5128 active galaxy
add(["M82 (Webb NIRCam image)", "The Cigar Galaxy: M82 (Webb NIRCam image)",
  "The Cigar Galaxy: M82 (Webb and Hubble image)"], "galaxy");                     // M82 starburst
add("Bulge fossil fragment Terzan 5 (Webb and Hubble image)", "starCluster");      // MW bulge cluster
add("FS Tau (Webb NIRCam image)", "protostar");                                    // young star system, Taurus
add("Webb unveils young stars across every stage of formation", "nebula");         // Orion A molecular cloud
add("Abell S1063 galaxy cluster", "galaxyCluster");
add("A cosmic construction project", "galaxyCluster");                             // MACS J0553.4-3342

// ════════════════════════════════════════════════════════════════════════════
// 2026-10 expansion: 17 new Places from the esawebb.org refresh (286 total
// after). No new fine types.
// ════════════════════════════════════════════════════════════════════════════
add("Webb opens a Treasure Chest filled with stars", "nebula");                    // Carina Nebula
add(["Striking star clusters and irregular clumps", "Starstruck image of Arp 263",
  "Arp 263 (crop)"], "galaxyMerger");                                              // final phase of a merger
add("Galaxies in a cosmic house of mirrors", "galaxyCluster");                     // MACS J0454.1-0300, lensing
add(["Lion Nebula (NIRCam + MIRI image)", "Lion Nebula (MIRI image)"], "planetaryNebula"); // NGC 2392
add(["IRS 3 Field (NIRCam and MIRI image)", "IRS 3 Field (NIRCam image)",
  "IRS 3 Field (MIRI image)"], "star");                                            // evolved star near Sgr A*
add("Star-forming region IC 348 (NIRCam image)", "nebula");                      // 1.18-gigapixel mosaic
add("IC 348 Crop: Star embedded in a nebula", "star");
add("IC 348 Crop: Central star cluster", "starCluster");
add("IC 348 Crop: Stars and faint outflows", "protostar");
add("IC 348 Crop: Gravitational lensing", "gravitationalLens");
add("IC 348 Crop: Spiral galaxies", "galaxy");
add("NGC 7129 (NIRCam image)", "nebula");                                          // reflection nebula + young cluster

/** Look up the fine object type for an image name. Returns null if unknown. */
export function typeForName(name: string): JwstType | null {
  return RAW[normalizeName(name)] ?? null;
}

/** Presentation metadata for an image's type, or null if unknown. */
export function typeMetaForName(name: string): (JwstTypeMeta & { type: JwstType }) | null {
  const t = typeForName(name);
  return t ? { type: t, ...TYPE_META[t] } : null;
}

/** The broad filter group for an image name, or null if unknown. */
export function groupForName(name: string): JwstGroup | null {
  const t = typeForName(name);
  return t ? TYPE_META[t].group : null;
}

export const jwstTypes = RAW;
