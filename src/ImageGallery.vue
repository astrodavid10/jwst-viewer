<template>
  <div class="jwst-gallery" :class="{ collapsed: !expanded, kiosk }">
    <button
      type="button"
      class="gallery-header"
      :aria-expanded="expanded"
      aria-controls="jwst-gallery-body"
      @click="expanded = !expanded"
    >
      <span class="gallery-title">
        <font-awesome-icon icon="globe" />
        Images
        <span class="gallery-count">{{ visibleItems.length }}</span>
      </span>
      <font-awesome-icon
        class="gallery-chevron"
        :icon="expanded ? 'chevron-up' : 'chevron-down'"
      />
    </button>

    <transition-expand>
      <div v-show="expanded" id="jwst-gallery-body" class="gallery-body">
        <!-- Search box: case-insensitive substring match on place name,
             composed (AND) with the type-chip filter below via visiblePlaces.
             Hidden entirely in kiosk mode (museum guests browse the strip).
             On mobile it collapses to a magnifier icon that expands into the
             input (B6) — the toggle button is display:none at desktop widths.
             P3.4 (prev/next arrow-key stepping): arrow-key handling while
             this input is focused is now suppressed in jwst-viewer.vue's
             onGlobalKeydown (it bails whenever document.activeElement is an
             <input>/<textarea>/<select> or isContentEditable), so typing here
             never also steps the gallery selection. -->
        <div v-if="!kiosk" class="gallery-search" :class="{ open: searchOpen }">
          <button
            type="button"
            class="gallery-search-toggle"
            :aria-expanded="searchOpen"
            aria-label="Search images"
            @click="toggleSearch"
          >
            <font-awesome-icon icon="magnifying-glass" />
          </button>
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="text"
            class="gallery-search-input"
            placeholder="Search images…"
            aria-label="Search images"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="gallery-search-clear"
            aria-label="Clear search"
            @click="clearSearch"
          >
            <font-awesome-icon icon="times" />
          </button>
        </div>

        <!-- Object-type filter chips (also the color/icon legend). Click to
             isolate one or more types; active chips highlight, none active =
             show all. (No "All" chip — saves a row of mobile real estate.) -->
        <div class="gallery-filter" role="group" aria-label="Filter by object type">
          <button
            v-for="g in groupChips"
            :key="g.key"
            type="button"
            class="filter-chip"
            :class="{ active: isGroupActive(g.key) }"
            :style="{ '--chip-color': g.color }"
            :aria-pressed="isGroupActive(g.key)"
            :aria-label="`${g.label}, ${g.count} image${g.count === 1 ? '' : 's'}`"
            v-tip="g.label + ' — ' + g.count + ' image' + (g.count === 1 ? '' : 's')"
            @click="toggleGroup(g.key)"
          >
            <font-awesome-icon :icon="g.icon" />
            <span class="chip-count" aria-hidden="true">{{ g.count }}</span>
          </button>
        </div>

        <!-- Announces the filtered count to screen readers (audit J4). -->
        <p class="visually-hidden" aria-live="polite">{{ filterSummary }}</p>

        <div class="gallery-scroll" @wheel="onGalleryWheel">
          <div
            v-for="item in visibleItems"
            :key="item.key"
            :class="['gallery-item', { selected: selectedKey === item.key }]"
            role="button"
            :aria-label="item.badge ? `${item.name} (${item.badge.label})` : item.name"
            :aria-current="selectedKey === item.key ? 'true' : undefined"
            @click="$emit('select', item.place)"
            @keydown.enter.prevent="$emit('select', item.place)"
            @keydown.space.prevent="$emit('select', item.place)"
            @mouseenter="showTip($event, item.name)"
            @mouseleave="hideTip"
            @focus="showTip($event, item.name)"
            @blur="hideTip"
            tabindex="0"
          >
            <!-- crossorigin lets thumb-crop.ts reuse this exact response for its
                 canvas scan instead of downloading the tile a second time (J6). -->
            <img
              class="gallery-thumb no-select"
              :src="item.thumb"
              alt=""
              crossorigin="anonymous"
              loading="lazy"
              @load="onThumbLoad($event)"
              @error="onThumbError(item.place, $event)"
            />
            <span
              v-if="item.badge"
              class="type-badge"
              :style="{ color: item.badge.color, borderColor: item.badge.color }"
              aria-hidden="true"
            >
              <font-awesome-icon :icon="item.badge.icon" />
            </span>
            <span class="gallery-item-name no-select" aria-hidden="true">{{ item.name }}</span>
          </div>

          <div v-if="visibleItems.length === 0" class="gallery-empty">No matches</div>
        </div>
      </div>
    </transition-expand>

    <!-- Themed hover label (teleported so the gallery's overflow clipping
         doesn't cut it off). -->
    <teleport to="body">
      <div
        v-if="tip.show"
        class="jwst-thumb-tip"
        :style="{ left: tip.x + 'px', top: tip.y + 'px' }"
      >{{ tip.name }}</div>
    </teleport>
  </div>
</template>

<script lang="ts">
import { defineComponent, markRaw, PropType } from "vue";
import { Place } from "@wwtelescope/engine";
import {
  TYPE_META,
  GROUP_META,
  GROUP_ORDER,
  typeForName,
  groupForName,
  JwstGroup,
  JwstTypeMeta,
} from "./jwstTypes";

// Everything a gallery row needs, computed once per catalog load rather than
// on every render (audit J18).
interface GalleryItem {
  place: Place;
  key: string;
  name: string;
  nameLower: string;
  badge: JwstTypeMeta | null;
  group: JwstGroup | null;
  thumb: string;
}

// Prefer the imageset's level-0 base tile (a sharp ~256px full-frame image)
// over its ThumbnailUrl (a blurry 96×45). The tile URL is the imageset URL
// template with level/x/y all 0; fall back to the thumbnail if it has no tile
// template (onThumbError covers tiles that fail to load). The Place's own
// Thumbnail is a generic JWST logo, so prefer the imageset's.
function thumbUrlFor(place: Place): string {
  const iset = place.get_studyImageset() ?? place.get_backgroundImageset();
  const tpl = iset?.get_url() ?? "";
  if (tpl.includes("{1}")) {
    return tpl.replace(/\{1\}/g, "0").replace(/\{2\}/g, "0").replace(/\{3\}/g, "0");
  }
  return iset?.get_thumbnailUrl() || place.get_thumbnailUrl() || "";
}

// Content-cropping of letterboxed base tiles lives in thumb-crop.ts (shared
// with the 3D description-panel thumb); results are cached per tile URL there.
import { croppedTileUrl } from "./thumb-crop";
// Unique per-place identity (Name collides across 11 duplicate-Name crops).
import { placeKey } from "./placeKey";
// Shared guard: suppress hover tips on touch devices / kiosk mode.
import { suppressHoverTips } from "./tooltip";

export default defineComponent({
  name: "ImageGallery",

  props: {
    places: {
      type: Array as PropType<Place[]>,
      default: () => [] as Place[],
    },
    selectedKey: {
      type: String,
      default: "",
    },
    startOpen: {
      type: Boolean,
      default: true,
    },
    // Kiosk mode: the gallery renders as a full-width, horizontally scrolling
    // strip (positioned along the top by the parent) and the search box is
    // removed. Selection behavior is unchanged.
    kiosk: {
      type: Boolean,
      default: false,
    },
  },

  // "visible-change" (P3.4): emits the current visiblePlaces array (chip filter
  // AND search applied, in display order) so the parent can step prev/next
  // through exactly what the guest sees. See the watch block below.
  emits: ["select", "visible-change"],

  data() {
    return {
      expanded: this.startOpen,
      tip: { show: false, name: "", x: 0, y: 0 },
      // Active filter groups. Empty == no filter (show everything).
      selectedGroups: [] as JwstGroup[],
      // Free-text search box (P3.2). Composed with selectedGroups via AND.
      searchQuery: "",
      // Mobile-only (B6): whether the collapsed magnifier has been expanded
      // into the input. Ignored at desktop widths (CSS always shows the input).
      searchOpen: false,
    };
  },

  computed: {
    // True when a type filter is in effect.
    filtered(): boolean {
      return this.selectedGroups.length > 0;
    },

    // One precomputed row per place (markRaw: plain data, no proxies needed).
    items(): GalleryItem[] {
      return markRaw(this.places.map((place) => {
        const name = place.get_name();
        const t = typeForName(name);
        return {
          place,
          key: placeKey(place),
          name,
          nameLower: name.toLowerCase(),
          badge: t ? TYPE_META[t] : null,
          group: groupForName(name),
          thumb: thumbUrlFor(place),
        };
      }));
    },

    // Items passing the active chip filter AND the search box (both are
    // ANDed: an active chip filter narrows by type, the search box narrows
    // by a case-insensitive substring match on the place name).
    // Unknown-type images are hidden while a chip filter is active.
    visibleItems(): GalleryItem[] {
      let list = this.items;
      if (this.filtered) {
        const active = new Set(this.selectedGroups);
        list = list.filter((it) => it.group !== null && active.has(it.group));
      }
      const q = this.searchQuery.trim().toLowerCase();
      if (q) {
        list = list.filter((it) => it.nameLower.includes(q));
      }
      return list;
    },

    visiblePlaces(): Place[] {
      return this.visibleItems.map((it) => it.place);
    },

    filterSummary(): string {
      if (!this.filtered && !this.searchQuery.trim()) { return ""; }
      return `Showing ${this.visibleItems.length} of ${this.items.length} images`;
    },

    // One chip per group that actually has images, in display order, with a
    // count of how many images fall in it.
    groupChips(): { key: JwstGroup; label: string; color: string; icon: string; count: number }[] {
      const counts = {} as Record<JwstGroup, number>;
      this.items.forEach((it) => {
        if (it.group) { counts[it.group] = (counts[it.group] ?? 0) + 1; }
      });
      return GROUP_ORDER
        .filter((key) => (counts[key] ?? 0) > 0)
        .map((key) => ({
          key,
          label: GROUP_META[key].label,
          color: GROUP_META[key].color,
          icon: GROUP_META[key].icon,
          count: counts[key],
        }));
    },
  },

  watch: {
    // P3.4: keep the parent's step order in sync with what's actually on
    // screen. Fires immediately (initial list) and on every filter/search/
    // catalog change. Applies to the kiosk strip too — same computed.
    visiblePlaces: {
      immediate: true,
      handler(list: Place[]): void {
        this.$emit("visible-change", list);
      },
    },
  },

  methods: {
    isGroupActive(key: JwstGroup): boolean {
      return this.selectedGroups.includes(key);
    },

    // Toggle a group in/out of the active filter set.
    toggleGroup(key: JwstGroup): void {
      const i = this.selectedGroups.indexOf(key);
      if (i >= 0) { this.selectedGroups.splice(i, 1); }
      else { this.selectedGroups.push(key); }
    },

    clearSearch(): void {
      this.searchQuery = "";
    },

    // Mobile-only (B6): expand the magnifier icon into the search input (and
    // focus it); collapsing clears the query so a hidden filter can't silently
    // pin the gallery to a stale subset.
    toggleSearch(): void {
      this.searchOpen = !this.searchOpen;
      if (this.searchOpen) {
        this.$nextTick(() => (this.$refs.searchInput as HTMLInputElement | undefined)?.focus());
      } else {
        this.searchQuery = "";
      }
    },

    // Kiosk strip: translate vertical wheel motion into horizontal scrolling
    // so a mouse can drive the strip too (touch drag already works natively).
    onGalleryWheel(ev: WheelEvent): void {
      if (!this.kiosk) { return; }
      if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) { return; }
      (ev.currentTarget as HTMLElement).scrollLeft += ev.deltaY;
      ev.preventDefault();
    },

    // If the base tile fails (e.g. an imageset with no level-0 tile, or a host
    // without CORS headers), drop back to the WWT thumbnail once, loaded
    // without CORS so a header-less host still works.
    onThumbError(place: Place, ev: Event): void {
      const img = ev.target as HTMLImageElement;
      if (img.dataset.fallback) { return; }
      img.dataset.fallback = "1";
      img.removeAttribute("crossorigin");
      const iset = place.get_studyImageset() ?? place.get_backgroundImageset();
      img.src = iset?.get_thumbnailUrl() || place.get_thumbnailUrl() || "";
    },

    // Once a thumbnail's base tile has loaded, swap in a content-cropped version
    // so letterboxed images fill their square. Lazy (per visible thumb) and
    // cached in thumb-crop.ts, so each distinct tile is processed at most once.
    onThumbLoad(ev: Event): void {
      const img = ev.target as HTMLImageElement;
      // Skip the blob-URL reload our own crop triggers, and the WWT-thumb fallback.
      if (img.dataset.cropped || img.dataset.fallback) { return; }
      croppedTileUrl(img.src).then((dataUrl) => {
        if (img.dataset.fallback) { return; }
        img.dataset.cropped = "1";
        if (dataUrl) { img.src = dataUrl; }
      });
    },

    showTip(ev: Event, name: string): void {
      if (suppressHoverTips()) { return; }
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      // Anchor to the left of the item (the gallery hugs the right edge); the
      // tip's own transform pulls it fully left of and centered on the item.
      this.tip = { show: true, name, x: rect.left - 10, y: rect.top + rect.height / 2 };
    },
    hideTip(): void {
      this.tip.show = false;
    },
  },
});
</script>

<style scoped lang="less">
.jwst-gallery {
  pointer-events: auto;
  width: 12.5rem;
  max-width: 42vw;
  background-color: rgba(4, 6, 24, 0.82);
  backdrop-filter: blur(6px);
  border: 1px solid var(--accent-color);
  border-radius: 10px;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 2rem);
  max-height: calc(100dvh - 2rem);
}

.gallery-header {
  background: none;
  border: none;
  font: inherit;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  color: var(--accent-color);
  font-weight: bold;
  user-select: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.gallery-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.95rem;
}

.gallery-count {
  color: var(--accent-color2);
  background: rgba(153, 200, 255, 0.12);
  border-radius: 999px;
  padding: 0 0.45rem;
  font-size: 0.75rem;
  line-height: 1.4;
}

.gallery-chevron {
  color: var(--accent-color2);
}

/* Wrapper around the filter + scroll list (the transition-expand child).
   Must be a shrinkable flex column so the scroll area below keeps a bounded
   height and scrolls instead of being clipped by the gallery's overflow:hidden.
   (transition-expand sets inline height:auto after expanding, so we rely on
   flex-shrink + min-height:0 here, not an explicit height.) */
.gallery-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/* Search box (P3.2). Sits at the top of the expanded body, above the type
   chips; matches the dark/blurred header aesthetic with a gold focus ring. */
.gallery-search {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0.4rem 0.4rem 0.1rem;
}

/* Mobile-only (B6) magnifier toggle; display:flex is switched on in the
   max-width media block below. */
.gallery-search-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 1.7rem;
  height: 1.7rem;
  padding: 0;
  margin-right: 0.3rem;
  font-size: 0.72rem;
  color: var(--accent-color);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 50%;
  cursor: pointer;

  &:hover {
    color: var(--accent-color2);
    border-color: var(--accent-color2);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-color2);
    outline-offset: 1px;
  }
}

.gallery-search-input {
  width: 100%;
  box-sizing: border-box;
  /* The app disables text selection globally (kiosk/guest UX); typing and
     selecting inside the search field must keep working. */
  user-select: text;
  -webkit-user-select: text;
  padding: 0.28rem 1.6rem 0.28rem 0.5rem;
  font: inherit;
  font-size: 0.75rem;
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  outline: none;

  &::placeholder {
    color: rgba(255, 255, 255, 0.7);
  }

  &:hover {
    border-color: var(--accent-color2);
  }

  &:focus-visible {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px rgba(240, 171, 82, 0.35);
  }
}

.gallery-search-clear {
  position: absolute;
  right: 0.65rem;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  padding: 0;
  color: #cdd3e0;
  background: none;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 0.65rem;

  &:hover {
    color: #fff;
  }

  &:focus-visible {
    outline: 2px solid var(--accent-color2);
    outline-offset: 1px;
  }
}

/* Zero-result state for the search box (and/or chip filter combo). */
.gallery-empty {
  padding: 0.6rem 0.3rem;
  text-align: center;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.75);
}

.gallery-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.gallery-scroll::-webkit-scrollbar {
  width: 6px;
}
.gallery-scroll::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.25);
  border-radius: 3px;
}

.gallery-item {
  position: relative;
  flex: 0 0 auto;
  /* Cheap off-screen skipping for the long list (audit J18). */
  content-visibility: auto;
  contain-intrinsic-size: auto 10rem;
  border: 2px solid rgba(133, 133, 134, 0.45);
  border-radius: 6px;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 150ms ease, transform 120ms ease;

  &:hover {
    border-color: var(--accent-color2);
    transform: translateY(-1px);
  }

  &:focus {
    outline: none;
  }

  &:focus-visible {
    outline: 2px solid var(--accent-color2);
    outline-offset: 2px;
  }

  &.selected {
    border-color: var(--accent-color);
    box-shadow: 0 0 8px var(--accent-color);
  }
}

.gallery-thumb {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 4 / 3;
  object-fit: cover;
}

.gallery-item-name {
  display: block;
  padding: 0.25rem 0.4rem;
  font-size: 0.72rem;
  line-height: 1.15;
  color: #fff;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: rgba(0, 0, 0, 0.4);
}

/* Object-type filter chips (top of the gallery). Also serve as the legend:
   each chip's icon + color matches the per-thumbnail badge of that group. */
.gallery-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  padding: 0.4rem 0.4rem 0.1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.filter-chip {
  --chip-color: var(--accent-color2);
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.18rem 0.42rem;
  font-size: 0.7rem;
  line-height: 1;
  color: #cdd3e0;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease,
    background-color 120ms ease, opacity 120ms ease;

  &:hover {
    color: #fff;
    border-color: var(--chip-color);
  }

  /* Active = this group's filter is on. Strong highlight (fill + glow) so the
     state reads without the old "All" chip / dimming as a reference. */
  &.active {
    color: var(--chip-color);
    border-color: var(--chip-color);
    background: rgba(255, 255, 255, 0.12);
    box-shadow: 0 0 6px var(--chip-color);
  }
}

.chip-count {
  font-variant-numeric: tabular-nums;
}

/* Colored corner badge marking each image's object type. Sits inside the
   clipped item; inline style supplies the type color (text + border). */
.type-badge {
  position: absolute;
  top: 0.28rem;
  left: 0.28rem;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.2rem;
  height: 1.2rem;
  font-size: 0.62rem;
  border: 1px solid currentColor;
  border-radius: 50%;
  background: rgba(4, 6, 24, 0.85);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

.no-select {
  user-select: none;
  -webkit-user-select: none;
}

/* ── Kiosk mode: full-width horizontal thumbnail strip along the top ─────────
   The parent (.gallery-wrap in jwst-viewer.vue) stretches edge-to-edge; the
   scroll list flips to a row with touch/wheel horizontal scrolling. Item
   markup, selection, and filtering are identical to the vertical gallery. */
.jwst-gallery.kiosk {
  width: 100%;
  max-width: none;
  max-height: none;
  border-top: none;
  border-left: none;
  border-right: none;
  border-radius: 0 0 12px 12px;

  .gallery-scroll {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch; /* momentum scrolling on the touchscreen */
  }

  .gallery-scroll::-webkit-scrollbar {
    width: auto;
    height: 6px;
  }

  .gallery-item {
    flex: 0 0 7.5rem;
  }
}

/* Narrow gallery (phones, landscape phones): drop the header icon so the image
   count fits, and keep the filter chips on one scrollable row so the
   thumbnails get the height. */
.narrow-gallery() {
  .gallery-header {
    padding: 0.45rem 0.5rem;
  }
  .gallery-title {
    gap: 0.3rem;
    font-size: 0.9rem;
    > svg:first-child {
      display: none;
    }
  }
  .jwst-gallery:not(.kiosk) .gallery-filter {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    padding-bottom: 0.3rem;
  }
  .jwst-gallery:not(.kiosk) .filter-chip {
    flex: 0 0 auto;
  }
}

@media (max-width: 600px) {
  /* Smaller tiles and a height cap so the gallery occupies only the top of the
     screen, leaving the bottom clear for the description panel + slider (which
     stay below it at their normal z-index). */
  .jwst-gallery {
    width: 8rem;
    max-height: 42vh;
    max-height: 42dvh;
  }
  .narrow-gallery();
  .gallery-item-name {
    font-size: 0.75rem;
  }
  .gallery-search-input {
    font-size: 0.68rem;
    padding: 0.22rem 1.4rem 0.22rem 0.42rem;
  }
  /* B6: below 600px the search row collapses to just the magnifier icon;
     tapping it (searchOpen → .open) reveals the input + clear button. */
  .gallery-search-toggle {
    display: flex;
  }
  .gallery-search:not(.open) {
    .gallery-search-input,
    .gallery-search-clear {
      display: none;
    }
  }
  .filter-chip {
    padding: 0.16rem 0.34rem;
    font-size: 0.75rem;
  }
  .type-badge {
    width: 1.1rem;
    height: 1.1rem;
    font-size: 0.65rem;
  }
}

/* Landscape phones / short screens (audit J7): wider than the 600px breakpoint
   but only ~375px tall. A narrow rail that runs the full (dynamic) height. */
@media (max-height: 500px) and (orientation: landscape) {
  .narrow-gallery();
  .jwst-gallery {
    width: 8.5rem;
    max-height: calc(100dvh - 1rem);
  }
  .gallery-item-name {
    font-size: 0.75rem;
  }
}
</style>

<!-- Not scoped: the hover tip is teleported to <body>, outside this component's
     DOM, so a scoped style wouldn't reach it. Colors are hard-coded to the gold
     theme since the --accent-color vars live on #app, which the tip is outside of. -->
<style lang="less">
.jwst-thumb-tip {
  position: fixed;
  transform: translate(-100%, -50%);
  max-width: 16rem;
  z-index: 9999;
  pointer-events: none;
  padding: 0.32rem 0.55rem;
  background: rgba(4, 6, 24, 0.95);
  backdrop-filter: blur(6px);
  border: 1px solid #f0ab52;
  border-radius: 6px;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.8rem;
  line-height: 1.25;
}
</style>
