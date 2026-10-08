// ── thumb-crop ───────────────────────────────────────────────────────────────
// Content-crop helper for WWT level-0 base tiles. The tile is square but
// letterboxes non-square images with uniform (black/transparent) padding baked
// into the pixels, so CSS object-fit:cover can't remove it. We load the tile
// through a CORS-enabled image (data1.wwtassets.org sends
// Access-Control-Allow-Origin: *; the cache-bust query forces a fresh CORS
// fetch so a prior non-CORS cache entry can't taint the canvas), find the
// non-padding bounding box, and crop to it.
//
// Shared by the gallery thumbnails (ImageGallery.vue) and the 3D
// description-panel thumb (jwst-viewer.vue). Results — including the "" that
// means "keep the original" (no content, already full-frame, tainted canvas,
// or load error) — are cached per tile URL, and concurrent callers share one
// in-flight load.

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

// A pixel counts as image content only if it is opaque enough AND bright
// enough; anything below this is treated as WWT's letterbox padding.
const PAD_THRESHOLD = 8;

/**
 * Resolve to a content-cropped JPEG data URL for the tile, or "" meaning
 * "keep the original". Never rejects.
 */
export function croppedTileUrl(baseUrl: string): Promise<string> {
  const cached = cache.get(baseUrl);
  if (cached !== undefined) { return Promise.resolve(cached); }
  const pending = inflight.get(baseUrl);
  if (pending) { return pending; }

  const p = new Promise<string>((resolve) => {
    const finish = (result: string) => {
      cache.set(baseUrl, result);
      inflight.delete(baseUrl);
      resolve(result);
    };
    const loader = new Image();
    loader.crossOrigin = "anonymous";
    loader.onload = () => {
      try {
        const w = loader.naturalWidth;
        const h = loader.naturalHeight;
        if (!w || !h) { throw new Error("no dimensions"); }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { throw new Error("no 2d context"); }
        ctx.drawImage(loader, 0, 0);
        const data = ctx.getImageData(0, 0, w, h).data; // throws if tainted

        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const lum = Math.max(data[i], data[i + 1], data[i + 2]);
            if (data[i + 3] >= PAD_THRESHOLD && lum >= PAD_THRESHOLD) {
              if (x < minX) { minX = x; }
              if (x > maxX) { maxX = x; }
              if (y < minY) { minY = y; }
              if (y > maxY) { maxY = y; }
            }
          }
        }
        const cw = maxX - minX + 1;
        const ch = maxY - minY + 1;
        // No content, degenerate, or already (near-)full frame: keep original.
        if (maxX < 0 || cw < 8 || ch < 8 || (cw >= w * 0.98 && ch >= h * 0.98)) {
          finish("");
          return;
        }
        const out = document.createElement("canvas");
        out.width = cw;
        out.height = ch;
        out.getContext("2d")?.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
        finish(out.toDataURL("image/jpeg", 0.9));
      } catch {
        // Tainted canvas or any other failure: keep the uncropped tile.
        finish("");
      }
    };
    loader.onerror = () => { finish(""); };
    loader.src = baseUrl + (baseUrl.includes("?") ? "&" : "?") + "cors=1";
  });
  inflight.set(baseUrl, p);
  return p;
}
