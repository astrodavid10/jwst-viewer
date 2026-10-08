"""Build web-ready COSMOS-Web 3D field assets for the JWST viewer.

Reads the COSMOS-Web galaxy catalog (a TAB-DELIMITED text file, despite the
``.db`` extension) plus the per-galaxy PNG stamps, and emits three compact
assets into ``public/cosmosweb/``:

- ``field.bin``  binary positions + colors + sprite index for ALL galaxies.
- ``atlas.png``  one bounded sprite atlas: cell 0 = a generic soft blob, and
                 cells 1.. = downsampled JWST cutouts for the top-N galaxies by
                 ``density_excess`` (configurable).
- ``atlas.json`` sidecar describing the atlas grid (UV rects are implicit from
                 the regular grid, so we do not ship 4096 explicit rects).

The renderer (``src/cosmosweb-field.ts``) re-derives each galaxy's world
position from RA/Dec/distance stored in ``field.bin`` via the engine's
``Coordinates.raDecTo3dAu`` + ecliptic rotateX, matching the JWST markers EXACTLY
so the field aligns with the sky.

Run (defaults are sensible)::

    python tools/build_cosmosweb_assets.py
    python tools/build_cosmosweb_assets.py --unique 8192 --cell 48 --webp

See ``COSMOSWEB_PLAN.md`` in the repo root for the full rationale, file formats,
size budget, and the integration snippet for the other developer.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# Configurable constants (CLI flags override these)
# ---------------------------------------------------------------------------

# Source: the production color catalog (TSV) + its stamp directory.
SRC_DB = Path(
    r"C:\Data\2026\05_cosmosweb\CosmicWeb\outputs\digistar"
    r"\cosmosweb_galaxies_with_fitsmap_sprites.db"
)
# Stamp paths in the DB are relative to the DB's directory.
STAMP_ROOT = SRC_DB.parent

REPO_ROOT = Path(__file__).resolve().parent.parent
# Kept out of public/ so the disabled feature does not ship (audit J1); copy
# to public/cosmosweb when re-enabling the COSMOS-Web menu item.
OUT_DIR = REPO_ROOT / "optional-assets" / "cosmosweb"

MAX_GALAXIES = 164155      # cap on rows emitted (positions are cheap; keep all)
UNIQUE_SPRITES = 4096      # how many top-N galaxies get their REAL cutout
CELL_PX = 32               # atlas cell size in px (sprites render small)
ATLAS_MAX_PX = 4096        # atlas never exceeds this on a side
SORT_KEY = "density_excess"  # rank galaxies for unique-sprite selection
MIN_COVERAGE = 0.02        # skip near-empty fitsmap stamps for unique cells
IMAGE_FORMAT = "png"       # "png" or "webp" (via --webp)

MAGIC = b"CWF1"

# ---------------------------------------------------------------------------
# TSV parsing
# ---------------------------------------------------------------------------


def load_catalog(db_path: Path):
    """Parse the tab-delimited catalog; return a dict of numpy arrays + sprites."""
    with open(db_path, "r", encoding="ascii", errors="replace") as fh:
        header = fh.readline().rstrip("\n").split("\t")
        idx = {name: i for i, name in enumerate(header)}
        required = ["x", "y", "z", "r", "g", "b", "opacity", "density_excess"]
        for col in required:
            if col not in idx:
                raise SystemExit(f"Catalog missing required column '{col}'")
        sprite_col = idx.get("sprite_fitsmap", idx.get("sprite"))
        cov_col = idx.get("mask_coverage_fitsmap", idx.get("coverage_fraction"))

        xs, ys, zs = [], [], []
        rs, gs, bs, ops, des = [], [], [], [], []
        sprites, covs = [], []
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < len(header):
                continue
            xs.append(float(parts[idx["x"]]))
            ys.append(float(parts[idx["y"]]))
            zs.append(float(parts[idx["z"]]))
            rs.append(float(parts[idx["r"]]))
            gs.append(float(parts[idx["g"]]))
            bs.append(float(parts[idx["b"]]))
            ops.append(float(parts[idx["opacity"]]))
            des.append(float(parts[idx["density_excess"]]))
            sprites.append(parts[sprite_col] if sprite_col is not None else "")
            covs.append(float(parts[cov_col]) if cov_col is not None
                        and parts[cov_col] not in ("", "nan") else 0.0)

    return {
        "x": np.asarray(xs, dtype=np.float64),
        "y": np.asarray(ys, dtype=np.float64),
        "z": np.asarray(zs, dtype=np.float64),
        "r": np.asarray(rs, dtype=np.float64),
        "g": np.asarray(gs, dtype=np.float64),
        "b": np.asarray(bs, dtype=np.float64),
        "opacity": np.asarray(ops, dtype=np.float64),
        "density_excess": np.asarray(des, dtype=np.float64),
        "coverage": np.asarray(covs, dtype=np.float64),
        "sprite": sprites,
        "sort": np.asarray([float(v) for v in
                            (des if SORT_KEY == "density_excess"
                             else ops if SORT_KEY == "opacity" else des)],
                           dtype=np.float64),
    }


# ---------------------------------------------------------------------------
# Geometry: x,y,z (equatorial-no-ecliptic ly) -> RA/Dec/D
# ---------------------------------------------------------------------------


def xyz_to_radec_d(x, y, z):
    """Return (raDeg [0,360), decDeg [-90,90], D ly). Matches the catalog's own
    X = D·cosDec·cosRA, Y = D·cosDec·sinRA, Z = D·sinDec, so atan2/asin invert it.
    """
    d = np.sqrt(x * x + y * y + z * z)
    safe = np.where(d > 0, d, 1.0)
    ra = np.degrees(np.arctan2(y, x))
    ra = np.mod(ra, 360.0)
    dec = np.degrees(np.arcsin(np.clip(z / safe, -1.0, 1.0)))
    return ra, dec, d


# ---------------------------------------------------------------------------
# Atlas building
# ---------------------------------------------------------------------------


def make_generic_blob(cell_px: int) -> Image.Image:
    """Soft white radial gradient (core -> transparent), tinted later per-point."""
    n = cell_px
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    c = (n - 1) / 2.0
    rr = np.sqrt((xx - c) ** 2 + (yy - c) ** 2) / (c if c > 0 else 1.0)
    # smoothstep(1 -> 0): bright soft core, faint halo, hard zero at the edge.
    a = np.clip(1.0 - rr, 0.0, 1.0)
    a = a * a * (3.0 - 2.0 * a)            # smoothstep
    alpha = (a * 255.0).astype(np.uint8)
    rgb = np.full((n, n, 3), 255, dtype=np.uint8)
    out = np.dstack([rgb, alpha])
    return Image.fromarray(out, mode="RGBA")


def fit_stamp(path: Path, cell_px: int) -> Image.Image:
    """Open a stamp, center-fit (aspect-preserving) into a cell_px RGBA cell.

    Black-background stamps get a luminance-derived alpha so they composite
    without a black box; stamps that already carry alpha keep it.
    """
    im = Image.open(path).convert("RGBA")
    rgba = np.asarray(im).astype(np.float64)
    has_alpha = rgba[..., 3].min() < 250
    if not has_alpha:
        # Derive alpha from luminance so the black background fades out.
        lum = (0.299 * rgba[..., 0] + 0.587 * rgba[..., 1]
               + 0.114 * rgba[..., 2])
        rgba[..., 3] = np.clip(lum * 1.6, 0, 255)
    src = Image.fromarray(rgba.astype(np.uint8), mode="RGBA")

    w, h = src.size
    scale = cell_px / float(max(w, h))
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    src = src.resize((nw, nh), Image.LANCZOS)

    cell = Image.new("RGBA", (cell_px, cell_px), (0, 0, 0, 0))
    cell.paste(src, ((cell_px - nw) // 2, (cell_px - nh) // 2))
    return cell


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=SRC_DB)
    ap.add_argument("--stamp-root", type=Path, default=None)
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    ap.add_argument("--max", type=int, default=MAX_GALAXIES)
    ap.add_argument("--unique", type=int, default=UNIQUE_SPRITES)
    ap.add_argument("--cell", type=int, default=CELL_PX)
    ap.add_argument("--atlas-max", type=int, default=ATLAS_MAX_PX)
    ap.add_argument("--min-coverage", type=float, default=MIN_COVERAGE)
    ap.add_argument("--webp", action="store_true", help="emit atlas.webp instead of png")
    args = ap.parse_args()

    src = args.src
    stamp_root = args.stamp_root or src.parent
    out_dir = args.out
    cell_px = args.cell
    fmt = "webp" if args.webp else "png"

    if not src.exists():
        raise SystemExit(f"Source catalog not found: {src}")
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Reading catalog {src} ...")
    cat = load_catalog(src)
    n_total = len(cat["x"])
    print(f"  {n_total} galaxies")

    n = min(args.max, n_total)
    ra, dec, d = xyz_to_radec_d(cat["x"], cat["y"], cat["z"])

    # --- choose unique-sprite galaxies: top-N by sort key with a usable stamp ---
    order = np.argsort(-cat["sort"])           # descending
    atlas_cols = min(args.atlas_max // cell_px,
                     max(1, int(math.ceil(math.sqrt(args.unique)))))
    max_cells = atlas_cols * atlas_cols
    unique_budget = min(args.unique, max_cells - 1)  # cell 0 reserved for blob

    sprite_index = np.zeros(n, dtype=np.uint16)  # default cell 0 (generic blob)
    chosen = []                                   # (cell_idx, row_idx, path)
    cell = 1
    for row in order:
        if cell > unique_budget:
            break
        if row >= n:
            continue
        rel = cat["sprite"][row]
        if not rel or cat["coverage"][row] < args.min_coverage:
            continue
        p = (stamp_root / rel) if not Path(rel).is_absolute() else Path(rel)
        if not p.exists():
            continue
        sprite_index[row] = cell
        chosen.append((cell, row, p))
        cell += 1

    sprite_count = cell  # includes cell 0
    rows_needed = int(math.ceil(sprite_count / atlas_cols))
    atlas_px_w = atlas_cols * cell_px
    atlas_px_h = rows_needed * cell_px
    print(f"  unique sprites: {len(chosen)} (atlas {atlas_cols} cols, "
          f"{atlas_px_w}x{atlas_px_h}px, cell {cell_px})")

    # --- build atlas image ---
    atlas = Image.new("RGBA", (atlas_px_w, atlas_px_h), (0, 0, 0, 0))
    atlas.paste(make_generic_blob(cell_px), (0, 0))  # cell 0
    fails = 0
    for ci, _row, p in chosen:
        col = ci % atlas_cols
        rowc = ci // atlas_cols
        try:
            atlas.paste(fit_stamp(p, cell_px), (col * cell_px, rowc * cell_px))
        except Exception as e:   # noqa: BLE001 - keep going past a bad PNG
            fails += 1
            if fails <= 5:
                print(f"  warn: stamp failed {p.name}: {e}")
    if fails:
        print(f"  {fails} stamps failed to load (fell back to generic blob)")

    atlas_name = f"atlas.{fmt}"
    atlas_path = out_dir / atlas_name
    if fmt == "webp":
        atlas.save(atlas_path, "WEBP", lossless=True, method=6)
    else:
        atlas.save(atlas_path, "PNG", optimize=True)

    # --- write field.bin ---
    bin_path = out_dir / "field.bin"
    rcols = np.clip(np.rint(cat["r"][:n] * 255), 0, 255).astype(np.uint8)
    gcols = np.clip(np.rint(cat["g"][:n] * 255), 0, 255).astype(np.uint8)
    bcols = np.clip(np.rint(cat["b"][:n] * 255), 0, 255).astype(np.uint8)
    acols = np.clip(np.rint(cat["opacity"][:n] * 255), 13, 255).astype(np.uint8)
    with open(bin_path, "wb") as fh:
        fh.write(MAGIC)
        fh.write(struct.pack("<I", n))
        fh.write(struct.pack("<HHHH", cell_px, atlas_cols, sprite_count, 0))
        rec = struct.Struct("<fffBBBBHH")
        for i in range(n):
            fh.write(rec.pack(
                float(ra[i]), float(dec[i]), float(d[i]),
                int(rcols[i]), int(gcols[i]), int(bcols[i]), int(acols[i]),
                int(sprite_index[i]), 0,
            ))

    # --- write atlas.json ---
    meta = {
        "magic": "CWF1",
        "cellPx": cell_px,
        "atlasCols": atlas_cols,
        "atlasPxW": atlas_px_w,
        "atlasPxH": atlas_px_h,
        "spriteCount": sprite_count,
        "format": fmt,
        "generic": 0,
        "note": ("UV for cell i: col=i%atlasCols, row=floor(i/atlasCols); "
                 "u0=col*cellPx/atlasPxW, v0=row*cellPx/atlasPxH, "
                 "du=cellPx/atlasPxW, dv=cellPx/atlasPxH"),
        "source": src.name,
        "sortKey": SORT_KEY,
        "galaxies": n,
    }
    json_path = out_dir / "atlas.json"
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)

    # --- report ---
    def mb(p: Path) -> str:
        return f"{p.stat().st_size / 1_048_576:.2f} MB"

    print("Done. Wrote:")
    print(f"  {bin_path.name:12s} {mb(bin_path)}  ({n} records x 20 B)")
    print(f"  {atlas_path.name:12s} {mb(atlas_path)}  ({atlas_px_w}x{atlas_px_h})")
    print(f"  {json_path.name:12s} {mb(json_path)}")
    total = (bin_path.stat().st_size + atlas_path.stat().st_size
             + json_path.stat().st_size) / 1_048_576
    print(f"  TOTAL        {total:.2f} MB")


if __name__ == "__main__":
    main()
