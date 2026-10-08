/**
 * Curated distances for the JWST image collection, used to place each image's
 * marker in WWT's native 3D cosmos at true scale.
 *
 * The WTML carries no distance field, so these are hand-curated from each
 * target's literature. Distances are in LIGHT-YEARS. Variants of the same
 * object (MIRI/NIRCam/composite crops) share a distance.
 *
 * Keys are NORMALIZED (see `normalizeName`) so curly vs straight apostrophes
 * and casing don't cause lookup misses. Look up with `distanceLyForName(name)`.
 *
 * `uncertain: true` flags entries A. David should sanity-check — typically the
 * artistic "Picture of the Month" titles where the underlying object (and thus
 * distance) isn't unambiguous, deep fields with no single distance, or where I
 * inferred the object from the title. Distances for well-known catalogued
 * objects (PHANGS spirals, Messier objects, named nebulae) are high-confidence.
 *
 * Units helper: 1 Mly = 1e6 ly, 1 Gly = 1e9 ly.
 */

export interface JwstDistance {
  /** Distance in light-years. */
  ly: number;
  /** True if this value should be reviewed (ambiguous object / deep field / inferred). */
  uncertain?: boolean;
  /** Optional note on the object identification or distance source. */
  note?: string;
}

const MLY = 1e6;
const GLY = 1e9;

/** Normalize a name for robust lookup: lowercase, strip punctuation, collapse spaces. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’']/g, "")      // straight + curly apostrophes
    .replace(/[–—]/g, "-")       // en/em dashes -> hyphen
    .replace(/[^a-z0-9]+/g, " ")           // any other punctuation -> space
    .trim()
    .replace(/\s+/g, " ");
}

// Keyed by normalized name. Build with a small helper so the source stays readable.
const RAW: Record<string, JwstDistance> = {};
function add(names: string | string[], d: JwstDistance): void {
  (Array.isArray(names) ? names : [names]).forEach((n) => {
    RAW[normalizeName(n)] = d;
  });
}

// ── Solar neighborhood / debris discs ─────────────────────────────────────
add("Webb inspects dusty debris disc around Fomalhaut", { ly: 25 });
add("Webb investigates a dusty and dynamic disc", { ly: 63, uncertain: true, note: "Inferred Beta Pictoris debris disc (~63 ly); confirm target." });

// ── Milky Way: star-forming regions, nebulae, protostars (hundreds–thousands ly)
add(["Peeking into Perseus", "A prominent protostar in Perseus"], { ly: 960, note: "NGC 1333, Perseus molecular cloud." });
add("HH 211 (NIRCam image)", { ly: 1000, note: "Perseus molecular cloud." });
add("Star Cluster IC 348 (NIRCam image)", { ly: 1000, note: "IC 348, Perseus." });
add("Herbig-Haro 46/47 (NIRCam image)", { ly: 1470 });
add(["Horsehead Nebula (MIRI image)", "Horsehead Nebula (NIRCam image)"], { ly: 1300 });
add("Protostar L1527", { ly: 460, note: "Taurus star-forming region." });
add("Rho Ophiuchi cloud complex", { ly: 390 });
add("Webb's View of the Molecular Cloud Chameleon I", { ly: 500 });
add(["Long-wavelength NIRCam Orion Nebula", "Short-wavelength NIRCam Orion Nebula",
  "The Orion Bar region (NIRCam image)", "The Orion Bar region (upscaled MIRI image)"], { ly: 1350, note: "Orion Nebula / Orion Bar." });
add(["Carina Nebula Jets (NIRCam Narrowband Filters)", "JWST Carina MIRI"], { ly: 7600, note: "Carina Nebula." });
add("Pillars of Creation (NIRCam and MIRI Composite Image)", { ly: 6500, note: "M16, Eagle Nebula." });
add("Webb Takes a Stunning, Star-Filled Portrait of the Pillars of Creation", { ly: 6500, note: "M16, Eagle Nebula." });
add("Webb's new view of the Crab Nebula", { ly: 6500, note: "M1, Crab Nebula supernova remnant." });
add(["Webb captures detailed beauty of Ring Nebula (MIRI image)", "Webb captures detailed beauty of Ring Nebula (NIRCam image)"], { ly: 2570, note: "M57, Ring Nebula." });
add(["Southern Ring Nebula's Gas (NIRCam and MIRI Composite Compass Image)",
  "Southern Ring Nebula's Spokes (NIRCam and MIRI Composite Image)"], { ly: 2500, note: "NGC 3132, Southern Ring Nebula." });

// ── Milky Way: massive clusters, Wolf-Rayet, supernova remnants ────────────
add(["The exotic stellar population of Westerlund 1", "Westerlund 1 (wide-field view)"], { ly: 12000 });
add("Westerlund 2", { ly: 20000 });
add(["Wolf-Rayet 124 (MIRI image)", "Wolf-Rayet 124 (NIRCam and MIRI composite image)"], { ly: 15000 });
add("Webb Finds Star Duo Forms 'Fingerprint' in Space", { ly: 5000, note: "Wolf-Rayet 140." });
add(["Cas A (NIRCam image)", "Cassiopeia A (MIRI Image)"], { ly: 11000, note: "Cassiopeia A supernova remnant." });
add("Sagittarius C (NIRCam Image)", { ly: 25000, note: "Galactic Center region." });
add("JWST Telescope Alignment Evaluation Image", { ly: 2000, uncertain: true, note: "Alignment star (2MASS J17554042+6551277); distance approximate." });
add("Webb's Fine Guidance Sensor Provides a Preview", { ly: 2000, uncertain: true, note: "Engineering deep star field; no single distance." });
add("Webb Observes a Globular Cluster Sparkling with Separate Stars", { ly: 27000, uncertain: true, note: "Inferred Milky Way globular (e.g. M92); confirm target." });

// ── Magellanic Clouds (~160–200 kly) ───────────────────────────────────────
add(["Tarantula Nebula (MIRI Image)", "Tarantula Nebula (NIRCam Image)"], { ly: 161000, note: "30 Doradus, LMC." });
add("SN 1987A (NIRCam image)", { ly: 168000, note: "LMC." });
add("S1 LMC N79 (cropped)", { ly: 163000, note: "N79, LMC." });
add(["NGC 346 (MIRI image)", "Webb Inspects NGC 346 (NIRCam Image)"], { ly: 200000, note: "SMC." });

// ── Local Group / nearby galaxies (Mly) ────────────────────────────────────
add("NIRCam's view of NGC 6822", { ly: 1.5 * MLY, note: "Barnard's Galaxy." });
add(["NGC 604 (MIRI image)", "NGC 604 (NIRCam image)"], { ly: 2.73 * MLY, note: "H II region in M33." });

// ── PHANGS & other spiral galaxies (tens of Mly) ───────────────────────────
add("NGC 1087", { ly: 80 * MLY });
add("NGC 1300", { ly: 61 * MLY });
add(["NGC 1365", "NGC 1365 (MIRI Image)"], { ly: 56 * MLY });
add("NGC 1385", { ly: 68 * MLY });
add(["NGC 1433", "NGC 1433 (MIRI Image)"], { ly: 46 * MLY });
add("NGC 1512", { ly: 38 * MLY });
add("NGC 1566", { ly: 60 * MLY });
add("NGC 1672", { ly: 49 * MLY });
add("NGC 2835", { ly: 35 * MLY });
add("NGC 3351", { ly: 33 * MLY });
add("NGC 3627", { ly: 31 * MLY });
add("NGC 4254", { ly: 45 * MLY });
add("NGC 4303", { ly: 55 * MLY });
add("NGC 4321", { ly: 55 * MLY });
add("NGC 4535", { ly: 54 * MLY });
add(["NGC 5068", "NGC 5068 (JWST MIRI)", "NGC 5068 (JWST NIRCam)"], { ly: 20 * MLY });
add("NGC 628", { ly: 32 * MLY, note: "M74, Phantom Galaxy." });
add(["NGC 7496", "NGC 7496 (MIRI Image)"], { ly: 78 * MLY });
add("IC 5332", { ly: 30 * MLY });
add("Webb peers behind bars (JWST NIRCam and MIRI)", { ly: 20 * MLY, uncertain: true, note: "Inferred barred PHANGS galaxy (NGC 5068?); confirm target." });
add("Webb visits a star-forming spiral", { ly: 60 * MLY, uncertain: true, note: "PHANGS spiral; specific galaxy/distance unconfirmed." });
add(["M51 (MIRI image)", "M51 (NIRCam image)"], { ly: 31 * MLY, note: "Whirlpool Galaxy." });
add(["M82 (NIRCam image - longer wavelengths)", "M82 (NIRCam image - shorter wavelengths)"], { ly: 12 * MLY, note: "Cigar Galaxy." });
add(["No tricks, just treats (M83 MIRI image)", "No tricks, just treats (M83 NIRCam image)"], { ly: 15 * MLY, note: "M83, Southern Pinwheel." });
add("The hidden intricacies of Messier 106", { ly: 23 * MLY });
add(["Catching the edge of the Phantom Galaxy", "Catching the edge of the Phantom Galaxy (NIRCam image)",
  "The Phantom Galaxy Across the Spectrum", "Webb Inspects the Heart of the Phantom Galaxy"], { ly: 32 * MLY, note: "M74, Phantom Galaxy." });
add(["NGC 4449 (MIRI)", "NGC 4449 (NIRCam image - cropped)", "NGC 4449 (NIRCam)", "A FEAST for the eyes"], { ly: 12.5 * MLY, note: "NGC 4449 (FEAST survey)." });
add("NGC 5468 — Cepheid host galaxy", { ly: 130 * MLY });

// ── More distant galaxies, mergers, AGN (tens–hundreds of Mly) ──────────────
add("A Wreath of Star Formation in NGC 7469", { ly: 220 * MLY });
add("Cartwheel Galaxy (JWST NIRCam and MIRI Composite Image)", { ly: 500 * MLY });
add("Webb captures the spectacular galactic merger Arp 220", { ly: 250 * MLY });
add("Webb Explores a Pair of Merging Galaxies", { ly: 270 * MLY, uncertain: true, note: "Inferred IC 1623 merging pair; confirm target." });
add("VV191", { ly: 400 * MLY, uncertain: true, note: "VV 191 galaxy pair; distance approximate." });
add("A Spiral Amongst Thousands", { ly: 1 * GLY, uncertain: true, note: "LEDA 2046648 (~1 Gly); deep-field background spiral." });

// ── Galaxy clusters & lensing (billions of ly) ─────────────────────────────
add("Webb Delivers Deepest Infrared Image of Universe Yet: SMACS 0723", { ly: 4.6 * GLY, note: "Cluster SMACS 0723 (lens plane)." });
add("Galaxy cluster MACS0416 (Hubble and Webb composite image)", { ly: 4.3 * GLY, note: "Lens plane z~0.4." });
add("Webb Uncovers New Details in Pandora's Cluster", { ly: 3.5 * GLY, note: "Abell 2744 (lens plane)." });
add("Webb spotlights gravitational arcs in 'El Gordo' galaxy cluster (NIRCam image)", { ly: 7 * GLY, note: "ACT-CL J0102-4915 (lens plane z~0.87)." });
add("Galaxy cluster WHL0137-08", { ly: 5.5 * GLY, uncertain: true, note: "Cluster lens plane z~0.57 (hosts Earendel arc, far behind)." });
add("Cosmic Seahorse", { ly: 8 * GLY, uncertain: true, note: "Lensed galaxy behind a cluster; distance approximate." });
add("Jewelled ring", { ly: 6 * GLY, uncertain: true, note: "Lensed quasar (RX J1131-class); lens/source distance approximate." });
add("Seeing Triple", { ly: 4 * GLY, uncertain: true, note: "Lensed supernova in a galaxy cluster; distance approximate." });
add("Webb spots a second lensed supernova in a distant galaxy", { ly: 4 * GLY, uncertain: true, note: "Lensing cluster; distance approximate." });

// ── Very high redshift quasars / galaxies (>10 Gly light-travel) ───────────
add("Quasar J0100+2802 (NIRCam Image)", { ly: 12.8 * GLY, note: "z~6.3." });
add("Webb's View of the Extremely Red Quasar SDSS J165202.64+172852.3", { ly: 11 * GLY, note: "z~2.94." });
add("Lyman-α emitting galaxy EGSY8p7 (NIRCam image)", { ly: 13.2 * GLY, note: "z~8.68." });
add("Webb identifies the earliest strands of the cosmic web", { ly: 13 * GLY, uncertain: true, note: "Quasar field at z~6.8; representative distance." });

// ── Deep fields / surveys (no single distance — representative far value) ───
add("CEERS NIRCam 220804", { ly: 13 * GLY, uncertain: true, note: "CEERS deep field — many galaxies, no single distance." });
add("Cosmic Evolution Early Release Science (CEERS) survey (NIRCam image)", { ly: 13 * GLY, uncertain: true, note: "CEERS deep field — no single distance." });
add(["GOODS-North field (clean)", "GOODS-S field (NIRCam image)"], { ly: 13 * GLY, uncertain: true, note: "GOODS deep field — no single distance." });
add("JWST Advanced Deep Extragalactic Survey (JADES)", { ly: 13 * GLY, uncertain: true, note: "JADES deep field — no single distance." });
add("Webb observes the Hubble Ultra Deep Field", { ly: 13 * GLY, uncertain: true, note: "HUDF — no single distance." });

// ── Ambiguous artistic titles (object identity inferred) ───────────────────
add("A galactic treasury", { ly: 1 * GLY, uncertain: true, note: "Ambiguous title — likely a galaxy cluster; identify target." });
add("A massive cluster is born", { ly: 160000, uncertain: true, note: "Likely a young massive cluster in the LMC/MW; identify target." });
add(["Galactic Get-Together (JWST)", "Galactic gathering"], { ly: 300 * MLY, uncertain: true, note: "Interacting galaxy group; identify target." });
add("Clash of the Titans", { ly: 300 * MLY, uncertain: true, note: "Merging galaxies; identify target." });
add("The life and times of dust", { ly: 11000, uncertain: true, note: "Likely a supernova remnant (Cas A?); identify target." });

// ════════════════════════════════════════════════════════════════════════════
// 2026-06-11 expansion: ~138 new Places from the refreshed jwst.wtml (273 total).
// Distances in light-years. Comparison frames ("Hubble's view of…") share the
// object's distance. `uncertain` flags artistic titles / lensed sources / deep
// fields / objects inferred from the title — sanity-check these.
// ════════════════════════════════════════════════════════════════════════════

// ── Exoplanets & discs ──────────────────────────────────────────────────────
add("Exoplanet Epsilon Indi Ab (MIRI image)", { ly: 12, note: "Epsilon Indi system, ~11.9 ly." });
add("Oph 163131 (wide view)", { ly: 440, note: "Edge-on protoplanetary disc, Ophiuchus." });
add("Tau 042021", { ly: 460, note: "Edge-on protoplanetary disc, Taurus." });
add(["Dusty wisps round a dusty disc", "Zoom in on a dusty disc"], { ly: 450, uncertain: true, note: "Debris/protoplanetary disc; target/distance inferred." });

// ── Protostars / Herbig-Haro jets / forming star systems ────────────────────
add("L1527 (MIRI image)", { ly: 460, note: "Protostar L1527, Taurus." });
add("HH 211 (NIRCam image, cropped)", { ly: 1000, note: "Perseus molecular cloud." });
add("Herbig-Haro 49/50 (NIRCam and MIRI Image)", { ly: 630, note: "Chamaeleon I cloud." });
add("Actively forming star system Lynds 483 (NIRCam image)", { ly: 650, note: "L483, Serpens." });
add("Stellar jet in Sh2-284 (NIRCam image)", { ly: 15000, note: "Sh2-284 H II region." });
add("Serpens Nebula North – aligned outflows crop (NIRCam image)", { ly: 1300, note: "Serpens star-forming region." });
add("A beacon of light in swirls of dust", { ly: 1500, uncertain: true, note: "Likely a protostar/young star; target inferred." });
add("Parallel field to protostar IRAS23385", { ly: 13 * GLY, uncertain: true, note: "Parallel field — background galaxies, no single distance." });

// ── Nebulae (star-forming regions, molecular clouds) ────────────────────────
add(["NIRCam Image of the “Cosmic Cliffs” in Carina",
  "Combined NIRCam and MIRI Image of the “Cosmic Cliffs” in Carina"], { ly: 7600, note: "Carina Nebula (NGC 3324)." });
add("Peeking into Perseus (wide field view)", { ly: 960, note: "NGC 1333, Perseus." });
add(["Serpens Nebula (NIRCam image)", "Serpens Nebula centre crop (NIRCam image)"], { ly: 1300, note: "Serpens star-forming region." });
add("Cat’s Paw Nebula (NIRCam)", { ly: 5500, note: "NGC 6334." });
add(["Sagittarius B2 (NIRCam image)", "Sagittarius B2 (MIRI image)"], { ly: 26000, note: "Galactic Center molecular cloud." });
add("Digel Cloud 2S", { ly: 46000, uncertain: true, note: "Outer-galaxy star-forming region; distance approximate." });
add(["Exposed Cranium Nebula (NIRCam image)", "Exposed Cranium Nebula (MIRI image)"], { ly: 5000, uncertain: true, note: "Nickname title — identify target." });
add("The Orion Bar region (Hubble image)", { ly: 1350, note: "Orion Nebula." });
add(["NGC 602 (NIRCam and MIRI image)", "NGC 602 (Hubble image)", "NGC 602 (Webb image)"], { ly: 200000, note: "Young cluster in the SMC." });
add("NGC 346 (Webb)", { ly: 200000, note: "SMC." });

// ── Planetary nebulae ───────────────────────────────────────────────────────
add(["The Red Spider Nebula, caught by Webb", "Red Spider Nebula NGC 6537 (Hubble’s view)",
  "Webb zooms in on the Red Spider Nebula, NGC 6537"], { ly: 3000, uncertain: true, note: "NGC 6537; distance poorly constrained (~3000-8000 ly)." });
add(["Southern Ring Nebula (NIRCam Image)", "Southern Ring Nebula (MIRI Image)"], { ly: 2500, note: "NGC 3132." });
add(["Webb captures detailed beauty of Ring Nebula (NIRCam image - cropped)",
  "Webb captures detailed beauty of Ring Nebula (MIRI image - cropped)",
  "Hubble’s view of the Ring Nebula (2013 image - cropped)"], { ly: 2570, note: "M57, Ring Nebula." });
add("Planetary Nebula NGC 1514 (MIRI image)", { ly: 1500, note: "NGC 1514." });
add(["NGC 6072 (NIRCam image)", "NGC 6072 (MIRI image)"], { ly: 3000, uncertain: true, note: "NGC 6072 planetary nebula; distance approximate." });
add(["Butterfly Nebula NGC 6302 (Webb and ALMA image)",
  "Butterfly Nebula NGC 6302 (Optical Hubble image)",
  "Butterfly Nebula NGC 6302 (Near-infrared Hubble image)"], { ly: 3400, note: "NGC 6302." });
add("Helix Nebula (NIRCam image)", { ly: 650, note: "NGC 7293." });

// ── Supernova remnants ──────────────────────────────────────────────────────
add(["The Crab Nebula", "Hubble’s view of the Crab Nebula (2005 image)",
  "Crab Nebula (MIRI and NIRCam image)"], { ly: 6500, note: "M1, Crab Nebula." });
add(["Cas A (MIRI image)", "Hubble’s view of Cassiopeia A"], { ly: 11000, note: "Cassiopeia A." });

// ── Stars, Wolf-Rayet systems, star clusters ────────────────────────────────
add(["Wolf-Rayet 140 (MIRI image) - September 2023", "Wolf-Rayet 140 (MIRI image) - July 2022"], { ly: 5000, note: "Wolf-Rayet 140." });
add("Hubble’s view of Wolf-Rayet 124", { ly: 15000, note: "Wolf-Rayet 124." });
add("Wolf-Rayet Apep (MIRI Image)", { ly: 8000, uncertain: true, note: "Apep WR system; distance ~8000 ly (revised)." });
add(["Star-studded cluster", "Star-studded cluster (NGC 6440 NIRCam wide-field image)",
  "Hubble’s view of NGC 6440", "Webb’s view of NGC 6440 (cropped)"], { ly: 28000, note: "Globular cluster NGC 6440." });
add("Westerlund 2 (HST image)", { ly: 20000, note: "Westerlund 2." });
add("A celebrity cluster in the spotlight", { ly: 20000, uncertain: true, note: "Famous star cluster; identify target." });
add("Dwarf stars in a glittering sky", { ly: 25000, uncertain: true, note: "Likely a globular/dense cluster; identify target." });
add("Pismis 24 (NIRCam image)", { ly: 8000, note: "Pismis 24 in NGC 6357." });

// ── Galaxies (spirals, dwarfs, individual) ──────────────────────────────────
add("Leo P (NIRCam image)", { ly: 5.3 * MLY, note: "Leo P dwarf galaxy." });
add("Dwarf Galaxy WLM", { ly: 3 * MLY, note: "WLM, Local Group dwarf." });
add(["NGC 6822 (MIRI image)", "NGC 6822 (NIRCam image)"], { ly: 1.5 * MLY, note: "Barnard's Galaxy." });
add("M51 (MIRI image - cropped)", { ly: 31 * MLY, note: "Whirlpool Galaxy." });
add(["M83 (MIRI image, scaled)", "M83 (NIRCam image, scaled)"], { ly: 15 * MLY, note: "M83, Southern Pinwheel." });
add(["Star-forming regions in M51", "Star-forming region in M51 (close-up)"], { ly: 31 * MLY, note: "Within M51." });
add(["A duo of starbursts in I Zwicky 18", "I Zwicky 18 (wide-field view)"], { ly: 59 * MLY, note: "I Zw 18 dwarf starburst." });
add(["NGC 2566 (MIRI image)", "NGC 2566 (HST image)"], { ly: 76 * MLY });
add(["Messier 77 (MIRI + NIRCam)", "Messier 77 (NIRCam)"], { ly: 47 * MLY, note: "M77, Cetus A (Seyfert)." });
add(["Sombrero Galaxy (NIRCam image)", "Sombrero galaxy (MIRI)"], { ly: 30 * MLY, note: "M104." });
add("Webb Reveals IC 5332 (scaled)", { ly: 30 * MLY, note: "IC 5332." });
add(["Webb’s MIRI peers behind bars", "Webb’s NIRCam peers behind bars"], { ly: 20 * MLY, uncertain: true, note: "Barred PHANGS spiral (NGC 5068?); confirm target." });
add(["Webb Reveals Complex Galactic Structures", "Hubble Sees the Big Picture of a Complex Galaxy"], { ly: 60 * MLY, uncertain: true, note: "Spiral galaxy; identify target." });
add("Tracing spiral arms in infrared", { ly: 60 * MLY, uncertain: true, note: "PHANGS-type spiral; identify target." });
add("Viewing a flaky disc", { ly: 50 * MLY, uncertain: true, note: "Disc galaxy; identify target." });
add("Close look at a local galaxy", { ly: 20 * MLY, uncertain: true, note: "Nearby galaxy; identify target." });
add("The stellar lifecycle in a nearby spiral", { ly: 30 * MLY, uncertain: true, note: "Nearby spiral; identify target." });
add("A starburst shines in infrared", { ly: 30 * MLY, uncertain: true, note: "Starburst galaxy; identify target." });
add("Fireworks of stellar starbursts", { ly: 25 * MLY, uncertain: true, note: "Likely a starburst galaxy (NGC 6946?); identify target." });
add("Kilonova and host galaxy (clean)", { ly: 1 * GLY, uncertain: true, note: "Kilonova transient + host (e.g. GRB 230307A); distance approximate." });

// ── Interacting / merging galaxies ──────────────────────────────────────────
add("Galaxy Pair VV 191 (Webb and Hubble Composite Image)", { ly: 400 * MLY, uncertain: true, note: "VV 191 overlapping pair; distance approximate." });
add(["Stephan’s Quintet (MIRI Imaging)", "Stephan’s Quintet (NIRCam + MIRI Imaging)"], { ly: 290 * MLY, note: "Stephan's Quintet." });
add("Webb Explores a Pair of Merging Galaxies (scaled)", { ly: 270 * MLY, uncertain: true, note: "IC 1623 merging pair; confirm target." });
add("Galactic Get-Together", { ly: 300 * MLY, uncertain: true, note: "Interacting galaxy group; identify target." });
add("NGC 3256 (HST)", { ly: 120 * MLY, note: "Merging galaxy NGC 3256." });
add("A dance of dwarf galaxies", { ly: 50 * MLY, uncertain: true, note: "Interacting dwarfs; identify target." });
add(["Interacting galaxies Arp 142 (NIRCam and MIRI image)", "Interacting galaxies Arp 142 (MIRI image)",
  "Interacting galaxies Arp 142 (NIRCam image)", "Interacting galaxies Arp 142 (NIRCam image, rotated full-field)"], { ly: 326 * MLY, note: "Arp 142 (the Penguin & the Egg)." });
add(["Arp 107 composite image (NIRCam + MIRI)", "Arp 107 MIRI image"], { ly: 465 * MLY, note: "Arp 107." });
add(["Galaxies IC 2163 and NGC 2207 (Webb and Hubble image)",
  "Galaxies IC 2163 and NGC 2207 (Webb MIRI image)"], { ly: 114 * MLY, note: "NGC 2207 / IC 2163." });
add(["Cartwheel Galaxy (NIRCam and MIRI Composite Image)", "Cartwheel Galaxy (MIRI)"], { ly: 500 * MLY, note: "Cartwheel ring galaxy." });

// ── Galaxy clusters & protoclusters ─────────────────────────────────────────
add("Bullet Cluster (NIRCam Image)", { ly: 3.7 * GLY, note: "1E 0657-56, z~0.30 (lens plane)." });
add(["Galaxy cluster SPT-CL J0615−5746 (cropped)", "Galaxy cluster SPT-CL J0615−5746 (wide-field view)"], { ly: 7 * GLY, note: "z~0.97 (lens plane)." });
add("Galaxy cluster MACS J1423 (NIRCam image)", { ly: 5.5 * GLY, note: "z~0.54 (lens plane)." });
add(["MACS J1149.5+2223", "Ready for its closeup: MACS J1149.5+2223 (crop)"], { ly: 5 * GLY, note: "z~0.54 (lens plane)." });
add("MACS J0417.5-1154 Wide Field (NIRCam)", { ly: 5 * GLY, note: "z~0.44 (lens plane)." });
add("Spiderweb Protocluster (NIRCam)", { ly: 10.6 * GLY, uncertain: true, note: "Protocluster at z~2.16." });
add("Webb’s First Deep Field (NIRCam Image)", { ly: 4.6 * GLY, note: "Cluster SMACS 0723 (lens plane)." });

// ── Gravitational lenses & lensed sources ───────────────────────────────────
add(["Gravitational lens COSJ100024+021749", "Gravitational lens COSJ100018+022138",
  "Gravitational lens COSJ100024+015334", "Gravitational lens COSJ100013+023424",
  "Gravitational lens COSJ095593+023319", "Gravitational lens COSJ095914+021219",
  "Gravitational lens COSJ100025+015245", "Gravitational lens COSJ095921+020638"], { ly: 5 * GLY, uncertain: true, note: "COSMOS-Web lens candidate; lens/source distance approximate." });
add("Spying a spiral through a cosmic lens", { ly: 5 * GLY, uncertain: true, note: "Lensed spiral; distance approximate." });
add("Lensed Question Mark Galaxy (NIRCam)", { ly: 7 * GLY, uncertain: true, note: "Lensed source behind MACS J0417; distance approximate." });
add("Star clusters in the Cosmic Gems arc (cropped)", { ly: 13 * GLY, uncertain: true, note: "Lensed arc at z~10.2." });

// ── Deep fields / surveys / very high-z ──────────────────────────────────────
add("CEERS crop (NIRCam image)", { ly: 13 * GLY, uncertain: true, note: "CEERS deep field — no single distance." });
add("Webb finds most distant known galaxy (JADES-GS-z14-0 environment NIRCam image)", { ly: 13.4 * GLY, uncertain: true, note: "JADES-GS-z14-0, z~14.32." });
add("JADES-GS-z13-1 (NIRCam close-up)", { ly: 13.4 * GLY, uncertain: true, note: "JADES-GS-z13-1, z~13.0." });
add("ZS7 environment (NIRcam image)", { ly: 13 * GLY, uncertain: true, note: "z~7.15 field; representative distance." });
add("Crop of the GOODS-S field: JADES (NIRCam image, clean)", { ly: 13 * GLY, uncertain: true, note: "JADES/GOODS-S deep field — no single distance." });
add(["A visual feast of galaxies", "A visual feast of galaxies, from infrared to X-ray"], { ly: 1 * GLY, uncertain: true, note: "Galaxy field/cluster; identify target." });
add("A glimpse of the distant past", { ly: 13 * GLY, uncertain: true, note: "Deep field; no single distance." });
add(["A fresh look at a classic deep field", "Portion of the Hubble eXtreme Deep Field"], { ly: 13 * GLY, uncertain: true, note: "Hubble (e)XDF region — no single distance." });
add("Webb Takes a Stunning, Star-Filled Portrait of the Pillars of Creation (Cropped)", { ly: 6500, note: "M16, Eagle Nebula." });

// ════════════════════════════════════════════════════════════════════════════
// 2026-07 expansion: 12 new Places from jwst-july2026.wtml (285 total).
// See jwstTypes.ts for the matching type entries and CATALOG_UPDATE.md for the
// process. Variants of one object share a distance.
// ════════════════════════════════════════════════════════════════════════════
add(["Centaurus A (MIRI + NIRCam image wide-field view)", "Centaurus A (MIRI + NIRCam image)",
  "Centaurus A (MIRI image)", "Centaurus A (NIRCam image)"], { ly: 12 * MLY, note: "NGC 5128, Centaurus A active galaxy." });
add(["M82 (Webb NIRCam image)", "The Cigar Galaxy: M82 (Webb NIRCam image)",
  "The Cigar Galaxy: M82 (Webb and Hubble image)"], { ly: 12 * MLY, note: "M82, the Cigar Galaxy (starburst)." });
add("Bulge fossil fragment Terzan 5 (Webb and Hubble image)", { ly: 19000, note: "Terzan 5, Milky Way bulge star cluster." });
add("FS Tau (Webb NIRCam image)", { ly: 450, note: "FS Tau young star system, Taurus." });
add("Webb unveils young stars across every stage of formation", { ly: 1350, uncertain: true, note: "Orion A molecular cloud; young stellar objects." });
add("Abell S1063 galaxy cluster", { ly: 4 * GLY, note: "Abell S1063 (RXC J2248.7-4431), z~0.348 (lens plane)." });
add("A cosmic construction project", { ly: 4.4 * GLY, uncertain: true, note: "Galaxy cluster MACS J0553.4-3342, z~0.412." });

/** Look up a curated distance (light-years) for an image by name. Returns null if unknown. */
export function distanceForName(name: string): JwstDistance | null {
  return RAW[normalizeName(name)] ?? null;
}

/** Distance in light-years, or null if the name isn't in the table. */
export function distanceLyForName(name: string): number | null {
  return distanceForName(name)?.ly ?? null;
}

export const jwstDistances = RAW;
