<template>
  <v-app id="app" :style="cssVars">
    <div
      id="main-content"
      :class="{ kiosk: kioskMode }"
      @pointerdown="onViewerPointerDown"
      @pointermove="onViewerPointerMove"
      @pointerup="onViewerPointerUp"
      @pointerleave="clearHover3D"
    >
      <WorldWideTelescope :wwt-namespace="wwtNamespace"></WorldWideTelescope>

      <!-- Loading modal; becomes the error card if startup fails (audit E3). -->
      <transition name="fade">
        <div class="modal" id="modal-loading" v-show="isLoading || bootError">
          <div class="container" v-if="!bootError" role="status">
            <div class="spinner"></div>
            <p>{{ loadingStatus }}</p>
          </div>
          <div class="boot-error" v-else role="alert">
            <h2 class="boot-error-title">The images couldn't be loaded</h2>
            <p>{{ bootError }}</p>
            <button v-if="bootRetryable" type="button" class="boot-retry" @click="retryBoot">Try again</button>
            <p v-if="bootRetryInS" class="boot-auto">Trying again automatically in {{ bootRetryInS }} seconds.</p>
          </div>
        </div>
      </transition>

      <!-- Screen-reader-only page heading (the intro's h1 goes away with it)
           and polite announcements (audit J14). -->
      <h1 v-if="!showIntro" class="visually-hidden">{{ introTitle }}</h1>
      <div class="visually-hidden" aria-live="polite" aria-atomic="true">{{ liveMessage }}</div>

      <!-- Top-left controls: menu + fullscreen -->
      <div class="top-left-controls">
        <button
          ref="menuToggleBtn"
          class="control-btn"
          @click="toggleMenu"
          v-tip="'Menu'"
          aria-label="Menu"
          aria-haspopup="true"
          :aria-expanded="isMenuOpen"
          aria-controls="hamb-menu-list"
        >
          <font-awesome-icon icon="sliders-h" />
        </button>
        <button
          v-if="fullscreenAvailable && !kioskMode"
          class="control-btn"
          @click="toggleFullscreen"
          v-tip="fullscreenModeActive ? 'Exit fullscreen' : 'Fullscreen'"
          :aria-label="fullscreenModeActive ? 'Exit fullscreen' : 'Fullscreen'"
        >
          <font-awesome-icon :icon="fullscreenModeActive ? 'compress' : 'expand'" />
        </button>
        <div
          class="mode-seg"
          role="group"
          aria-label="View"
          @pointerenter="warm3D()"
          @focusin="warm3D()"
        >
          <button
            type="button"
            class="mode-seg-btn"
            :class="{ active: !mode3D }"
            :aria-pressed="!mode3D"
            v-tip="'Sky view: images on the sky'"
            @click="mode3D && toggle3D()"
          >2D</button>
          <button
            type="button"
            class="mode-seg-btn"
            :class="{ active: mode3D }"
            :aria-pressed="mode3D"
            v-tip="'3D view: where each image is in space'"
            @click="!mode3D && toggle3D()"
          >3D</button>
        </div>

        <ul id="hamb-menu-list" class="hamb-menu" :class="{ show: isMenuOpen }">
          <li><button type="button" class="hamb-menu-item" @click="openIntro">
            <font-awesome-icon icon="info-circle" /> Overview
          </button></li>
          <li v-if="tourPlaces.length"><button type="button" class="hamb-menu-item" @click="startTour">
            <font-awesome-icon icon="route" /> Guided tour
          </button></li>
          <li v-if="!mode3D"><button
            type="button"
            class="hamb-menu-item"
            aria-controls="survey-menu-list"
            :aria-expanded="showSurveyMenu"
            @click="toggleSurveyMenu"
          >
            <font-awesome-icon icon="panorama" /> Choose sky survey
          </button></li>
          <li><button type="button" class="hamb-menu-item" :aria-pressed="showCrossfade" @click="toggleCrossfade">
            <font-awesome-icon icon="adjust" /> <span class="hamb-menu-label">Opacity slider</span>
            <font-awesome-icon icon="check" class="menu-check" :class="{ on: showCrossfade }" />
          </button></li>
          <li><button type="button" class="hamb-menu-item" :aria-pressed="showConstellations" @click="toggleConstellations">
            <font-awesome-icon icon="star" /> <span class="hamb-menu-label">Constellation lines</span>
            <font-awesome-icon icon="check" class="menu-check" :class="{ on: showConstellations }" />
          </button></li>
          <li><button type="button" class="hamb-menu-item" :aria-pressed="showFootprints" @click="toggleFootprints">
            <font-awesome-icon icon="vector-square" /> <span class="hamb-menu-label">Image outlines</span>
            <font-awesome-icon icon="check" class="menu-check" :class="{ on: showFootprints }" />
          </button></li>
          <!-- COSMOS-Web galaxy field disabled for now (module + assets remain; re-add to re-enable):
          <li><button type="button" class="hamb-menu-item" @click="toggleCosmosWeb">
            <font-awesome-icon icon="circle-nodes" /> COSMOS-Web galaxies {{ showCosmosWeb ? '(on)' : '(off)' }}{{ cosmosWebLoading ? ' …' : '' }}
          </button></li>
          -->
          <li><button type="button" class="hamb-menu-item" @click="openLink('https://www.rocketcenter.com/INTUITIVEPlanetarium/InteractiveAstronomy', 'INTUITIVE Planetarium')">
            <font-awesome-icon icon="building-columns" /> <span class="hamb-menu-label"><em>INTUITIVE</em><sup>®</sup>&nbsp;Planetarium</span>
          </button></li>
          <li><button type="button" class="hamb-menu-item" @click="openLink('https://worldwidetelescope.org/home/', 'WorldWide Telescope')">
            <img alt="WWT" class="hamb-menu-logo" src="./assets/logo_wwt.png" width="16" height="16" />
            <span class="hamb-menu-label">WorldWide Telescope</span>
          </button></li>
          <li><button type="button" class="hamb-menu-item" @click="openLink('https://webbtelescope.org/', 'James Webb Space Telescope')">
            <font-awesome-icon icon="satellite" /> About JWST
          </button></li>
          <li v-if="kioskMode"><button type="button" class="hamb-menu-item" @click="showHomeQR">
            <font-awesome-icon icon="globe" /> Get this on your phone
          </button></li>
        </ul>
      </div>

      <!-- Image gallery (top-right; in kiosk mode a full-width horizontal
           strip along the top — see .kiosk .gallery-wrap + ImageGallery's
           kiosk prop). -->
      <div class="gallery-wrap">
        <image-gallery
          :places="galleryPlaces"
          :selected-key="selectedKey"
          :kiosk="kioskMode"
          @select="onGallerySelect"
          @visible-change="visibleOrder = $event"
        ></image-gallery>
      </div>

      <!-- Intro modal -->
      <transition name="intro-fade">
        <div class="intro-backdrop" v-if="showIntro" @click.self="closeIntro" @keydown.esc="closeIntro">
          <div
            class="intro-modal"
            ref="introModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="intro-title"
            tabindex="-1"
            @keydown.tab="onIntroTabKey"
          >
            <button ref="introCloseBtn" class="intro-modal-close" @click="closeIntro" aria-label="Close">
              <font-awesome-icon icon="times" />
            </button>

            <div class="intro-modal-logos">
              <a href="https://www.rocketcenter.com/INTUITIVEPlanetarium" target="_blank" rel="noopener noreferrer">
                <img alt="INTUITIVE Planetarium at the U.S. Space &amp; Rocket Center" src="./assets/ip-ussrc.png" class="intro-logo-ip" />
              </a>
              <div class="intro-logo-row">
                <a href="https://www.cosmicds.cfa.harvard.edu/" target="_blank" rel="noopener noreferrer" class="intro-logo-attr">
                  <img alt="CosmicDS" src="./assets/logo_cosmicds.png" class="intro-logo-cds" />
                  <span>Interactive developed using the CosmicDS toolkit</span>
                </a>
              </div>
              <div class="intro-logo-row">
                <a href="https://worldwidetelescope.org/home/" target="_blank" rel="noopener noreferrer" class="intro-logo-attr">
                  <img alt="WorldWide Telescope" src="./assets/logo_wwt.png" class="intro-logo-wwt" />
                  <span>Powered by WorldWide Telescope</span>
                </a>
              </div>
            </div>

            <h1 id="intro-title" class="intro-title">{{ introTitle }}</h1>

            <div class="intro-body">
              <p>
                Explore {{ places.length }} of the latest images from the
                <a href="https://webbtelescope.org/" target="_blank" rel="noopener noreferrer" class="links">James Webb Space Telescope</a>,
                placed in their true location on the sky and powered by
                <a href="https://worldwidetelescope.org/home/" target="_blank" rel="noopener noreferrer" class="links">WorldWide Telescope</a>.
              </p>

              <h2 class="intro-section-title">How to Use</h2>
              <ul class="intro-instructions">
                <li><span class="intro-icon"><font-awesome-icon icon="globe" /></span>
                  <span><strong>Browse:</strong> Pick a thumbnail from the <em>Images</em> gallery to fly to that target and see it in context on the sky.</span></li>
                <li><span class="intro-icon"><font-awesome-icon icon="arrows-alt" /></span>
                  <span><strong>Navigate:</strong> Click &amp; drag (or touch drag) to pan; scroll or pinch to zoom.</span></li>
                <li><span class="intro-icon"><font-awesome-icon icon="adjust" /></span>
                  <span><strong>Crossfade:</strong> Use the opacity slider to fade the JWST image against the background sky survey.</span></li>
                <li><span class="intro-icon"><font-awesome-icon icon="star" /></span>
                  <span><strong>Sky surveys:</strong> Switch the background survey to compare the same patch of sky across wavelengths.</span></li>
                <li><span class="intro-icon"><font-awesome-icon icon="book-open" /></span>
                  <span><strong>Learn more:</strong> Each image shows its description and credits — follow the link to the source.</span></li>
              </ul>
            </div>

            <div class="intro-actions">
              <button type="button" class="intro-action primary" @click="closeIntro">Start exploring</button>
              <button v-if="tourPlaces.length" type="button" class="intro-action" @click="startTour">
                <font-awesome-icon icon="route" /> Take the guided tour
              </button>
            </div>

            <div class="intro-credits">
              Interactive by
              <a href="https://twitter.com/ADavidWeigel" target="_blank" rel="noopener noreferrer" class="links">A. David Weigel</a>,
              <a href="https://www.cosmicds.cfa.harvard.edu/" target="_blank" rel="noopener noreferrer" class="links">CosmicDS</a> &amp;
              the <a href="https://worldwidetelescope.org/home/" target="_blank" rel="noopener noreferrer" class="links">WorldWide Telescope</a> team.
            </div>
          </div>
        </div>
      </transition>

      <!-- Bottom dock: the survey menu or the description panel, then the
           opacity or compare bar, stacked in one flex column so they can't
           overlap each other. layoutDock() sizes it against the gallery so it
           can't run under the thumbnails either. -->
      <div ref="bottomDock" class="bottom-dock">
        <!-- Sky survey selector -->
        <transition name="fade">
          <div class="survey-menu" v-if="showSurveyMenu" @keydown.esc="showSurveyMenu = false">
            <div class="survey-head">
              <span class="survey-label"><font-awesome-icon icon="star" /> Sky survey</span>
              <button class="survey-close" @click="showSurveyMenu = false" aria-label="Close"><font-awesome-icon icon="times" /></button>
            </div>
            <ul id="survey-menu-list" class="survey-list">
              <li v-for="bg in backgroundImagesets" :key="bg.imagesetName">
                <button
                  type="button"
                  :class="['survey-option', { active: curBackgroundImagesetName === bg.imagesetName }]"
                  @click="selectSurvey(bg.imagesetName)"
                >
                  <font-awesome-icon icon="check" class="survey-check" />
                  <span>{{ bg.displayName }}</span>
                </button>
              </li>
            </ul>
          </div>
        </transition>

        <!-- Description / credits panel -->
        <transition name="fade">
          <div class="description-panel" v-if="selectedPlace && showDescription" aria-labelledby="desc-title">
            <button class="desc-close" @click="showDescription = false" aria-label="Close"><font-awesome-icon icon="times" /></button>
            <!-- Guided tour (audit J8): caption + Back/Next/Exit above the
                 regular description. -->
            <div v-if="tourActive" class="tour-strip">
              <div class="tour-head">
                <span class="tour-label"><font-awesome-icon icon="route" /> Guided tour · {{ tourIdx + 1 }} of {{ tourPlaces.length }}</span>
                <button type="button" class="tour-exit" @click="stopTour">Exit tour</button>
              </div>
              <p class="tour-caption">{{ tourCaption }}</p>
              <div class="tour-nav">
                <button type="button" class="tour-btn" :disabled="tourIdx === 0" @click="tourStep(-1)">
                  <font-awesome-icon icon="chevron-left" /> Back
                </button>
                <button type="button" class="tour-btn primary" @click="tourStep(1)">
                  {{ tourIdx === tourPlaces.length - 1 ? 'Finish' : 'Next' }} <font-awesome-icon icon="chevron-right" />
                </button>
              </div>
            </div>
            <div class="desc-head">
              <!-- P3.4: step to the previous image in the gallery's current
                   visible list (wraparound). Also bound to ArrowLeft. -->
              <button
                v-if="!tourActive"
                class="desc-step desc-step-prev"
                aria-label="Previous image"
                v-tip="'Previous image'"
                @click="stepImage(-1)"
              >
                <font-awesome-icon icon="chevron-left" />
              </button>
              <button
                v-if="mode3D && selectedPlace"
                type="button"
                class="desc-thumb-btn"
                aria-label="View this image on the sky"
                v-tip="'View in 2D'"
                @click="viewIn2D"
              >
                <img
                  class="desc-thumb no-select"
                  :src="markerThumb(selectedPlace)"
                  alt=""
                  crossorigin="anonymous"
                  @load="onDescThumbLoad"
                />
              </button>
              <h2 id="desc-title" class="desc-title">{{ selectedName }}</h2>
              <!-- P3.4: step to the next image (wraparound). Also bound to
                   ArrowRight. margin pushes it clear of the absolute .desc-close X. -->
              <button
                v-if="!tourActive"
                class="desc-step desc-step-next"
                aria-label="Next image"
                v-tip="'Next image'"
                @click="stepImage(1)"
              >
                <font-awesome-icon icon="chevron-right" />
              </button>
            </div>
            <div ref="descBody" class="desc-body">
            <p class="desc-distance" v-if="distanceLabel">{{ distanceLabel }}</p>
            <p class="desc-text">{{ currentMeta.description || 'No description available for this image.' }}</p>
            <p class="desc-credits" v-if="currentMeta.credits || safeCreditsUrl">
              <em>Credits: {{ currentMeta.credits }}</em>
              <a
                v-if="safeCreditsUrl"
                :href="safeCreditsUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="links desc-learn"
              ><font-awesome-icon icon="arrow-up-right-from-square" /> Learn more</a>
            </p>
            </div>
            <div class="desc-actions">
              <!-- In kiosk mode "View in 2D" lives in the top-center bar instead
                   (easier to discover on the exhibit screen). -->
              <button v-if="mode3D && !kioskMode" type="button" class="desc-view2d" @click="viewIn2D">
                <font-awesome-icon icon="image" /> View in 2D
              </button>
              <button
                v-if="!mode3D && !compareActive && compareCandidates.length"
                type="button"
                class="desc-view2d"
                v-tip="'Blend with another image of the same target'"
                @click="startCompare()"
              >
                <font-awesome-icon icon="table-columns" /> Compare ({{ compareCandidates.length }})
              </button>
              <button v-if="!kioskMode" type="button" class="desc-view2d" @click="shareView">
                <font-awesome-icon icon="share-nodes" /> {{ shareStatus || 'Share' }}
              </button>
            </div>
          </div>
        </transition>

        <!-- Crossfade opacity slider -->
        <transition name="fade">
          <div class="crossfade-bar" v-if="showCrossfade && !mode3D && !compareActive">
            <span class="crossfade-text">JWST opacity</span>
            <input
              class="opacity-range"
              type="range"
              min="0"
              max="100"
              v-model.number="foregroundOpacity"
              aria-label="JWST image opacity"
            />
          </div>
        </transition>

        <!-- Compare bar (audit J9): blend the current image (left end of the
             slider) with another image of the same target (right end). -->
        <transition name="fade">
          <div class="compare-bar" v-if="compareActive && !mode3D">
            <span class="compare-name" :title="selectedName">{{ selectedName }}</span>
            <input
              class="opacity-range"
              type="range"
              min="0"
              max="100"
              v-model.number="compareOpacity"
              aria-label="Blend between the two images"
            />
            <select
              class="compare-select"
              :value="compareKey"
              aria-label="Image to compare with"
              @change="onCompareSelect"
            >
              <option v-for="p in compareCandidates" :key="placeKey(p)" :value="placeKey(p)">{{ p.get_name() }}</option>
            </select>
            <button type="button" class="compare-icon-btn" aria-label="Make the compared image the main one" v-tip="'Swap'" @click="swapCompare">
              <font-awesome-icon icon="right-left" />
            </button>
            <button type="button" class="compare-icon-btn" aria-label="Exit compare" v-tip="'Exit compare'" @click="exitCompare">
              <font-awesome-icon icon="times" />
            </button>
          </div>
        </transition>
      </div>

      <!-- 3D marker hover label (thumbnail + name, anchored at the dot) -->
      <div
        v-if="hover3D.show"
        class="marker-tip"
        :style="{ left: hover3D.x + 'px', top: hover3D.y + 'px' }"
      >
        <img v-if="hover3D.thumb" class="marker-tip-thumb" :src="hover3D.thumb" alt="" />
        <span class="marker-tip-name">{{ hover3D.name }}<span v-if="hover3D.hint" class="marker-tip-hint">{{ hover3D.hint }}</span></span>
      </div>

      <!-- Kiosk-only top-center bar, fixed just below the thumbnail strip:
           the "take it home" QR pill (a QR of the public URL so a guest can
           keep exploring on their phone) and, while in 3D, the "View in 2D"
           control (moved here from under the description panel). -->
      <div v-if="kioskMode" class="kiosk-top-bar">
        <button class="kiosk-home-btn" @click="showHomeQR">
          <font-awesome-icon icon="globe" /> Take it with you
        </button>
        <button
          v-if="mode3D"
          class="desc-view2d kiosk-view2d"
          @click="viewIn2D"
        >
          <font-awesome-icon icon="image" /> View in 2D
        </button>
      </div>

      <!-- Bottom-left credits/logos (left side stays clear of the right-hand
           gallery, which can run down the screen and overlap a bottom-right logo). -->
      <div class="bottom-logos">
        <a href="https://www.cosmicds.cfa.harvard.edu/" target="_blank" rel="noopener noreferrer">
          <img alt="CosmicDS" src="./assets/logo_cosmicds.png" />
        </a>
        <a href="https://worldwidetelescope.org/home/" target="_blank" rel="noopener noreferrer">
          <img alt="WWT" src="./assets/logo_wwt.png" />
        </a>
      </div>

      <!-- Staff-visible warning when the take-home QR would point somewhere a
           visitor's phone can't reach (audit J2). Set VUE_APP_PUBLIC_URL. -->
      <div v-if="kioskHomeUrlProblem" class="kiosk-staff-warning" role="status">
        <font-awesome-icon icon="triangle-exclamation" /> {{ kioskHomeUrlProblem }}
      </div>

      <!-- Attract-loop hint: pulsing "touch to explore" while auto-cycling. -->
      <div class="kiosk-hint" v-if="attractMode" aria-hidden="true">Touch to explore</div>

      <!-- Attract-loop 3D interlude caption ("that image lives here" / overview / next stop). -->
      <div class="kiosk-3d-caption" v-if="attractMode && attractCaption" aria-hidden="true">{{ attractCaption }}</div>

      <!-- Kiosk QR modal: shown instead of navigating away on any external
           link, and for the take-home QR. Nested here (not teleported) so the
           --accent-color CSS var resolves. -->
      <kiosk-qr-modal v-if="showQrModal" :url="qrUrl" :title="qrTitle" :type-url="qrTypeUrl" @close="closeQR" />
    </div>
  </v-app>
</template>

<script lang="ts">
import { defineComponent, markRaw } from "vue";
import {
  Folder, Place, ImageSetLayer,
  Constellations, Coordinates, Grids, LayerManager, Texture, Vector3d, WWTControl,
} from "@wwtelescope/engine";
import { applyImageSetLayerSetting } from "@wwtelescope/engine-helpers";
import { MiniDSBase, BackgroundImageset } from "@cosmicds/vue-toolkit";
// Phase 2 (3D) — porting the exo-sonification WWT hacks. Importing wwt-hacks
// also applies side-effect patches (TILE_QUALITY_SCALE sharper tiles, the
// constellation-figure fade shims) on load. See HANDOFF.md §9.
import {
  drawSkyOverlays, initializeConstellationNames,
  drawGalaxyImage, layerManagerDraw, prebuildFigures3D, zoom,
  notifyConstellationModeChange, gotoTargetFullHacked, setConstellationFiguresTarget,
  prefetchCosmos,
} from "./wwt-hacks";
import { prewarmGalaxySprites } from "./galaxy-sprites";
import { croppedTileUrl } from "./thumb-crop";
import { installMarkerCloud, setMarkerCloudOpacity, setMarkerHighlight, MarkerRow } from "./marker-renderer";
import { installFootprints, setFootprintsVisible, FootprintVertex } from "./footprints";
import { loadCosmosWebField, setCosmosWebFieldVisible } from "./cosmosweb-field";
import { distanceLyForName, distanceForName, normalizeName } from "./jwstDistances";
import { typeMetaForName } from "./jwstTypes";
import { placeKey } from "./placeKey";
import KioskQrModal from "./KioskQrModal.vue";
import {
  installKioskGuards, scheduleDailyReload, createIdleWatcher, IdleWatcher, isHttpUrl,
  KIOSK_RELOAD_HOUR, KIOSK_IDLE_MS, KIOSK_ATTRACT_DWELL_MS, KIOSK_ATTRACT_FALLBACK_STEP_MS,
  KIOSK_ATTRACT_3D_EVERY, KIOSK_ATTRACT_3D_HOLD_MS, KIOSK_ATTRACT_3D_FLYOUT_S,
  KIOSK_ATTRACT_3D_OVERVIEW_DWELL_MS, KIOSK_ATTRACT_3D_NEXT_HOLD_MS,
} from "./kiosk";
import { urlWithoutParams, numberParam, stringParam } from "./urlParams";
import { statsInit, statsSessionStart, statsSessionEnd, statsTrack } from "./kioskStats";
import {
  withTimeout, fetchText, hasWebGL, describeBootError, scheduleKioskRetry, markBootSucceeded,
} from "./boot";
import { DEBUG } from "./debug";
import { GALAXY_LITE, GALAXY_TIER, gaiaMilkyWayUrl } from "./quality";

interface ImageMeta {
  description: string;
  credits: string;
  creditsUrl: string;
}

// Trimmed text of a direct child element by tag name (case-sensitive, XML), or
// "" if absent. Used instead of querySelector so a Place's <Description> isn't
// confused with one nested deeper, and a Place's <Credits> doesn't shadow the
// ImageSet's.
function directChildText(el: Element, tag: string): string {
  for (const child of Array.from(el.children)) {
    if (child.tagName === tag) { return child.textContent?.trim() ?? ""; }
  }
  return "";
}

// Parse descriptions/credits from the catalog WTML text (the engine drops
// ImageSet/Description). In the current catalog, <Description> is a child of
// <Place> while Credits/CreditsUrl live on the nested <ImageSet>; the older
// catalog carried Description on the ImageSet instead, so fall back to that.
// Keyed like placeKey.ts (`${name}::${url}`) because the catalog has duplicate
// Place Names (same object, two crops); falls back to the bare name only when
// a Place has no ImageSet Url.
function parseWtmlMetadata(text: string): Record<string, ImageMeta> {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Image catalog is not valid XML");
  }
  const map: Record<string, ImageMeta> = {};
  doc.querySelectorAll("Place").forEach((placeEl) => {
    const name = placeEl.getAttribute("Name");
    if (!name) { return; }
    const imgEl = placeEl.querySelector("ImageSet");
    const isetUrl = imgEl?.getAttribute("Url") ?? "";
    const key = isetUrl ? `${name}::${isetUrl}` : name;
    const description = directChildText(placeEl, "Description")
      || (imgEl ? directChildText(imgEl, "Description") : "");
    map[key] = {
      description,
      credits: imgEl ? directChildText(imgEl, "Credits") : "",
      creditsUrl: imgEl ? directChildText(imgEl, "CreditsUrl") : "",
    };
  });
  return map;
}

// One JWST image's 3D marker: its place + precomputed world-space (AU) position
// for screen-projection hit-testing in solar-system mode.
interface MarkerPoint {
  place: Place;
  name: string;
  raDeg: number;
  decDeg: number;
  ly: number;
  xR: number;
  yR: number;
  zR: number;
}

const D2R = Math.PI / 180;

// Fisher–Yates shuffle (returns a new array). Used to randomize the kiosk
// attract-loop order so the auto-tour doesn't repeat the same sequence.
function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One decimal place, trimming a trailing ".0" (used by formatLy below).
function round1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// Human-scale distance string for the attract-loop 3D interlude caption
// ("… it lives here, {formatLy(ly)} from Earth").
function formatLy(ly: number): string {
  if (ly >= 1e9) { return `${round1(ly / 1e9)} billion light-years`; }
  if (ly >= 1e6) { return `${round1(ly / 1e6)} million light-years`; }
  if (ly >= 1e4) { return `${Math.round(ly / 1000)},000 light-years`; }
  return `${Math.round(ly)} light-years`;
}

// Gallery display order: these names are floated to the TOP of the thumbnail
// selector, in this exact order, ahead of the rest (which keep their catalog
// order). It's how we surface the newest additions — WWT appends new Places to
// the tail of the WTML, so without this they'd sort to the bottom.
// When a future catalog update lands (see CATALOG_UPDATE.md), prepend that
// batch's new names here (newest first). Matched via normalizeName, so exact
// punctuation/casing isn't required.
const FEATURED_ORDER: string[] = [
  // October 2026 batch (esawebb.org releases weic2616–weic2620, potm2607–potm2609).
  "Star-forming region IC 348 (NIRCam image)",
  "NGC 7129 (NIRCam image)",
  "IC 348 Crop: Central star cluster",
  "IC 348 Crop: Star embedded in a nebula",
  "IC 348 Crop: Stars and faint outflows",
  "IC 348 Crop: Spiral galaxies",
  "IC 348 Crop: Gravitational lensing",
  "IRS 3 Field (NIRCam and MIRI image)",
  "IRS 3 Field (NIRCam image)",
  "IRS 3 Field (MIRI image)",
  "Lion Nebula (NIRCam + MIRI image)",
  "Lion Nebula (MIRI image)",
  "Galaxies in a cosmic house of mirrors",
  "Striking star clusters and irregular clumps",
  "Starstruck image of Arp 263",
  "Arp 263 (crop)",
  "Webb opens a Treasure Chest filled with stars",
  // July 2026 batch (Centaurus A wide-field leads, per request).
  "Centaurus A (MIRI + NIRCam image wide-field view)",
  "Centaurus A (MIRI + NIRCam image)",
  "Centaurus A (NIRCam image)",
  "Centaurus A (MIRI image)",
  "M82 (Webb NIRCam image)",
  "The Cigar Galaxy: M82 (Webb NIRCam image)",
  "The Cigar Galaxy: M82 (Webb and Hubble image)",
  "Bulge fossil fragment Terzan 5 (Webb and Hubble image)",
  "FS Tau (Webb NIRCam image)",
  "Webb unveils young stars across every stage of formation",
  "Abell S1063 galaxy cluster",
  "A cosmic construction project",
];
// Guided tour (audit J8 / backlog P3.7a): the approved 16-stop list, in order,
// each with a short caption. Names are matched through normalizeName, so curly
// vs straight quotes don't matter; a stop whose name isn't in the catalog is
// skipped rather than breaking the tour.
const TOUR_STOPS: { name: string; caption: string }[] = [
  { name: "NIRCam Image of the “Cosmic Cliffs” in Carina",
    caption: "The edge of a giant gas cavity in the Carina Nebula, where hot young stars are carving out the clouds that gave birth to them." },
  { name: "Webb Takes a Stunning, Star-Filled Portrait of the Pillars of Creation",
    caption: "The famous Pillars of Creation in the Eagle Nebula. Webb's infrared view sees through the dust to newly forming stars." },
  { name: "Rho Ophiuchi cloud complex",
    caption: "The closest star-forming region to Earth, about 390 light-years away. About 50 young Sun-like stars light up the clouds." },
  { name: "Protostar L1527",
    caption: "An hourglass of gas lit by a star still forming at its waist, less than 100,000 years old." },
  { name: "Webb inspects dusty debris disc around Fomalhaut",
    caption: "Rings of dust around the nearby star Fomalhaut: the leftover building material of a planetary system." },
  { name: "Exoplanet Epsilon Indi Ab (MIRI image)",
    caption: "A cold giant planet imaged directly, orbiting a star just 12 light-years away." },
  { name: "Southern Ring Nebula (NIRCam Image)",
    caption: "The glowing shells of gas cast off by a dying star, about 2,500 light-years away." },
  { name: "Crab Nebula (MIRI and NIRCam image)",
    caption: "The expanding wreck of a star that exploded in 1054, seen and recorded by astronomers on Earth at the time." },
  { name: "Sagittarius C (NIRCam Image)",
    caption: "A crowded star-forming region near the black hole at the centre of our Milky Way." },
  { name: "Tarantula Nebula (NIRCam Image)",
    caption: "The largest stellar nursery in our galactic neighbourhood, in the Large Magellanic Cloud." },
  { name: "Webb Inspects the Heart of the Phantom Galaxy",
    caption: "M74, a near-perfect spiral galaxy. Webb's infrared view traces the gas and dust in its arms." },
  { name: "Stephan’s Quintet (NIRCam + MIRI Imaging)",
    caption: "Five galaxies in a close group, four of them interacting and tearing at each other's gas and stars." },
  { name: "Cartwheel Galaxy (JWST NIRCam and MIRI Composite Image)",
    caption: "A galaxy reshaped into a ring after a smaller galaxy plunged straight through it." },
  { name: "Webb Uncovers New Details in Pandora’s Cluster",
    caption: "Abell 2744, a pile-up of galaxy clusters whose gravity magnifies even more distant galaxies behind it." },
  { name: "Webb’s First Deep Field (NIRCam Image)",
    caption: "Thousands of galaxies in a patch of sky the size of a grain of sand held at arm's length." },
  { name: "Webb finds most distant known galaxy (JADES-GS-z14-0 environment NIRCam image)",
    caption: "Light from one of these galaxies left it about 290 million years after the Big Bang." },
];

// name → rank (lower = earlier). Featured names get 0..n-1; everything else
// gets a large rank so it stays after, preserving catalog order via a stable sort.
const FEATURED_RANK: Map<string, number> = new Map(
  FEATURED_ORDER.map((n, i) => [normalizeName(n), i]),
);

// Each selected image becomes its own ImageSetLayer (rather than THE single
// foreground imageset). That lets the previously shown image stay on screen
// while the next one loads, so there's never a blank "pop" — we just crossfade.
// WWT won't request tiles for a layer drawn at 0 opacity, so we hold the
// incoming layer at a hair above zero (this floor, 0..1) while it streams in,
// then ramp it to full once the slew arrives.
const FADE_FLOOR = 0.02;

// Floor on the slew duration (ms). When the target is at/near the current
// camera position timeToRADecZoom ≈ 0, so without this the slew and crossfade
// would be near-instant; we stretch both the camera move and the fade to at
// least this long so a same-spot reselect still reads as a deliberate transition.
const MIN_SLEW_MS = 2500;
// Ceiling on image-to-image slews (audit J17). The engine's predicted time for
// a cross-sky hop can run 15–20 s, which is long for a gallery click and longer
// for a museum visitor; `duration` compresses the camera move to fit.
const MAX_SLEW_MS = 6000;
// "Gentle" 3D→2D arrival (desc-thumbnail click): jump instantly to the target's
// RA/Dec at GENTLE_ZOOM_BACKOFF × its zoom, then ease the remaining zoom-in
// over GENTLE_SLEW_MS while the image fades in — no cross-sky slew.
const GENTLE_SLEW_MS = 2800;
const GENTLE_ZOOM_BACKOFF = 2.5;
// prefers-reduced-motion: skip the cross-sky slew (instant goto) and use a
// short fade instead of the slew-timed crossfade.
const REDUCED_MOTION_FADE_MS = 400;

// ── Phase 2 (3D) constants ────────────────────────────────────────────────
const R2D = 180 / Math.PI;
// The engine's light-year → AU factor (index.js AltUnits.lightYears path). Used
// to precompute each marker's world position so our hit-test matches where WWT
// actually draws the dot.
const LY_TO_AU = 63239.6717;
// Mean obliquity of the ecliptic (J2000). The engine tilts spherical Sky-frame
// world coords by this, so we apply the same rotateX when projecting markers.
const ECLIPTIC_RAD = 23.4392911 * (Math.PI / 180);
// Solar-system zoom range; the modify_index.py build hook strips the engine's
// hard zoom clamp so the far end is reachable. Exo's range (3e4 – 2.23e10) was
// sized for exoplanets a few hundred ly away; JWST's deep fields/quasars sit at
// ~13 Gly (≈8.3e14 AU), whose fly-to needs zoom ≈ (9/4)·0.25·8.3e14 ≈ 4.7e14,
// so the far end must be ~1e16 to both reach AND let you pull back past them.
// The near end is dropped so you can dive right up to the closest debris discs.
const MIN_ZOOM_3D = 1000;
const MAX_ZOOM_3D = 1e16;
// Opening 3D view: looking toward the galactic-center region, zoomed way out.
const POSITION_3D = { raRad: 280 * (Math.PI / 180), decRad: -50 * (Math.PI / 180), zoomDeg: 289555092.0 * 6 };
// viewCamera equivalent of POSITION_3D (lat/lng/zoom, not raRad/decRad/zoomDeg),
// measured empirically in the console: `window.jwstApp.set3DMode()` then read
// `WWTControl.singleton.renderContext.viewCamera` after it settles. Used by
// flyToOverview3D (the attract-loop 3D interlude's pull-back phase) since
// gotoTargetFullHacked takes viewCamera-shaped params, not gotoRADecZoom's.
const OVERVIEW_CAM = { lat: -50, lng: -280, zoom: 1737330552 };
// Cap on the fly-in camera-to-object distance (AU). The Milky Way backdrop fade
// is tied to zoom (= 9/4·camDist), so capping camDist keeps the backdrop from
// rendering displaced when we fly out to a far object — by the time we arrive it
// has faded. Tunable via window.__flyCamDist.
const FLY_CAM_DIST_CAP_AU = 5e7;
// JWST gold for the 3D markers (the fallback / uniform-look color).
const MARKER_COLOR_HEX = "#F0AB52";
// When true, each marker takes its object-type color (TYPE_META, matching the
// gallery badges); when false, every marker is the uniform JWST gold above.
// Flip this one line to swap back to the all-gold look.
const MARKER_COLOR_BY_TYPE = true;

// Image-compare (audit J9): another catalog image counts as "the same target"
// when its centre lies within this fraction of the current image's field.
const COMPARE_MATCH_FRACTION = 0.5;
const COMPARE_MAX_CANDIDATES = 8;

// Coarse pointers (touch) get a larger marker hit radius and tap-to-preview
// (audit J16).
const IS_COARSE_POINTER = window.matchMedia("(pointer: coarse)").matches;

// Angular separation in degrees between two RA/Dec positions given in radians.
function separationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const c = Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, c))) * R2D;
}

// Project a solar-system world point (AU, the frame WWT draws in) to canvas
// pixels. Calls the engine's pick-space transform directly: as of engine 7.40,
// getScreenPointForCoordinates swaps y/z in solar-system mode, so going through
// it would make the hit-test depend on the engine version.
function worldToScreen(x: number, y: number, z: number): { x: number; y: number } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctl = WWTControl.singleton as any;
  const rc = ctl?.renderContext;
  if (!rc) { return null; }
  return ctl.transformWorldPointToPickSpace(Vector3d.create(x, y, z), rc.width, rc.height);
}

// Background sky surveys, ordered high-energy → infrared. Display name → WWT imageset name.
// These resolve from BackgroundImagery_v2.wtml plus WWT built-ins.
const SKY_SURVEYS: [string, string][] = [
  ["Fermi (Gamma)", "Fermi LAT 8-year (gamma)"],
  ["ROSAT (X-ray)", "RASS: ROSAT All Sky Survey (X-ray)"],
  ["GALEX (Ultraviolet)", "GALEX (Ultraviolet)"],
  ["Digitized Sky Survey (Optical)", "Digitized Sky Survey"],
  ["NASA Deep Star Maps (Optical)", "Deep Star Maps 2020"],
  ["Gaia DR2 (Optical)", "Gaia DR2"],
  ["PanSTARRS1 3pi (Optical)", "PanSTARRS1 3pi"],
  ["unWISE (Infrared)", "unWISE color, from W2 and W1 bands"],
  ["WISE All Sky (Infrared)", "WISE All Sky (Infrared)"],
  ["2MASS (Infrared)", "2Mass: Imagery (Infrared)"],
  ["SFD Dust Map (Infrared)", "SFD Dust Map (Infrared)"],
];

export default defineComponent({
  extends: MiniDSBase,
  name: "JwstViewer",

  components: { "kiosk-qr-modal": KioskQrModal },

  props: {
    wwtNamespace: { type: String, required: true },
    wtml: { type: String, required: true },
    bgWtml: { type: String, required: true },
    bgName: { type: String, required: true },
    introTitle: { type: String, default: "Explore JWST Imagery" },
    // Image to open on. Set to a Place/image name from jwst.wtml (e.g.
    // "Cosmic Cliffs in the Carina Nebula"); blank = the first gallery image.
    startImage: { type: String, default: "" },
    // Field of view (deg) the launch view starts zoomed out to before flying
    // in to startImage — larger = more dramatic opening zoom.
    startZoomDeg: { type: Number, default: 60 },
    // Kiosk mode (museum touchscreen): external links open a QR modal instead
    // of navigating, intro is skipped, 90s idle → attract loop, local stats.
    // Turned on by ?kiosk=1 (see src/main.ts / src/urlParams.ts).
    kioskMode: { type: Boolean, default: false },
    // Canonical public URL for the take-home QR (set at deploy time; "" derives
    // it from the current URL minus kiosk params).
    kioskHomeUrl: { type: String, default: "" },
  },

  data() {
    return {
      imagesetFolder: null as Folder | null,
      places: [] as Place[],
      backgroundImagesets: [] as BackgroundImageset[],
      metaByName: {} as Record<string, ImageMeta>,

      selectedPlace: null as Place | null,
      layersLoaded: false,
      positionSet: false,
      metadataLoaded: false,
      bgSurveyLoaded: false,
      startLayerLoaded: false,
      hasFlownToStart: false,

      // The image-set layer currently in front, its live opacity (0..100, what
      // the crossfade slider drives), every layer we've added (so we can prune
      // stale ones), and a sequence guard so only the latest selection wins.
      currentLayer: null as ImageSetLayer | null,
      currentOpacity: 0,
      imageLayers: [] as ImageSetLayer[],
      selectSeq: 0,

      // P3.4: the gallery's current on-screen list (chip filter + search
      // applied, display order), mirrored up via ImageGallery's "visible-change"
      // event. Drives prev/next stepping (stepImage / arrow keys / chevrons).
      visibleOrder: [] as Place[],

      showIntro: true,
      // Kiosk QR modal (external links + take-home QR route here in kiosk mode).
      showQrModal: false,
      qrUrl: "",
      qrTitle: "",
      qrTypeUrl: "",
      // Teardown fns for kiosk guards/watchers, run in beforeUnmount.
      kioskCleanups: [] as Array<() => void>,
      // Attract loop (auto-cycles images after idle; guest touch stops it).
      attractMode: false,
      attractTimer: 0,
      attractOrder: [] as Place[],
      attractIdx: 0,
      // Duration of the last onSelectPlace slew, so the attract loop can pace
      // its next step to land after the current fly-in settles.
      lastSlewMs: 0,
      // Attract-loop 3D interlude ("cosmic zoom-out"): caption shown during the
      // detour, and the every-Nth-step cadence (0 disables; overridable via
      // ?kiosk3dEvery= for testing — see mounted()).
      attractCaption: "",
      attract3DEvery: KIOSK_ATTRACT_3D_EVERY,
      // The idle watcher (kept so stats can read its lastActivity timestamp).
      kioskIdleWatcher: null as IdleWatcher | null,
      // Element to return focus to when the intro closes, if it was opened
      // from the hamburger menu (rather than shown at mount).
      introTriggerEl: null as HTMLElement | null,
      isMenuOpen: false,
      showSurveyMenu: false,
      showCrossfade: true,
      showDescription: true,

      accentColor: "#F0AB52",
      accentColor2: "#99c8ff",

      fadeRaf: 0,
      // Timer/interval handles cleared in beforeUnmount (this app mounts once
      // today, but matters if this component is ever embedded/remounted).
      positionSetTimer: 0,
      figures3DPollTimer: 0,
      figures3DGiveUpTimer: 0,
      set2DModeTimer: 0,

      // ── Phase 2 (3D) state ────────────────────────────────────────────
      mode3D: false,
      markerPoints: [] as MarkerPoint[],
      // Optional COSMOS-Web galaxy field overlay (lazy-loaded on first toggle).
      showCosmosWeb: false,
      cosmosWebLoading: false,
      // Constellation figure lines (fade in/out; works in 2D and 3D).
      showConstellations: false,
      // 2D image-footprint outlines (2D-only; renderer self-gates in 3D).
      showFootprints: false,
      saved2DPosition: null as { raRad: number; decRad: number; zoomDeg: number } | null,
      // The sky-survey background we were on before entering 3D. Captured here
      // because once 3D sets the background to "Solar System", the live
      // curBackgroundImagesetName getter reports "Solar System" — so set2DMode
      // can't read the survey back from it.
      saved2DBackground: "" as string,
      // Hover tooltip over a 3D marker (thumbnail + name, near the cursor).
      hover3D: { show: false, name: "", thumb: "", hint: "", x: 0, y: 0 },
      hoverRaf: 0,
      pendingHoverEvent: null as PointerEvent | null,
      pointerDownAt: null as { x: number; y: number } | null,
      // Touch: the first tap on a 3D marker previews it, a second tap on the
      // same marker opens it (audit J16).
      pendingTapName: "",

      // Startup failure card (audit E3). bootRetryable is false only when the
      // browser can't do WebGL at all; bootRetryInS counts the kiosk auto-retry.
      bootError: "",
      bootRetryable: true,
      bootRetryInS: 0,

      // 3D downloads (Gaia Milky Way, SDSS cosmos, galaxy sprites, 3D figures)
      // start on the first sign of 3D intent rather than for every visitor
      // (audit J3). Timer handles are cleared in beforeUnmount.
      warmed3D: false,
      warm3DTimers: [] as number[],

      // Deep links (audit E11): ?image=<name> opens on that image and
      // ?mode=3d starts in the 3D view. The URL is kept in sync as the visitor
      // browses so the address bar and Share button always point here.
      deepLinkImage: stringParam("image") ?? "",
      initialMode3D: stringParam("mode") === "3d",
      shareStatus: "",

      // Guided tour (audit J8).
      tourActive: false,
      tourIdx: 0,

      // Compare mode (audit J9): a second image of the same target, layered
      // over the current one and blended with its own slider.
      compareActive: false,
      comparePlace: null as Place | null,
      compareLayer: null as ImageSetLayer | null,
      compareOpacity: 50,
      compareSeq: 0,

      // Polite screen-reader announcements (selection changes, tour steps).
      liveMessage: "",
      // Keeps the bottom dock clear of the gallery (layoutDock).
      dockObserver: null as ResizeObserver | null,
    };
  },

  mounted() {
    this.backgroundImagesets = SKY_SURVEYS.map(([display, name]) => new BackgroundImageset(display, name));

    // The intro shows from mount (showIntro starts true); focus its close
    // button so keyboard users land inside the dialog.
    this.focusIntroClose();
    window.addEventListener("keydown", this.onGlobalKeydown);
    window.addEventListener("pointerdown", this.onGlobalPointerdown);

    // Kiosk mode: lock the browser down and route external links to a QR modal.
    // Installed synchronously (before the async ready wait) so the exhibit is
    // guarded even while imagery is still loading.
    if (this.kioskMode) {
      // Skip the intro entirely — maybeFlyToStart (which gates on showIntro)
      // then fires the launch fly-in on its own once loading completes. The
      // "Overview" hamburger item still reopens the intro on demand.
      this.showIntro = false;

      // Anonymous, local-only usage stats (viewable via ?kioskStats=1).
      statsInit(this.kioskMode);

      this.kioskCleanups.push(installKioskGuards({
        onExternalLink: (url, title) => this.showQR(url, title),
      }));
      // Nightly maintenance reload only while attract is running (no guest sees it).
      this.kioskCleanups.push(scheduleDailyReload(KIOSK_RELOAD_HOUR, () => this.attractMode));

      // Attract-loop 3D interlude cadence. ?kiosk3dEvery=<n> overrides the
      // default for testing (0 = disabled; any non-negative int accepted).
      const attract3DEventOverride = numberParam("kiosk3dEvery");
      if (attract3DEventOverride !== null && attract3DEventOverride >= 0) {
        this.attract3DEvery = Math.floor(attract3DEventOverride);
      }

      // Idle → attract loop. ?kioskIdle=<seconds> overrides the default for testing.
      const idleOverrideS = numberParam("kioskIdle");
      const idleMs = (idleOverrideS !== null && idleOverrideS > 0) ? idleOverrideS * 1000 : KIOSK_IDLE_MS;
      const watcher = createIdleWatcher({
        idleMs,
        onIdle: () => this.enterAttract(),
        onActive: () => this.onKioskActivity(),
        onTap: () => statsTrack("tap"),
      });
      watcher.start();
      this.kioskIdleWatcher = watcher;
      this.kioskCleanups.push(() => watcher.stop());

      // Measure the top thumbnail strip rather than assuming its height (J7):
      // filter chips can wrap to a second row on a narrow exhibit screen.
      const root = this.$el as HTMLElement;
      const strip = root.querySelector(".gallery-wrap");
      const main = root.querySelector("#main-content") as HTMLElement | null;
      if (strip && main && "ResizeObserver" in window) {
        const ro = new ResizeObserver(() => {
          main.style.setProperty("--kiosk-strip-h", `${strip.getBoundingClientRect().height}px`);
        });
        ro.observe(strip);
        this.kioskCleanups.push(() => ro.disconnect());
      }
    }

    this.boot();

    // Re-fit the bottom dock whenever the gallery or the window changes size
    // (gallery expand/collapse, filtering, rotation, mobile address bar).
    const gallery = (this.$el as HTMLElement).querySelector(".gallery-wrap");
    if (gallery && "ResizeObserver" in window) {
      this.dockObserver = new ResizeObserver(() => this.layoutDock());
      this.dockObserver.observe(gallery);
    }
    window.addEventListener("resize", this.layoutDock);
    this.$nextTick(() => this.layoutDock());
  },

  beforeUnmount() {
    this.cancelFade();
    if (this.hoverRaf) { cancelAnimationFrame(this.hoverRaf); }
    // Undo kiosk guards/watchers (restores window.open, removes listeners, etc.).
    window.clearTimeout(this.attractTimer);
    for (const fn of this.kioskCleanups) { fn(); }
    this.kioskCleanups = [];
    window.removeEventListener("keydown", this.onGlobalKeydown);
    window.removeEventListener("pointerdown", this.onGlobalPointerdown);
    window.removeEventListener("resize", this.layoutDock);
    this.dockObserver?.disconnect();
    window.clearTimeout(this.positionSetTimer);
    window.clearInterval(this.figures3DPollTimer);
    window.clearTimeout(this.figures3DGiveUpTimer);
    window.clearTimeout(this.set2DModeTimer);
    for (const t of this.warm3DTimers) { window.clearTimeout(t); }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).jwstApp;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).WWTControl;
  },

  computed: {
    isLoading(): boolean {
      return !this.ready && !this.bootError;
    },
    ready(): boolean {
      return this.layersLoaded && this.positionSet && this.metadataLoaded
        && this.bgSurveyLoaded && this.startLayerLoaded;
    },
    // Drives the loading screen's progress line — whichever startup gate is
    // still pending. Order matches roughly how long each tends to take.
    loadingStatus(): string {
      if (!this.layersLoaded) { return "Loading imagery catalog…"; }
      if (!this.metadataLoaded) { return "Loading image details…"; }
      if (!this.bgSurveyLoaded) { return "Loading sky surveys…"; }
      if (!this.startLayerLoaded) { return "Loading starting image…"; }
      if (!this.positionSet) { return "Finishing up…"; }
      return "Loading…";
    },
    selectedName(): string {
      return this.selectedPlace ? this.selectedPlace.get_name() : "";
    },
    // Unique per-place identity (Name collides across the catalog's 11
    // duplicate-Name crops; see placeKey.ts). Used for map lookups and
    // gallery selection-highlight comparison — display still uses the Name.
    selectedKey(): string {
      return this.selectedPlace ? placeKey(this.selectedPlace) : "";
    },
    // Places in gallery-display order: FEATURED_ORDER names first, the rest in
    // catalog order. A stable sort by rank keeps non-featured images exactly as
    // the WTML lists them. This is display-only — `places` (which drives the
    // opening image, markers, and footprints) stays in catalog order.
    galleryPlaces(): Place[] {
      const rankOf = (p: Place): number =>
        FEATURED_RANK.get(normalizeName(p.get_name())) ?? Number.MAX_SAFE_INTEGER;
      // Decorate-sort-undecorate for a stable sort independent of Array.sort's
      // engine-specific stability guarantees.
      return this.places
        .map((place, i) => ({ place, i, rank: rankOf(place) }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i)
        .map((e) => e.place);
    },
    // The image we open on: startImage by name if it matches, else the first.
    // (Duplicate names resolve to whichever comes first in the catalog.)
    // A ?image= deep link wins over the configured startImage. Matched via
    // normalizeName, so quotes/case/punctuation in a shared link don't matter.
    startPlace(): Place | null {
      if (this.places.length === 0) { return null; }
      for (const wanted of [this.deepLinkImage, this.startImage]) {
        if (!wanted) { continue; }
        const match = this.placeByName(wanted);
        if (match) { return match; }
        console.warn(`Image "${wanted}" not found in collection.`);
      }
      return this.places[0];
    },
    // Tour stops resolved to catalog places (missing names are skipped).
    tourPlaces(): { place: Place; caption: string }[] {
      const out: { place: Place; caption: string }[] = [];
      for (const stop of TOUR_STOPS) {
        const place = this.placeByName(stop.name);
        if (place) { out.push({ place, caption: stop.caption }); }
      }
      return out;
    },
    tourCaption(): string {
      return this.tourActive ? (this.tourPlaces[this.tourIdx]?.caption ?? "") : "";
    },
    // Other catalog images of (roughly) the same patch of sky as the selected
    // one, nearest first: the candidates for compare mode.
    compareCandidates(): Place[] {
      const cur = this.selectedPlace;
      if (!cur || this.mode3D) { return []; }
      const iset = cur.get_studyImageset() ?? cur.get_backgroundImageset();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const field = (iset as any)?.get_baseTileDegrees?.() ?? 0;
      const limit = Math.max(0.02, field * COMPARE_MATCH_FRACTION);
      const c = this.placeCenter(cur);
      const key = placeKey(cur);
      return this.places
        .filter((p) => placeKey(p) !== key)
        .map((p) => {
          const pc = this.placeCenter(p);
          return { p, sep: separationDeg(c.raRad, c.decRad, pc.raRad, pc.decRad) };
        })
        .filter((x) => x.sep <= limit)
        .sort((a, b) => a.sep - b.sep)
        .slice(0, COMPARE_MAX_CANDIDATES)
        .map((x) => x.p);
    },
    compareName(): string {
      return this.comparePlace ? this.comparePlace.get_name() : "";
    },
    compareKey(): string {
      return this.comparePlace ? placeKey(this.comparePlace) : "";
    },
    // Only http(s) credit links are rendered (audit E6): the URL comes from the
    // WTML, and Vue doesn't block javascript: URLs in :href.
    safeCreditsUrl(): string {
      const u = this.currentMeta.creditsUrl;
      return u && isHttpUrl(u) ? u : "";
    },
    // Accessible name for the WWT canvas (audit J14).
    canvasLabel(): string {
      if (this.mode3D) {
        return "3D view of where each Webb image sits in space, with the Milky Way for scale";
      }
      return this.selectedName
        ? `Sky view showing the Webb image: ${this.selectedName}`
        : "Sky view";
    },
    // The take-home address as a visitor would type it: just the site, no
    // https://, no query string (the QR carries the image deep link).
    homeTypeUrl(): string {
      const base = this.kioskHomeUrl
        || urlWithoutParams("kiosk", "kioskIdle", "kioskStats", "kiosk3dEvery", "tileq", "image", "mode", "debug", "galaxy");
      try {
        const u = new URL(base);
        return (u.host + u.pathname).replace(/\/$/, "");
      } catch {
        return base;
      }
    },
    // In kiosk mode the take-home QR must point at a public https URL that
    // isn't this machine; otherwise staff see a warning badge (audit J2).
    kioskHomeUrlProblem(): string {
      if (!this.kioskMode) { return ""; }
      let u: URL;
      try { u = new URL(this.homeUrl); } catch { return "Take-home QR URL is invalid"; }
      if (u.protocol !== "https:") { return "Take-home QR URL is not https"; }
      if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)) {
        return "Take-home QR URL points at this machine or the local network";
      }
      return "";
    },
    currentMeta(): ImageMeta {
      return this.metaByName[this.selectedKey] ?? { description: "", credits: "", creditsUrl: "" };
    },
    // Distance readout shown under the title in the description panel
    // ("Distance: ≈ 7,600 light-years"). "" (renders nothing) when the
    // curated table (jwstDistances.ts) has no entry for this image.
    // `uncertain` entries swap the "≈" for "~". Distinct from formatLy()
    // above, which drives the kiosk attract captions and rounds coarser.
    distanceLabel(): string {
      const d = distanceForName(this.selectedName);
      if (!d) { return ""; }
      const symbol = d.uncertain ? "~" : "≈";
      let amount: string;
      if (d.ly >= 1e9) {
        amount = `${round1(d.ly / 1e9)} billion light-years`;
      } else if (d.ly >= 1e6) {
        amount = `${round1(d.ly / 1e6)} million light-years`;
      } else {
        amount = `${Math.round(d.ly).toLocaleString("en-US")} light-years`;
      }
      return `Distance: ${symbol} ${amount}`;
    },
    cssVars(): Record<string, string> {
      return {
        "--accent-color": this.accentColor,
        "--accent-color2": this.accentColor2,
        "--app-content-height": "100%",
      };
    },
    // The public URL encoded in the "take it home" QR. Prefer the deploy-time
    // kioskHomeUrl (set before museum install); otherwise derive it from the
    // current URL with the kiosk params stripped. The utm_source=kiosk tag lets
    // the public site's analytics count real phone scans (not just modal opens).
    // Once a guest has picked an image, the QR carries it (?image=) so they
    // can "take this view home" (audit E11).
    homeUrl(): string {
      const base = this.kioskHomeUrl
        || urlWithoutParams("kiosk", "kioskIdle", "kioskStats", "kiosk3dEvery", "tileq", "image", "mode", "debug", "galaxy");
      const params = new URLSearchParams();
      if (this.selectedPlace && !this.attractMode) { params.set("image", this.selectedName); }
      params.set("utm_source", "kiosk");
      return base + (base.includes("?") ? "&" : "?") + params.toString();
    },
    curBackgroundImagesetName: {
      get(): string {
        return this.wwtBackgroundImageset?.get_name() ?? "";
      },
      set(name: string) {
        this.setBackgroundImageByName(name);
      },
    },
    foregroundOpacity: {
      get(): number {
        return this.currentOpacity;
      },
      set(o: number) {
        this.cancelFade();
        // cancelFade freezes any mid-crossfade outgoing layer at a partial
        // opacity; pruneLayers normally only runs at fade completion, so
        // without this it would sit there, untouchable, until the next
        // selection completes. Zero it out and drop it now.
        for (const layer of this.imageLayers) {
          if (layer !== this.currentLayer) { this.setLayerOpacity(layer, 0); }
        }
        this.pruneLayers();
        this.setLayerOpacity(this.currentLayer, o);
      },
    },
  },

  watch: {
    ready(isReady: boolean): void {
      if (!isReady) { return; }
      markBootSucceeded();
      this.labelCanvas();
      if (this.initialMode3D && !this.mode3D) { this.set3DMode(); }
      if (this.kioskHomeUrlProblem) { console.warn(`[jwst] kiosk: ${this.kioskHomeUrlProblem} (${this.homeUrl})`); }
    },
    canvasLabel(): void {
      this.labelCanvas();
    },
    // Keep the address bar pointing at the current view (not in kiosk mode,
    // where the URL carries the kiosk flags and must survive the 3 AM reload).
    selectedKey(): void {
      this.syncUrl();
      // A new image starts its description at the top (and the tour caption,
      // which sits above it, is never scrolled away).
      const body = this.$refs.descBody as HTMLElement | undefined;
      if (body) { body.scrollTop = 0; }
    },
    mode3D(): void {
      this.syncUrl();
    },
    compareOpacity(v: number): void {
      if (this.compareLayer) { applyImageSetLayerSetting(this.compareLayer, ["opacity", v / 100]); }
    },
  },

  methods: {
    placeKey,

    // Engine objects are marked raw so Vue doesn't wrap their whole object
    // graphs in proxies (audit E13): identity checks against engine-internal
    // references keep working and get_*() calls skip the proxy traps.
    extractPlaces(folder: Folder): Place[] {
      return markRaw(this.collectPlaces(folder).map((p) => markRaw(p)));
    },

    collectPlaces(folder: Folder): Place[] {
      const out: Place[] = [];
      for (const child of folder.get_children() ?? []) {
        if (child instanceof Place) {
          const iset = child.get_studyImageset() ?? child.get_backgroundImageset();
          if (iset !== null) {
            out.push(child);
          }
        } else if (child instanceof Folder) {
          out.push(...this.collectPlaces(child));
        }
      }
      return out;
    },

    // Startup sequence (audit E3 + J5). Every stage is time-boxed and any
    // failure shows the error card (with Retry) instead of an endless spinner.
    // The catalog WTML is fetched exactly once: its text feeds both the
    // description/credits parser and, via a blob: URL (which the engine's URL
    // rewriter passes through untouched), the engine's own folder loader.
    async boot(): Promise<void> {
      if (!hasWebGL()) {
        this.bootError = "This browser can't display WebGL graphics, which WorldWide Telescope needs. "
          + "Try an up-to-date version of Chrome, Edge, Firefox or Safari.";
        this.bootRetryable = false;
        return;
      }
      try {
        await withTimeout(this.waitForReady(), "Starting the sky viewer", 30_000);
        this.setClockSync(false);

        if (DEBUG) {
          // Console hooks: the live component and the WWT control singleton
          // (for projecting markers from the console). ?debug=1 only (E7).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).jwstApp = this;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).WWTControl = WWTControl;
        }

        // Patch the engine for 3D up front so the first toggle is instant.
        // Only cheap prototype patches run here; the 3D downloads wait for a
        // sign of interest (warm3D, audit J3).
        this.install3DHacks();
        if (this.kioskMode || this.initialMode3D) { this.warm3D(); }

        // Background sky surveys are a nice-to-have: if their WTML fails we
        // keep the engine's default background rather than blocking the app.
        withTimeout(this.loadImageCollection({ url: this.bgWtml, loadChildFolders: true }), "Loading sky surveys")
          .then(() => { this.curBackgroundImagesetName = this.bgName; })
          .catch((err) => { console.warn("[jwst] sky surveys failed to load; keeping the default background", err); })
          .finally(() => { this.bgSurveyLoaded = true; });

        const text = await withTimeout(fetchText(this.wtml), "Loading the image catalog");
        this.metaByName = parseWtmlMetadata(text);
        this.metadataLoaded = true;

        const blobUrl = URL.createObjectURL(new Blob([text], { type: "text/xml" }));
        let folder: Folder;
        try {
          folder = await withTimeout(
            this.loadImageCollection({ url: blobUrl, loadChildFolders: true }), "Reading the image catalog");
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
        this.imagesetFolder = markRaw(folder);
        this.places = this.extractPlaces(folder);
        this.layersLoaded = true;

        if (this.places.length > 0) {
          // Park the camera zoomed out on the start target, then fly in once
          // the intro is dismissed (maybeFlyToStart handles a fast dismiss).
          this.frameStart();
          this.maybeFlyToStart();
          // Build the (initially hidden) 3D markers and 2D image footprints.
          this.buildMarkers();
          this.buildFootprints();
          // Warm the start image's layer now so the loading screen can gate on it.
          this.warmStartLayer();
        } else {
          this.startLayerLoaded = true;
        }

        // wwtZoomDeg can lag a tick on first load.
        this.positionSetTimer = window.setTimeout(() => { this.positionSet = true; }, 150);
      } catch (err) {
        console.error("[jwst] startup failed", err);
        this.bootError = describeBootError(err);
        if (this.kioskMode) {
          this.bootRetryInS = Math.round(scheduleKioskRetry() / 1000);
        }
      }
    },

    retryBoot(): void {
      window.location.reload();
    },

    placeByName(name: string): Place | null {
      const n = normalizeName(name);
      return this.places.find((p) => normalizeName(p.get_name()) === n) ?? null;
    },

    // Keep the bottom dock (description, survey menu, opacity/compare bars)
    // clear of the gallery at every size. Wide enough screens: the dock lives
    // in the strip left of the gallery, under the top-left controls. Narrow
    // (portrait phone) screens: full width, below the bottom of the gallery.
    // Kiosk: full width, below the thumbnail strip and its button bar.
    layoutDock(): void {
      const root = this.$el as HTMLElement | undefined;
      const main = root?.querySelector?.("#main-content") as HTMLElement | null;
      const gallery = root?.querySelector?.(".gallery-wrap") as HTMLElement | null;
      const controls = root?.querySelector?.(".top-left-controls") as HTMLElement | null;
      if (!main || !gallery || !controls) { return; }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const gap = 12;
      const g = gallery.getBoundingClientRect();
      let left = 16;
      let right = 16;
      let top: number;
      if (this.kioskMode) {
        const bar = root?.querySelector?.(".kiosk-top-bar") as HTMLElement | null;
        top = Math.max(g.bottom, bar ? bar.getBoundingClientRect().bottom : 0, controls.getBoundingClientRect().bottom);
      } else if (vw > 600) {
        right = vw - g.left + gap;
        top = controls.getBoundingClientRect().bottom;
      } else {
        left = right = 8;
        top = Math.max(g.bottom, controls.getBoundingClientRect().bottom);
      }
      main.style.setProperty("--dock-left", `${left}px`);
      main.style.setProperty("--dock-right", `${Math.max(left, right)}px`);
      main.style.setProperty("--dock-max-h", `${Math.max(120, vh - top - gap - 12)}px`);
    },

    labelCanvas(): void {
      const canvas = (this.$el as HTMLElement | undefined)?.querySelector?.("canvas");
      if (!canvas) { return; }
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", this.canvasLabel);
    },

    syncUrl(): void {
      if (this.kioskMode || !this.ready) { return; }
      const params = new URLSearchParams(window.location.search);
      if (this.selectedPlace) { params.set("image", this.selectedName); } else { params.delete("image"); }
      if (this.mode3D) { params.set("mode", "3d"); } else { params.delete("mode"); }
      const qs = params.toString();
      const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      try { window.history.replaceState(null, "", url); } catch { /* sandboxed iframe */ }
    },

    // Share the current view: native share sheet where available (phones),
    // otherwise copy the link.
    async shareView(): Promise<void> {
      const url = window.location.href;
      const title = this.selectedName ? `${this.selectedName} · JWST Image Explorer` : "JWST Image Explorer";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any;
      try {
        if (IS_COARSE_POINTER && typeof nav.share === "function") {
          await nav.share({ title, url });
          return;
        }
        await navigator.clipboard.writeText(url);
        this.shareStatus = "Link copied";
      } catch {
        this.shareStatus = "Couldn't copy the link";
      }
      this.announce(this.shareStatus);
      window.setTimeout(() => { this.shareStatus = ""; }, 2500);
    },

    announce(msg: string): void {
      // Clear first so repeating the same message is announced again.
      this.liveMessage = "";
      this.$nextTick(() => { this.liveMessage = msg; });
    },

    // Sky position of a place's image center (falls back to the place's own
    // coords if its imageset has none).
    placeCenter(place: Place): { raRad: number; decRad: number } {
      const iset = place.get_studyImageset() ?? place.get_backgroundImageset();
      return {
        raRad: iset ? D2R * iset.get_centerX() : place.get_RA() * 15 * D2R,
        decRad: iset ? D2R * iset.get_centerY() : place.get_dec() * D2R,
      };
    },

    // Park the camera, instantly and zoomed out, on the start target so the
    // launch fly-in has somewhere to zoom in from.
    frameStart(): void {
      if (!this.startPlace) { return; }
      const { raRad, decRad } = this.placeCenter(this.startPlace);
      this.gotoRADecZoom({ raRad, decRad, zoomDeg: this.startZoomDeg, instant: true });
    },

    // Fly in to the start image — but only once, and only after both the
    // collection has loaded and the intro has been dismissed.
    maybeFlyToStart(): void {
      if (this.hasFlownToStart || this.showIntro || !this.startPlace) { return; }
      this.hasFlownToStart = true;
      this.onSelectPlace(this.startPlace);
    },

    // Resolve once the start image's ImageSetLayer has been created (metadata
    // parsed; tiles still stream in afterward), used only as a loading-screen
    // gate so the UI doesn't reveal before the launch target is at least
    // ready to add. Added-then-immediately-deleted: onSelectPlace/maybeFlyToStart
    // adds its own layer on intro dismiss, and the browser's HTTP cache makes
    // that second add cheap.
    warmStartLayer(): void {
      const place = this.startPlace;
      if (!place) { this.startLayerLoaded = true; return; }
      const iset = place.get_studyImageset() ?? place.get_backgroundImageset();
      this.addImageSetLayer({
        url: iset?.get_url() ?? "",
        mode: "preloaded",
        name: `${place.get_name()} (prewarm)`,
        goto: false,
      }).then((layer) => {
        this.startLayerLoaded = true;
        this.deleteLayer(layer.id);
      }).catch((err) => {
        console.warn("warmStartLayer: failed to prewarm start image", err);
        this.startLayerLoaded = true;
      });
    },

    // Set an image-set layer's opacity (0..100) and, if it's the front layer,
    // mirror it into currentOpacity so the crossfade slider tracks it.
    setLayerOpacity(layer: ImageSetLayer | null, opacity: number): void {
      if (!layer) { return; }
      applyImageSetLayerSetting(layer, ["opacity", opacity / 100]);
      if (layer === this.currentLayer) {
        this.currentOpacity = opacity;
      }
    },

    // Gallery clicks and arrow-key steps are guest navigation: they end a
    // running tour (the tour's own steps call onSelectPlace directly).
    onGallerySelect(place: Place): void {
      if (this.tourActive) { this.stopTour(); }
      this.onSelectPlace(place);
    },

    onSelectPlace(place: Place): void {
      // Count only GUEST-initiated selections, never the attract auto-tour
      // (rule: attract must not pollute the "most-viewed images" metric).
      if (!this.attractMode) { statsTrack("select", place.get_name()); }
      if (this.compareActive) { this.exitCompare(); }
      this.announce(place.get_name());

      // In 3D, route gallery clicks through the smooth 3D fly (orient + cinematic
      // zoom) instead of the 2D image slew, which jumps abruptly in cosmos mode.
      if (this.mode3D) {
        const mp = this.markerPoints.find((m) => m.place === place);
        if (mp) { this.onSelectMarker(mp); }
        else { this.selectedPlace = place; this.showDescription = true; this.showSurveyMenu = false; }
        return;
      }

      const seq = ++this.selectSeq;
      this.selectedPlace = place;
      this.showDescription = true;
      this.showSurveyMenu = false; // mutually exclusive with the description panel
      this.cancelFade();

      const iset = place.get_studyImageset() ?? place.get_backgroundImageset();

      // Begin the slew now; the previously shown layer stays put meanwhile so
      // the view is never blank. We time the fade to the slew so the new image
      // "develops" during the zoom-in rather than snapping in on arrival.
      const { raRad, decRad } = this.placeCenter(place);
      const zoomDeg = place.get_zoomLevel();
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let slewMs: number;
      if (reducedMotion) {
        // Skip the cross-sky slew entirely; only the (short) crossfade animates.
        slewMs = REDUCED_MOTION_FADE_MS;
        this.gotoRADecZoom({ raRad, decRad, zoomDeg, instant: true }).catch(() => undefined);
      } else {
        const predictedMs = this.timeToRADecZoom({ raRad, decRad, zoomDeg, rollRad: 0 }) * 1000;
        slewMs = Math.min(MAX_SLEW_MS, Math.max(MIN_SLEW_MS, predictedMs));
        // The promise rejects with "superseded" if another goto starts first;
        // swallow that so it isn't an unhandled rejection. `duration` (seconds)
        // stretches the camera move to match the clamped fade so near-location
        // selects don't snap instantly.
        this.gotoRADecZoom({ raRad, decRad, zoomDeg, instant: false, duration: slewMs / 1000 }).catch(() => undefined);
      }
      // Remember this slew's length so the kiosk attract loop can pace its next
      // step to land after the fly-in settles (covers both branches above).
      this.lastSlewMs = slewMs;
      const slewStart = performance.now();

      // Add the new image as its own layer. Held at the fade floor (not 0) so
      // WWT streams its tiles during the approach, ready as the fade ramps up.
      // markRaw: keep the layer a plain object so identity checks against
      // currentLayer hold (a Vue reactive proxy would break ===).
      const prev = this.currentLayer;
      this.addImageSetLayer({
        url: iset?.get_url() ?? "",
        mode: "preloaded",
        name: place.get_name(),
        goto: false,
      }).then((layer) => {
        if (seq !== this.selectSeq) {
          // A newer selection superseded this one before the layer loaded.
          this.deleteLayer(layer.id);
          return;
        }
        const raw = markRaw(layer);
        this.imageLayers.push(raw);
        this.currentLayer = raw;
        applyImageSetLayerSetting(raw, ["opacity", FADE_FLOOR]);
        this.currentOpacity = Math.round(FADE_FLOOR * 100);
        this.crossfadeOnSlew(prev, raw, slewStart, slewMs, seq);
      }).catch((err) => {
        console.warn("onSelectPlace: failed to add image layer", err);
      });
    },

    // Two decoupled ramps anchored to the (engine-predicted, hence accurate)
    // slew: fade the OUTGOING image down over the first stretch as we pull away
    // from it, and develop the INCOMING image up over the final approach so it
    // lands right as we arrive. `to` is the front layer, so its ramp also drives
    // the crossfade slider. Stale layers are dropped at arrival.
    crossfadeOnSlew(from: ImageSetLayer | null, to: ImageSetLayer, slewStart: number, slewMs: number, seq: number): void {
      this.cancelFade();
      const smooth = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
      // Fade old out over the first ~30% of the trip; fade new in over the
      // last ~45%, each clamped to a sensible duration.
      const outMs = Math.min(3000, Math.max(600, slewMs * 0.3));
      const inMs = Math.min(4000, Math.max(800, slewMs * 0.45));
      const inStart = Math.max(0, slewMs - inMs);

      const tick = (now: number) => {
        if (seq !== this.selectSeq) { this.fadeRaf = 0; return; }
        const el = now - slewStart;
        // Outgoing layer's current opacity fraction (1 → 0 as we pull away).
        const oldFrac = from ? 1 - smooth(el / outMs) : 0;
        if (from) {
          applyImageSetLayerSetting(from, ["opacity", oldFrac]);
        }
        // Incoming layer develops from the floor up over the final approach.
        const newFrac = FADE_FLOOR + smooth((el - inStart) / inMs) * (1 - FADE_FLOOR);
        applyImageSetLayerSetting(to, ["opacity", newFrac]);
        // The slider shows whichever image is currently most visible, so it
        // traces a V: 100 → ~0 as the old image leaves → 100 as the new arrives.
        this.currentOpacity = Math.round(Math.max(oldFrac, newFrac) * 100);
        if (el < slewMs) {
          this.fadeRaf = requestAnimationFrame(tick);
        } else {
          this.setLayerOpacity(to, 100);
          this.fadeRaf = 0;
          this.pruneLayers();
        }
      };
      this.fadeRaf = requestAnimationFrame(tick);
    },

    // Remove every image-set layer that isn't the one currently in front.
    pruneLayers(): void {
      this.imageLayers = this.imageLayers.filter((layer) => {
        if (layer === this.currentLayer) { return true; }
        this.deleteLayer(layer.id);
        return false;
      });
    },

    cancelFade(): void {
      if (this.fadeRaf) {
        cancelAnimationFrame(this.fadeRaf);
        this.fadeRaf = 0;
      }
    },

    // ── Phase 2 (3D) ──────────────────────────────────────────────────────

    // Apply the WWT-engine monkey-patches that make solar-system (3D) mode show
    // a custom Milky Way + true-3D constellations, and pin the 3D zoom range.
    // Mirrors exo-sonification mounted() ~lines 1049-1361. Safe to run in 2D —
    // the patches only take effect once we enter solar-system mode.
    install3DHacks(): void {
      const ctl = WWTControl.singleton;

      // Settings for a clean cosmos: no built-in stars/figures/crosshairs.
      // showSolarSystem defaults true in the engine; leaving it on makes the 2D
      // pass draw Sun/Moon/planet sprites and run _drawSkyOverlays() a second
      // time (our patched layerManagerDraw calls it too) until the first 3D
      // roundtrip flips it off via set2DMode.
      this.applySetting(["showSolarSystem", false]);
      this.applySetting(["solarSystemStars", false]);
      this.applySetting(["showConstellationFigures", false]);
      this.applySetting(["showConstellationBoundries", false]); // engine's spelling
      this.applySetting(["showCrosshairs", false]);
      // Cosmos rendering ON: this is what draws Sky-frame cosmic-distance layers
      // (the same machinery behind WWT's SDSS galaxies) — our marker layer needs
      // it. exo left it off only because its dots came from a custom renderer.
      this.applySetting(["solarSystemCosmos", true]);
      this.applySetting(["actualPlanetScale", true]);
      // Draw the Milky Way (our patched Grids.drawGalaxyImage → Gaia quad +
      // Galaxy3D volume slices; see GALAXY3D_PLAN.md).
      this.applySetting(["solarSystemMilkyWay", true]);

      // @ts-expect-error monkey-patching the singleton
      ctl._drawSkyOverlays = drawSkyOverlays;
      // @ts-expect-error monkey-patching a static
      Constellations.initializeConstellationNames = initializeConstellationNames;

      // drawGalaxyImage draws the Gaia Milky Way (loaded by warm3D) as the base
      // quad and layers the Galaxy3D v3 volume slices on top (knobs: __gx*). It
      // no-ops gracefully until the texture exists.
      // @ts-expect-error monkey-patching a static
      Grids.drawGalaxyImage = drawGalaxyImage;
      // @ts-expect-error monkey-patching a static
      LayerManager._draw = layerManagerDraw;

      // Pin the 3D zoom range and patch zoom() to respect both ends.
      ctl.setSolarSystemMinZoom(MIN_ZOOM_3D);
      ctl.setSolarSystemMaxZoom(MAX_ZOOM_3D);
      ctl.zoom = zoom.bind(ctl);
      // (3D constellation geometry is precomputed in warm3D.)
    },

    // Start the 3D-only downloads: the Gaia Milky Way texture, the SDSS cosmos
    // (galaxy binary + 256 bucket textures), the galaxy sprite atlas and the 3D
    // constellation geometry (audit J3). Called on the first sign of intent
    // (hover/focus on the 3D button, entering 3D, ?mode=3d) and at boot in kiosk
    // mode, where smoothness matters more than bandwidth. With Save-Data on it
    // waits until 3D is actually entered (force).
    warm3D(force = false): void {
      if (this.warmed3D) { return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const saveData = !!(navigator as any).connection?.saveData;
      if (saveData && !force && !this.kioskMode) { return; }
      this.warmed3D = true;
      const ctl = WWTControl.singleton;
      // Kiosk warms at boot: stagger so the catalog + start tiles win the network.
      const delay = this.kioskMode && !force ? 6000 : 0;

      // Gaia Milky Way backdrop: 4K for the full galaxy, a self-hosted 2K copy
      // for the lite tier (quality.ts).
      this.warm3DTimers.push(window.setTimeout(() => {
        Grids._milkyWayImage = Texture.fromUrl(gaiaMilkyWayUrl());
      }, delay));
      // The lite tier never draws the SDSS cosmos or the galaxy sprites, so
      // it skips their downloads and atlas build entirely.
      if (!GALAXY_LITE) {
        this.warm3DTimers.push(prefetchCosmos(delay));
        // Galaxy sprite atlas paint + structure build is pure canvas/math; run
        // it in idle time so the first 3D draw only uploads buffers.
        const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
        if (typeof idle === "function") {
          idle(() => prewarmGalaxySprites(), { timeout: 10000 });
        } else {
          this.warm3DTimers.push(window.setTimeout(() => prewarmGalaxySprites(), delay + 500));
        }
      }
      // Precompute the 3D constellation line geometry so the first toggle in
      // 3D fades in smoothly. Poll until the star + figure files land (≤ 30 s).
      this.figures3DPollTimer = window.setInterval(() => {
        if (prebuildFigures3D(ctl.renderContext)) { window.clearInterval(this.figures3DPollTimer); }
      }, 250);
      this.figures3DGiveUpTimer = window.setTimeout(() => window.clearInterval(this.figures3DPollTimer), 30000);
    },

    // Precompute every JWST image's true 3D position (world AU, ecliptic-rotated)
    // and hand the set to the custom glow-disc renderer (marker-renderer.ts),
    // colored per object type (or uniform gold — see MARKER_COLOR_BY_TYPE). The
    // same world positions are cached in markerPoints[] for screen-projection
    // hit-testing (hover/click). Markers stay hidden (opacity 0) until 3D mode.
    buildMarkers(): void {
      const pts: MarkerPoint[] = [];
      const rows: MarkerRow[] = [];
      const cosE = Math.cos(ECLIPTIC_RAD);
      const sinE = Math.sin(ECLIPTIC_RAD);

      for (const place of this.places) {
        const ly = distanceLyForName(place.get_name());
        if (ly == null || !(ly > 0)) { continue; }
        const { raRad, decRad } = this.placeCenter(place);
        const raDeg = raRad * R2D;
        const decDeg = decRad * R2D;

        // World position matching the engine's lightYears/distance vertex:
        // raDecTo3dAu(RA_hours, Dec_deg, alt_AU) then rotateX(ecliptic).
        const au = ly * LY_TO_AU;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (Coordinates as any).raDecTo3dAu(raDeg / 15, decDeg, au);
        const xR = v.x;
        const yR = v.y * cosE - v.z * sinE;
        const zR = v.y * sinE + v.z * cosE;
        pts.push({ place, name: place.get_name(), raDeg, decDeg, ly, xR, yR, zR });

        const meta = MARKER_COLOR_BY_TYPE ? typeMetaForName(place.get_name()) : null;
        rows.push({ xR, yR, zR, color: meta?.color ?? MARKER_COLOR_HEX });
      }
      this.markerPoints = markRaw(pts);
      installMarkerCloud(rows);
    },

    // Precompute each image's 2D sky-footprint outline and hand it to the line
    // renderer (footprints.ts). Each footprint is a box of angular side
    // ≈ the imageset's baseTileDegrees, centered on the image and rotated by the
    // imageset rotation, with corners projected onto the unit sky sphere (radius
    // 1 — the 2D convention; the 3D ecliptic tilt is markers-only). Approximate:
    // a position/scale/orientation indicator, not the exact WCS quad. Colored per
    // object type (gold fallback), like the markers and gallery badges. Footprints
    // stay hidden until the user toggles them on, and render in 2D only.
    buildFootprints(): void {
      const verts: FootprintVertex[] = [];
      // Corner order around the box; emitted as 4 LINE pairs below.
      const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

      for (const place of this.places) {
        const iset = place.get_studyImageset() ?? place.get_backgroundImageset();
        if (!iset) { continue; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyIset = iset as any;
        const deg = anyIset.get_baseTileDegrees ? anyIset.get_baseTileDegrees() : 0;
        if (!(deg > 0)) { continue; }
        const half = deg / 2;
        const rot = (anyIset.get_rotation ? anyIset.get_rotation() : 0) * D2R;
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);
        const raDeg = iset.get_centerX();
        const decDeg = iset.get_centerY();
        // Guard the RA scaling near the poles (cos(dec) → 0).
        const cosDec = Math.max(0.02, Math.cos(decDeg * D2R));
        const color = typeMetaForName(place.get_name())?.color ?? MARKER_COLOR_HEX;

        const ring: FootprintVertex[] = corners.map(([sx, sy]) => {
          const lx = sx * half;
          const ly = sy * half;
          // Rotate the local box offset, then map (east, north) deg → RA/Dec.
          const east = lx * cosR + ly * sinR;
          const north = -lx * sinR + ly * cosR;
          const cdec = decDeg + north;
          const craDeg = raDeg + east / cosDec;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const v = (Coordinates as any).raDecTo3dAu(craDeg / 15, cdec, 1);
          return { x: v.x, y: v.y, z: v.z, color };
        });
        // 4 edges as LINE endpoint pairs (a LINE_LOOP expressed as gl.LINES).
        for (let i = 0; i < 4; i++) {
          verts.push(ring[i], ring[(i + 1) % 4]);
        }
      }
      installFootprints(verts);
    },

    // Toggle the 2D image-footprint outlines. They render in 2D only (the
    // renderer self-gates in 3D), so toggling while in 3D just takes effect on
    // return to 2D.
    toggleFootprints(): void {
      this.showFootprints = !this.showFootprints;
      setFootprintsVisible(this.showFootprints);
      this.isMenuOpen = false;
    },

    setMarkerOpacity(opacity: number): void {
      setMarkerCloudOpacity(opacity);
    },

    toggle3D(): void {
      statsTrack("mode3d");
      if (this.mode3D) { this.set2DMode(); } else { this.set3DMode(); }
      this.isMenuOpen = false;
    },

    // Fade the constellation figure lines in/out (works in both 2D and 3D; the
    // 3D path projects them onto true star positions and dims them).
    toggleConstellations(): void {
      this.showConstellations = !this.showConstellations;
      setConstellationFiguresTarget(this.showConstellations ? 1 : 0);
      this.isMenuOpen = false;
    },

    // Toggle the optional COSMOS-Web galaxy field. Lazy-loads the assets
    // (public/cosmosweb/{field.bin,atlas.png,atlas.json}) on first enable, and
    // switches into 3D since the field only renders in solar-system mode.
    async toggleCosmosWeb(): Promise<void> {
      this.isMenuOpen = false;
      if (this.showCosmosWeb) {
        this.showCosmosWeb = false;
        setCosmosWebFieldVisible(false);
        return;
      }
      if (!this.mode3D) { this.set3DMode(); }
      if (!this.cosmosWebLoading) {
        this.cosmosWebLoading = true;
        try {
          await loadCosmosWebField("cosmosweb");
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("[jwst] COSMOS-Web field failed to load", e);
          this.cosmosWebLoading = false;
          return;
        }
        this.cosmosWebLoading = false;
      }
      this.showCosmosWeb = true;
      setCosmosWebFieldVisible(true);
    },

    set3DMode(): void {
      if (this.mode3D) { return; }
      this.warm3D(true);
      if (this.compareActive) { this.exitCompare(); }
      // Remember the current 2D view + survey so "exit 3D" can return to them.
      // Capture the survey name NOW — once we switch the background to "Solar
      // System" below, curBackgroundImagesetName's getter would report that
      // instead, and set2DMode would re-enter 3D.
      this.saved2DPosition = { raRad: this.wwtRARad, decRad: this.wwtDecRad, zoomDeg: this.wwtZoomDeg };
      const curBg = this.curBackgroundImagesetName;
      this.saved2DBackground = (curBg && curBg !== "Solar System") ? curBg : this.bgName;
      this.mode3D = true;
      this.showDescription = false;
      this.showSurveyMenu = false;
      this.cancelFade();

      // Enter the WWT solar-system cosmos and reveal the markers.
      this.setBackgroundImageByName("Solar System");
      this.setForegroundImageByName("Solar System");
      this.setMarkerOpacity(1.0);
      notifyConstellationModeChange();

      this.gotoRADecZoom({ ...POSITION_3D, instant: true }).catch(() => undefined);
    },

    // Leave 3D. If `place` is given (View in 2D), fly to that image — with
    // `gentle`, jump there and ease in instead of slewing; otherwise restore
    // the saved 2D view.
    set2DMode(place?: Place, gentle = false): void {
      if (!this.mode3D && !place) { return; }
      this.mode3D = false;
      this.clearHover3D();
      setMarkerHighlight(null);
      this.setMarkerOpacity(0.0);

      // Back to the sky survey we saved on the way in (NOT the live
      // curBackgroundImagesetName — it currently reads "Solar System"); clear
      // the Solar System foreground, then drop solar-system mode. This is what
      // actually switches the engine's renderType back out of 3D.
      this.setBackgroundImageByName(this.saved2DBackground || this.bgName);
      this.setForegroundImageByName("");
      this.applySetting(["showSolarSystem", false]);
      notifyConstellationModeChange();

      // Defer the camera move one tick. Calling gotoRADecZoom in the SAME frame
      // as the mode switch flies to a 2D zoom while the engine is still tearing
      // down the solar-system render state → black viewport. exo's set2DMode does
      // the same via asyncSetTimeout(10).
      this.set2DModeTimer = window.setTimeout(() => {
        if (place) {
          if (gentle) { this.selectPlaceGentle(place); } else { this.onSelectPlace(place); }
        } else if (this.saved2DPosition) {
          this.gotoRADecZoom({ ...this.saved2DPosition, instant: true }).catch(() => undefined);
        }
      }, 10);
    },

    // Every "View in 2D" entry point (description thumbnail, the panel button,
    // the kiosk bar) uses the same gentle arrival (audit J17).
    viewIn2D(): void {
      if (this.mode3D && this.selectedPlace) {
        this.set2DMode(this.selectedPlace, true);
      } else if (this.mode3D) {
        this.set2DMode();
      }
    },

    // Like onSelectPlace, but with no cross-sky slew: jump instantly to the
    // target RA/Dec at a slightly backed-off zoom, then ease the final zoom-in
    // while the image develops — a gentle "arrive and focus" rather than a
    // 15-20s journey. Used by the 3D desc-thumbnail click.
    selectPlaceGentle(place: Place): void {
      const seq = ++this.selectSeq;
      this.selectedPlace = place;
      this.showDescription = true;
      this.showSurveyMenu = false;
      this.cancelFade();

      const iset = place.get_studyImageset() ?? place.get_backgroundImageset();
      const { raRad, decRad } = this.placeCenter(place);
      const zoomDeg = place.get_zoomLevel();
      const slewMs = GENTLE_SLEW_MS;
      const slewStart = performance.now();
      // Instant jump to the target (backed off), then the gentle remainder.
      this.gotoRADecZoom({ raRad, decRad, zoomDeg: zoomDeg * GENTLE_ZOOM_BACKOFF, instant: true })
        .then(() => {
          // A newer selection may have started (and even completed) its own
          // instant jump while this one's promise was pending — don't stomp
          // it with a stale eased zoom.
          if (seq !== this.selectSeq) { return undefined; }
          return this.gotoRADecZoom({ raRad, decRad, zoomDeg, instant: false, duration: slewMs / 1000 });
        })
        .catch(() => undefined);

      const prev = this.currentLayer;
      this.addImageSetLayer({
        url: iset?.get_url() ?? "",
        mode: "preloaded",
        name: place.get_name(),
        goto: false,
      }).then((layer) => {
        if (seq !== this.selectSeq) {
          this.deleteLayer(layer.id);
          return;
        }
        const raw = markRaw(layer);
        this.imageLayers.push(raw);
        this.currentLayer = raw;
        applyImageSetLayerSetting(raw, ["opacity", FADE_FLOOR]);
        this.currentOpacity = Math.round(FADE_FLOOR * 100);
        this.crossfadeOnSlew(prev, raw, slewStart, slewMs, seq);
      }).catch((err) => {
        console.warn("selectPlaceGentle: failed to add image layer", err);
      });
    },

    // Fly to the image's marker in 3D and open its description, with a
    // "View in 2D" affordance (the description panel shows it while in 3D).
    onSelectMarker(mp: MarkerPoint): void {
      this.selectedPlace = mp.place;
      this.showDescription = true;
      this.showSurveyMenu = false;
      this.clearHover3D();
      // Highlight the focused marker until the user pans/zooms away from it.
      setMarkerHighlight({ xR: mp.xR, yR: mp.yR, zR: mp.zR });
      this.flyToMarker3D(mp);
    },

    // Build the gotoTargetFullHacked camera params that fly to/land on a
    // marker's true world vertex (exo's gotoExoplanet3D approach): set the
    // camera's viewTarget to mp's world vertex so the engine keeps it centered
    // and approaches it, routed through gotoTargetFullHacked's smootherstep
    // mover (which lerps viewTarget too). The camera distance is capped
    // (FLY_CAM_DIST_CAP_AU) so the zoom-tied Milky Way backdrop fades out by
    // arrival rather than rendering displaced. mp.xR/yR/zR are the
    // ecliptic-rotated world vertex, same as the marker draw + hit-test.
    // Shared by flyToMarker3D (cinematic fly) and the attract-loop 3D
    // interlude (instant jump). Returns null on a degenerate marker (zero
    // vertex) or if the render context isn't up yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    markerCamParams(mp: MarkerPoint): any | null {
      const ctl = WWTControl.singleton;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rc = (ctl as any).renderContext;
      if (!rc) { return null; }

      const vx = mp.xR, vy = mp.yR, vz = mp.zR;
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (!(len > 0)) { return null; }

      // Camera look direction → marker's sky direction (engine view convention).
      const latDeg = Math.asin(Math.max(-1, Math.min(1, -vy / len))) * R2D;
      const lngDeg = Math.atan2(vx, -vz) * R2D;

      // Approach distance from the object (cameraDist = 4·zoom/9), capped so we
      // arrive close (and the backdrop fades) for far objects but stay
      // proportional for near ones.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cap = ((window as any).__flyCamDist as number | undefined) ?? FLY_CAM_DIST_CAP_AU;
      const targetCamDistAU = Math.max(13333, Math.min(len * 0.25, cap));
      const zoomDeg = Math.max(MIN_ZOOM_3D, Math.min(MAX_ZOOM_3D, (9 / 4) * targetCamDistAU));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = rc.viewCamera.copy();
      params.lat = latDeg;
      params.lng = lngDeg;
      params.zoom = zoomDeg;
      params.target = 20; // SolarSystemObjects.custom — engine preserves viewTarget
      params.targetReferenceFrame = "";
      params.viewTarget.x = vx;
      params.viewTarget.y = vy;
      params.viewTarget.z = vz;
      return params;
    },

    // Cinematic (3 s) fly-in to a marker — see markerCamParams for the shape.
    flyToMarker3D(mp: MarkerPoint): void {
      const ctl = WWTControl.singleton;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rc = (ctl as any).renderContext;
      if (!rc) { return; }
      const params = this.markerCamParams(mp);
      if (!params) { return; }

      gotoTargetFullHacked(
        ctl, false, false, params,
        rc.get_foregroundImageset(), rc.get_backgroundImageset(), 3,
      );
    },

    // Attract-loop 3D interlude, pull-back phase: fly from a marker (or
    // wherever the camera is) out to the Milky Way overview — mirrors
    // flyToMarker3D's shape but targets OVERVIEW_CAM (viewTarget at the
    // origin) instead of a marker's world vertex.
    flyToOverview3D(): void {
      const ctl = WWTControl.singleton;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rc = (ctl as any).renderContext;
      if (!rc) { return; }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = rc.viewCamera.copy();
      params.lat = OVERVIEW_CAM.lat;
      params.lng = OVERVIEW_CAM.lng;
      params.zoom = OVERVIEW_CAM.zoom;
      params.target = 20;
      params.targetReferenceFrame = "";
      params.viewTarget.x = 0;
      params.viewTarget.y = 0;
      params.viewTarget.z = 0;

      gotoTargetFullHacked(
        ctl, false, false, params,
        rc.get_foregroundImageset(), rc.get_backgroundImageset(), KIOSK_ATTRACT_3D_FLYOUT_S,
      );
    },

    // Marker lookup for a Place: identity first (Vue returns the same raw
    // object/proxy for the same underlying Place), name as a fallback (covers
    // a Place instance that doesn't reference-match, e.g. re-extracted).
    markerForPlace(place: Place): MarkerPoint | null {
      return this.markerPoints.find((mp) => mp.place === place)
        ?? this.markerPoints.find((mp) => mp.name === place.get_name())
        ?? null;
    },

    // ── 3D pointer interaction ────────────────────────────────────────────
    onViewerPointerDown(ev: PointerEvent): void {
      if (!this.mode3D) { return; }
      // Events bubble up to #main-content from overlay UI (gallery, panels,
      // buttons) too; ev.offsetX/Y there is relative to that overlay element,
      // not the canvas, and identifyMarker would misread it as a near-origin
      // click. Only handle events that originated on the WWT canvas itself.
      if (!(ev.target instanceof HTMLCanvasElement)) { return; }
      this.pointerDownAt = { x: ev.clientX, y: ev.clientY };
    },

    onViewerPointerMove(ev: PointerEvent): void {
      if (!this.mode3D) { return; }
      if (!(ev.target instanceof HTMLCanvasElement)) { return; }
      // rAF-throttle: projecting every marker each native pointermove would
      // stutter the pan on a high-rate mouse. Keep only the latest event.
      this.pendingHoverEvent = ev;
      if (this.hoverRaf) { return; }
      this.hoverRaf = requestAnimationFrame(() => {
        this.hoverRaf = 0;
        const e = this.pendingHoverEvent;
        this.pendingHoverEvent = null;
        if (e) { this.identifyMarker(e, true); }
      });
    },

    onViewerPointerUp(ev: PointerEvent): void {
      if (!this.mode3D) { return; }
      if (!(ev.target instanceof HTMLCanvasElement)) { return; }
      const start = this.pointerDownAt;
      this.pointerDownAt = null;
      // Treat as a click only if the pointer didn't drag (which pans the view).
      if (start) {
        const moved = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
        if (moved > 6) {
          // Panned away from the focused object — drop the highlight.
          setMarkerHighlight(null);
          return;
        }
      }
      this.identifyMarker(ev, false);
    },

    // Find the marker nearest the pointer (in screen px) and either show its
    // hover tooltip or, on click, fly to it.
    identifyMarker(ev: PointerEvent, hover: boolean): void {
      const ctl = WWTControl.singleton;
      const px = ev.offsetX;
      const py = ev.offsetY;
      const touch = ev.pointerType === "touch" || ev.pointerType === "pen";
      const thresh = hover ? 14 : (touch ? 24 : 18);
      const threshSq = thresh * thresh;
      let best: MarkerPoint | null = null;
      let bestX = 0;
      let bestY = 0;
      let bestDistSq = Infinity;

      for (const mp of this.markerPoints) {
        const sp = worldToScreen(mp.xR, mp.yR, mp.zR);
        if (!sp || !isFinite(sp.x) || !isFinite(sp.y)) { continue; }
        // Reject points behind the camera (the projection mirrors antipodes).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ray = (ctl as any).getRayForScreenPoint?.(sp.x, sp.y);
        if (ray && ray[1] && Math.abs(ray[1].x) > 1e-12) {
          const t = (mp.xR - ray[0].x) / ray[1].x;
          if (t < 0) { continue; }
        }
        const dSq = (sp.x - px) * (sp.x - px) + (sp.y - py) * (sp.y - py);
        if (dSq < bestDistSq) { bestDistSq = dSq; best = mp; bestX = sp.x; bestY = sp.y; }
      }

      if (!best || bestDistSq > threshSq) {
        if (hover || touch) { this.clearHover3D(); }
        this.pendingTapName = "";
        return;
      }

      if (hover) {
        this.showHover3D(best, bestX, bestY, "");
      } else if (touch && this.pendingTapName !== best.name) {
        // First tap previews (label + "Tap again"), so a mis-tap in a dense
        // field costs nothing; a second tap on the same marker opens it.
        this.pendingTapName = best.name;
        this.showHover3D(best, bestX, bestY, "Tap again to open");
      } else {
        this.pendingTapName = "";
        this.onSelectMarker(best);
      }
    },

    // Update the hover label in place (no new object per frame, audit J23).
    showHover3D(mp: MarkerPoint, x: number, y: number, hint: string): void {
      const h = this.hover3D;
      if (h.name !== mp.name) {
        h.name = mp.name;
        h.thumb = this.markerThumb(mp.place);
      }
      h.x = x;
      h.y = y;
      h.hint = hint;
      h.show = true;
    },

    clearHover3D(): void {
      if (this.hover3D.show) { this.hover3D.show = false; }
    },

    // Diagnostic: in 3D, run `window.jwstApp.debug3D()` in the console. Reports
    // mode/marker count and where the first few markers project on screen
    // (on-screen ⇒ rendering, off-screen/NaN ⇒ camera/positioning). The glow
    // discs themselves are drawn by marker-renderer.ts; tune them live with
    // window.__markerSize / __markerBlend / __markerCloud (see that file).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    debug3D(): any {
      const ctl = WWTControl.singleton;
      const samples = this.markerPoints.slice(0, 5).map((mp) => {
        const sp = worldToScreen(mp.xR, mp.yR, mp.zR);
        return { name: mp.name, ly: mp.ly, x: sp?.x, y: sp?.y };
      });
      const info = {
        mode3D: this.mode3D,
        galaxyTier: GALAXY_TIER,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        solarSystemMode: (ctl as any).get_solarSystemMode?.(),
        markerCount: this.markerPoints.length,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        sampleProjections: samples,
      };
      // eslint-disable-next-line no-console
      console.log("[debug3D]", JSON.stringify(info, null, 2));
      return info;
    },

    // Sharp level-0 base tile for a marker's hover thumbnail (same derivation as
    // the gallery — see ImageGallery.thumbUrl).
    markerThumb(place: Place): string {
      const iset = place.get_studyImageset() ?? place.get_backgroundImageset();
      const tpl = iset?.get_url() ?? "";
      if (tpl.includes("{1}")) {
        return tpl.replace(/\{1\}/g, "0").replace(/\{2\}/g, "0").replace(/\{3\}/g, "0");
      }
      return iset?.get_thumbnailUrl() || place.get_thumbnailUrl() || "";
    },

    // The desc-panel thumbnail is a level-0 base tile, which letterboxes
    // non-square images with padding baked into the pixels — swap in the
    // content-cropped version (shared cache with the gallery) so it fills its
    // box. The same <img> is reused across selections, so guard against a
    // stale async swap by re-checking the live src.
    onDescThumbLoad(ev: Event): void {
      const img = ev.target as HTMLImageElement;
      const src = img.src;
      if (src.startsWith("blob:")) { return; } // our own cropped-swap reload
      croppedTileUrl(src).then((dataUrl) => {
        if (dataUrl && img.src === src) { img.src = dataUrl; }
      });
    },

    toggleMenu(): void {
      this.isMenuOpen = !this.isMenuOpen;
    },
    openIntro(): void {
      // Opened from the hamburger menu — return focus to its toggle button
      // (not the menu item, which is hidden once the menu closes) on close.
      this.introTriggerEl = this.$refs.menuToggleBtn as HTMLElement | null;
      this.showIntro = true;
      this.isMenuOpen = false;
      this.focusIntroClose();
    },
    closeIntro(): void {
      this.showIntro = false;
      this.maybeFlyToStart();
      this.introTriggerEl?.focus();
      this.introTriggerEl = null;
    },
    // Move keyboard focus into the intro dialog on open — onto the dialog
    // CONTAINER (tabindex="-1"), not the close button: focusing the X painted
    // a focus ring on it at every launch, which read as "the button is
    // selected/highlighted". Container focus is the standard ARIA dialog
    // pattern; one Tab lands on the close button.
    focusIntroClose(): void {
      this.$nextTick(() => {
        (this.$refs.introModal as HTMLElement | undefined)?.focus();
      });
    },
    // Keep Tab cycling within the intro dialog while it's open.
    onIntroTabKey(ev: KeyboardEvent): void {
      const modal = this.$refs.introModal as HTMLElement | undefined;
      if (!modal) { return; }
      const focusables = modal.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) { return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Focus starts on the dialog container itself (see focusIntroClose);
      // route the first Tab/Shift+Tab into the cycle so it can't escape.
      if (document.activeElement === modal) {
        ev.preventDefault();
        (ev.shiftKey ? last : first).focus();
        return;
      }
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    },
    // P3.4: step to the prev (-1) / next (+1) image in the gallery's CURRENT
    // visible list (visibleOrder = chip filter + search applied, display order).
    // Identity is by placeKey, not Name (Names collide across duplicate crops).
    // Wraps around; if the current selection isn't in the list (filtered out) or
    // nothing is selected, next → first item, prev → last. Empty list = no-op.
    // onSelectPlace handles the rest (2D slew+crossfade, or 3D marker fly-in).
    stepImage(delta: 1 | -1): void {
      const list = this.visibleOrder;
      if (list.length === 0) { return; }
      const key = this.selectedKey;
      const idx = key ? list.findIndex((p) => placeKey(p) === key) : -1;
      let target: Place;
      if (idx === -1) {
        target = delta > 0 ? list[0] : list[list.length - 1];
      } else {
        target = list[(idx + delta + list.length) % list.length];
      }
      this.onSelectPlace(target);
    },
    // P3.4: step prev/next through the gallery's visible list with the arrow
    // keys, and (below) close overlays with Escape.
    onGlobalKeydown(ev: KeyboardEvent): void {
      // Left/Right = previous/next image. Suppressed while:
      //  - a text/interactive input is focused (ANY <input>, incl. the crossfade
      //    range slider, which itself uses arrows; also <textarea>/<select>/
      //    contentEditable and the gallery search box),
      //  - the intro or QR modal is open,
      //  - the key is auto-repeating (holding must not machine-gun slews).
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
        if (this.showIntro || this.showQrModal) { return; }
        if (ev.repeat) { return; }
        const el = document.activeElement as HTMLElement | null;
        if (el && (
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable
        )) { return; }
        ev.preventDefault();
        if (this.tourActive) {
          this.tourStep(ev.key === "ArrowRight" ? 1 : -1);
        } else {
          this.stepImage(ev.key === "ArrowRight" ? 1 : -1);
        }
        return;
      }
      // Escape closes whichever overlay is topmost (QR > intro > hamburger > survey).
      if (ev.key !== "Escape") { return; }
      if (this.showQrModal) { this.closeQR(); return; }
      if (this.showIntro) { this.closeIntro(); }
      else if (this.isMenuOpen) { this.isMenuOpen = false; }
      else if (this.showSurveyMenu) { this.showSurveyMenu = false; }
      else if (this.compareActive) { this.exitCompare(); }
      else if (this.tourActive) { this.stopTour(); }
    },
    // Close the hamburger/survey menus when the user clicks outside them
    // (the intro modal already has its own backdrop click-to-close).
    onGlobalPointerdown(ev: PointerEvent): void {
      const target = ev.target as Node;
      if (this.isMenuOpen) {
        const controls = document.querySelector(".top-left-controls");
        if (controls && !controls.contains(target)) { this.isMenuOpen = false; }
      }
      if (this.showSurveyMenu) {
        const menu = document.querySelector(".survey-menu");
        if (menu && !menu.contains(target)) { this.showSurveyMenu = false; }
      }
    },
    toggleSurveyMenu(): void {
      this.showSurveyMenu = !this.showSurveyMenu;
      this.isMenuOpen = false;
      // The survey menu and the description panel share the same spot, so only
      // one shows at a time. Focus moves into the menu (the active option, or
      // the first) so keyboard users land where they can act.
      if (this.showSurveyMenu) {
        this.showDescription = false;
        this.$nextTick(() => {
          const menu = document.querySelector(".survey-menu");
          const target = menu?.querySelector<HTMLElement>(".survey-option.active")
            ?? menu?.querySelector<HTMLElement>(".survey-option");
          target?.focus();
        });
      }
    },
    selectSurvey(name: string): void {
      statsTrack("survey");
      if (this.mode3D) {
        // setBackgroundImageByName would replace the "Solar System" background
        // and flip the engine out of solar-system rendering while mode3D stays
        // true (markers still visible, zoom still cosmic-scale) — a broken
        // state set2DMode can't cleanly recover from. Defer the choice; it
        // applies when set2DMode restores saved2DBackground.
        this.saved2DBackground = name;
        return;
      }
      this.curBackgroundImagesetName = name;
    },
    toggleCrossfade(): void {
      this.showCrossfade = !this.showCrossfade;
      this.isMenuOpen = false;
    },
    toggleFullscreen(): void {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch((err) => {
          console.warn(`Fullscreen request failed: ${err.message}`);
        });
      } else {
        document.exitFullscreen();
      }
    },
    // In kiosk mode, external links must not navigate the browser away from the
    // exhibit — show a QR the guest can scan on their phone instead. Otherwise
    // open a real new tab. `label` becomes the QR modal title.
    openLink(url: string, label = ""): void {
      if (this.kioskMode) { this.showQR(url, label); this.isMenuOpen = false; return; }
      window.open(url, "_blank", "noopener");
      this.isMenuOpen = false;
    },

    // Open the kiosk QR modal for `url`. Closes the menus so they don't sit
    // under the backdrop.
    showQR(url: string, title = "", typeUrl = ""): void {
      this.qrUrl = url;
      this.qrTitle = title;
      this.qrTypeUrl = typeUrl;
      this.showQrModal = true;
      this.isMenuOpen = false;
      this.showSurveyMenu = false;
      statsTrack("qr", url);
    },
    closeQR(): void { this.showQrModal = false; },

    // "Take it with you" — QR of the public site URL so a guest can continue on
    // their phone.
    showHomeQR(): void {
      this.showQR(this.homeUrl, "Take it with you", this.homeTypeUrl);
      statsTrack("takeHome");
    },

    // ── Guided tour (audit J8) ────────────────────────────────────────────
    // A visitor-paced walk through TOUR_STOPS: each stop flies to the image
    // and shows its caption above the description, with Back/Next/Exit.
    // Gallery clicks, Escape, entering 3D or the attract loop end it.
    startTour(): void {
      this.isMenuOpen = false;
      if (this.tourPlaces.length === 0) { return; }
      if (this.showIntro) { this.showIntro = false; this.hasFlownToStart = true; }
      if (this.mode3D) { this.set2DMode(); }
      statsTrack("tour");
      this.tourActive = true;
      this.tourIdx = 0;
      this.goToTourStop();
    },
    tourStep(delta: 1 | -1): void {
      if (!this.tourActive) { return; }
      const n = this.tourPlaces.length;
      const next = this.tourIdx + delta;
      if (next < 0 || next >= n) {
        if (next >= n) { this.stopTour(); this.announce("Tour finished"); }
        return;
      }
      this.tourIdx = next;
      this.goToTourStop();
    },
    goToTourStop(): void {
      const stop = this.tourPlaces[this.tourIdx];
      if (!stop) { return; }
      this.showDescription = true;
      this.onSelectPlace(stop.place);
      this.announce(`Tour stop ${this.tourIdx + 1} of ${this.tourPlaces.length}: ${stop.place.get_name()}`);
    },
    stopTour(): void {
      this.tourActive = false;
    },

    // ── Compare mode (audit J9) ───────────────────────────────────────────
    // Layers a second image of the same target over the current one; the
    // compare slider blends from "current only" (0) to "other only" (100).
    // The compare layer lives outside imageLayers, so pruneLayers never drops it.
    startCompare(place?: Place): void {
      const target = place ?? this.compareCandidates[0];
      if (!target || this.mode3D) { return; }
      statsTrack("compare");
      this.compareActive = true;
      this.setCompareTarget(target);
    },
    setCompareTarget(place: Place): void {
      const seq = ++this.compareSeq;
      this.removeCompareLayer();
      this.comparePlace = place;
      const iset = place.get_studyImageset() ?? place.get_backgroundImageset();
      this.addImageSetLayer({
        url: iset?.get_url() ?? "",
        mode: "preloaded",
        name: `${place.get_name()} (compare)`,
        goto: false,
      }).then((layer) => {
        if (seq !== this.compareSeq || !this.compareActive) { this.deleteLayer(layer.id); return; }
        this.compareLayer = markRaw(layer);
        applyImageSetLayerSetting(this.compareLayer, ["opacity", this.compareOpacity / 100]);
      }).catch((err) => {
        console.warn("compare: failed to add layer", err);
      });
    },
    onCompareSelect(ev: Event): void {
      const key = (ev.target as HTMLSelectElement).value;
      const place = this.compareCandidates.find((p) => placeKey(p) === key);
      if (place) { this.setCompareTarget(place); }
    },
    removeCompareLayer(): void {
      if (this.compareLayer) {
        this.deleteLayer(this.compareLayer.id);
        this.compareLayer = null;
      }
    },
    exitCompare(): void {
      this.compareSeq++;
      this.compareActive = false;
      this.comparePlace = null;
      this.removeCompareLayer();
    },
    // Swap which image is "current": the compared image becomes the selection.
    swapCompare(): void {
      const other = this.comparePlace;
      if (!other) { return; }
      this.exitCompare();
      this.onSelectPlace(other);
    },

    // ── Kiosk attract loop ─────────────────────────────────────────────────
    // Entered on idle: reset to a clean 2D view, then auto-cycle images.
    enterAttract(): void {
      // The session ends at the guest's LAST activity, not when the idle timer
      // fired, so the 90 s idle tail isn't counted as dwell.
      statsSessionEnd(this.kioskIdleWatcher?.lastActivityTs() ?? Date.now());
      this.stopTour();
      if (this.compareActive) { this.exitCompare(); }
      this.resetKioskView();
      // 3 s settle lets set2DMode's deferred (10 ms) camera move finish before
      // the first attract step, so they don't fight.
      this.attractTimer = window.setTimeout(() => {
        this.attractMode = true;
        this.attractOrder = shuffled(this.galleryPlaces);
        this.attractIdx = 0;
        this.attractNext();
      }, 3000);
    },

    // Return the viewer to a clean, default state before the tour begins: no
    // menus/panels open, back in 2D on the default survey, overlays off.
    resetKioskView(): void {
      this.closeQR();
      this.isMenuOpen = false;
      this.showSurveyMenu = false;
      this.showDescription = true; // image names show during the tour
      this.attractCaption = "";
      if (this.mode3D) {
        // NEVER read curBackgroundImagesetName here (reports "Solar System" in 3D).
        this.saved2DBackground = this.bgName;
        this.set2DMode();
      } else {
        this.setBackgroundImageByName(this.bgName); // restore survey if a guest switched it
      }
      if (this.showConstellations) { this.toggleConstellations(); }
      if (this.showFootprints) { this.toggleFootprints(); }
    },

    // Fly to the next image in the shuffled order and schedule the step after
    // — UNLESS this step lands on the "every Nth" cadence, in which case it
    // detours through the 3D cosmic-zoom-out interlude instead (which itself
    // ends on this same place, Q, back in 2D — see attract3DPhase4).
    attractNext(): void {
      if (!this.attractMode) { return; }
      if (this.attractOrder.length === 0) { return; }
      const place = this.attractOrder[this.attractIdx % this.attractOrder.length];
      this.attractIdx += 1;

      const mpP = this.selectedPlace ? this.markerForPlace(this.selectedPlace) : null;
      const mpQ = this.markerForPlace(place);
      const interlude = this.attract3DEvery > 0 && this.attractIdx > 0
        && this.attractIdx % this.attract3DEvery === 0 && !this.mode3D && !!mpP && !!mpQ;

      if (interlude) {
        this.attract3DInterlude(mpP as MarkerPoint, mpQ as MarkerPoint, place);
        return;
      }

      this.onSelectPlace(place); // free cinematic slew + crossfade + pruneLayers
      const stepMs = (this.lastSlewMs || KIOSK_ATTRACT_FALLBACK_STEP_MS) + KIOSK_ATTRACT_DWELL_MS;
      this.attractTimer = window.setTimeout(() => this.attractNext(), stepMs);
    },

    // ── Attract-loop "cosmic zoom-out" 3D interlude ──────────────────────────
    // Phase 1: jump (instant) to P's marker — "that image lives HERE".
    // Phase 2: pull back to the Milky Way overview.
    // Phase 3: fly (guest path) to Q's marker — "next stop".
    // Phase 4: drop back to 2D on Q (the normal cinematic reveal) and resume
    // the normal attract cadence.
    // Every phase is a `window.setTimeout` chained through the SAME
    // `this.attractTimer` field and starts with an attractMode guard, so
    // stopAttract()'s single clearTimeout kills the sequence at any point —
    // the guest then simply inherits whatever view is on screen.
    attract3DInterlude(mpP: MarkerPoint, mpQ: MarkerPoint, placeQ: Place): void {
      this.set3DMode();
      // 150 ms lets set3DMode's deferred instant goto (to POSITION_3D) settle
      // before we jump the camera again.
      this.attractTimer = window.setTimeout(() => this.attract3DPhase1(mpP, mpQ, placeQ), 150);
    },

    // "That image is real — it lives HERE": instant camera jump to P's marker.
    attract3DPhase1(mpP: MarkerPoint, mpQ: MarkerPoint, placeQ: Place): void {
      if (!this.attractMode) { return; }
      const ctl = WWTControl.singleton;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rc = (ctl as any).renderContext;
      const params = this.markerCamParams(mpP);
      if (rc && params) {
        gotoTargetFullHacked(
          ctl, false, true, params,
          rc.get_foregroundImageset(), rc.get_backgroundImageset(), 0,
        );
      }
      setMarkerHighlight({ xR: mpP.xR, yR: mpP.yR, zR: mpP.zR });
      this.showDescription = true; // set3DMode turned this off; P is still selectedPlace
      const ly = distanceLyForName(mpP.place.get_name());
      this.attractCaption = ly !== null
        ? `That image is real — it lives here, ${formatLy(ly)} from Earth`
        : "That image is real — it lives right here";

      this.attractTimer = window.setTimeout(
        () => this.attract3DPhase2(mpQ, placeQ), KIOSK_ATTRACT_3D_HOLD_MS,
      );
    },

    // Pull back to the Milky Way overview: "every ring is a real image".
    attract3DPhase2(mpQ: MarkerPoint, placeQ: Place): void {
      if (!this.attractMode) { return; }
      this.flyToOverview3D();
      this.attractCaption = "Every ring is a real Webb image, placed at its true distance. Touch one to explore.";

      this.attractTimer = window.setTimeout(
        () => this.attract3DPhase3(mpQ, placeQ),
        KIOSK_ATTRACT_3D_FLYOUT_S * 1000 + KIOSK_ATTRACT_3D_OVERVIEW_DWELL_MS,
      );
    },

    // "Next stop: Q" — cinematic (guest-path) fly to Q's marker.
    attract3DPhase3(mpQ: MarkerPoint, placeQ: Place): void {
      if (!this.attractMode) { return; }
      this.onSelectMarker(mpQ);
      this.attractCaption = `Next stop: ${placeQ.get_name()}`;

      this.attractTimer = window.setTimeout(
        () => this.attract3DPhase4(placeQ), KIOSK_ATTRACT_3D_NEXT_HOLD_MS,
      );
    },

    // Reveal: drop back to 2D on Q (existing "View in 2D" path — set2DMode's
    // deferred 10 ms timer runs the full cinematic onSelectPlace slew), then
    // resume the normal attract cadence once its slew duration is known.
    attract3DPhase4(placeQ: Place): void {
      if (!this.attractMode) { return; }
      this.attractCaption = "";
      this.set2DMode(placeQ);

      // 100 ms so set2DMode's deferred (10 ms) onSelectPlace has run and
      // finalized this.lastSlewMs before we read it.
      this.attractTimer = window.setTimeout(() => {
        if (!this.attractMode) { return; }
        const stepMs = (this.lastSlewMs || KIOSK_ATTRACT_FALLBACK_STEP_MS) + KIOSK_ATTRACT_DWELL_MS;
        this.attractTimer = window.setTimeout(() => this.attractNext(), stepMs);
      }, 100);
    },

    stopAttract(): void {
      window.clearTimeout(this.attractTimer);
      this.attractMode = false;
      this.attractCaption = "";
      // Deliberately do NOT reset the view: the guest starts where the tour left them.
    },

    // Any genuine guest activity while attract is running stops the tour.
    onKioskActivity(): void {
      if (this.attractMode) { this.stopAttract(); }
      // Start a session on the first interaction after load OR after an attract
      // reset. Idempotent while a session is already open.
      statsSessionStart();
    },
  },
});
</script>

<style scoped lang="less">
/* Kiosk only: no text selection anywhere (guests double-tapping /
   long-pressing descriptive text shouldn't paint blue highlights). On the web,
   visitors can copy descriptions, credits and names (audit J12). user-select
   isn't inherited, but descendants' `auto` resolves to the parent's used value,
   so this one rule covers every panel including child components. */
#main-content.kiosk {
  user-select: none;
  -webkit-user-select: none;
}

/* Kiosk layout: height of the top thumbnail strip (gallery header + filter
   chips + one row of 7.5rem thumbs). Everything that sits below the strip
   (controls, top bar, attract caption) offsets from this. This value is only
   the first-paint estimate; a ResizeObserver keeps it measured (J7). */
#main-content.kiosk {
  --kiosk-strip-h: 12.5rem;
}

/* Top-left controls */
.top-left-controls {
  position: absolute;
  top: 1rem;
  left: 1rem;
  z-index: 12;
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}

/* Kiosk: the thumbnail strip owns the top edge, so the control cluster drops
   just below it. */
.kiosk .top-left-controls {
  top: calc(var(--kiosk-strip-h) + 0.6rem);
}

.control-btn {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 8px;
  background: rgba(4, 6, 24, 0.82);
  backdrop-filter: blur(6px);
  border: 1px solid var(--accent-color);
  color: var(--accent-color);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  transition: box-shadow 150ms ease, color 150ms ease;

  &:hover {
    color: var(--accent-color2);
    box-shadow: 0 0 8px var(--accent-color);
  }
}

/* Segmented 2D | 3D control (audit J13): the pressed half shows which view is
   active, so the button no longer reads as a status label. */
.mode-seg {
  display: flex;
  height: 2.5rem;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--accent-color);
  background: rgba(4, 6, 24, 0.82);
  backdrop-filter: blur(6px);
}
.mode-seg-btn {
  min-width: 2.6rem;
  padding: 0 0.6rem;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.75);
  font: inherit;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: background 150ms ease, color 150ms ease;

  & + & {
    border-left: 1px solid rgba(240, 171, 82, 0.5);
  }
  &:hover {
    color: #fff;
  }
  &.active {
    color: #140d02;
    background: var(--accent-color);
  }
  &:focus-visible {
    outline: 2px solid var(--accent-color2);
    outline-offset: -3px;
  }
}

/* Startup error card (audit E3). */
.boot-error {
  max-width: min(32rem, 88vw);
  padding: 1.5rem 1.75rem;
  text-align: center;
  background: rgba(4, 6, 24, 0.92);
  border: 1px solid var(--accent-color);
  border-radius: 12px;
  color: #eaeaea;
  font-size: 1rem;
  line-height: 1.45;

  .boot-error-title {
    color: var(--accent-color);
    font-size: 1.25rem;
    margin: 0 0 0.6rem;
  }
  .boot-auto {
    margin-top: 0.75rem;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.75);
  }
}
.boot-retry {
  margin-top: 1rem;
  padding: 0.55rem 1.4rem;
  border: none;
  border-radius: 8px;
  background: var(--accent-color);
  color: #140d02;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

/* Action buttons inside the description panel (View in 2D, Compare, Share). */
.desc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.desc-view2d {
  margin-top: 0.6rem;
  padding: 0.35rem 0.7rem;
  border-radius: 6px;
  border: 1px solid var(--accent-color2);
  background: rgba(153, 200, 255, 0.12);
  color: var(--accent-color2);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: box-shadow 150ms ease, background 150ms ease;
}
.desc-view2d:hover {
  background: rgba(153, 200, 255, 0.22);
  box-shadow: 0 0 8px var(--accent-color2);
}

/* 3D marker hover label: thumbnail + name, anchored just above-right of the dot. */
.marker-tip {
  position: absolute;
  transform: translate(12px, -50%);
  z-index: 50;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  max-width: 14rem;
  padding: 0.3rem 0.5rem 0.3rem 0.3rem;
  background: rgba(4, 6, 24, 0.92);
  backdrop-filter: blur(6px);
  border: 1px solid var(--accent-color);
  border-radius: 8px;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.6);
}
.marker-tip-thumb {
  width: 2.6rem;
  height: 2.6rem;
  object-fit: cover;
  border-radius: 5px;
  flex: 0 0 auto;
}
.marker-tip-name {
  color: #fff;
  font-size: 0.78rem;
  line-height: 1.2;
}
.marker-tip-hint {
  display: block;
  margin-top: 0.15rem;
  color: var(--accent-color2);
  font-size: 0.75rem;
}

.hamb-menu {
  display: none;
  position: absolute;
  top: 3rem;
  left: 0;
  margin: 0;
  padding: 0.4rem;
  list-style: none;
  width: 14rem;
  background: rgba(4, 6, 24, 0.92);
  backdrop-filter: blur(6px);
  border: 1px solid var(--accent-color);
  border-radius: 10px;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.6);
  max-height: calc(100vh - 4.5rem);
  max-height: calc(100dvh - 4.5rem);
  overflow-y: auto;

  &.show {
    display: block;
  }
}

.hamb-menu-item {
  background: none;
  border: none;
  width: 100%;
  text-align: left;
  font: inherit;
  padding: 0.5rem 0.6rem;
  border-radius: 6px;
  color: #eee;
  cursor: pointer;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;

  /* Leading glyph (font-awesome icon or WWT logo): fixed-width gutter so the
     labels line up. Scoped to the leading element so it never squishes the
     label text (e.g. the italic "INTUITIVE"). */
  > i,
  > .hamb-menu-logo {
    flex: 0 0 1.2rem;
    color: var(--accent-color);
    text-align: center;
  }

  .hamb-menu-logo {
    vertical-align: middle;
  }

  /* Label wraps all inline text so flex `gap` doesn't split it word-by-word. */
  .hamb-menu-label {
    em {
      font-style: italic;
    }
    sup {
      font-size: 0.7em;
    }
  }

  &:hover {
    background: rgba(240, 171, 82, 0.12);
    color: #fff;
  }

  /* On/off state for toggles (aria-pressed carries it for screen readers). */
  .menu-check {
    margin-left: auto;
    color: var(--accent-color);
    opacity: 0;
  }
  .menu-check.on {
    opacity: 1;
  }
}

/* Gallery */
.gallery-wrap {
  position: absolute;
  top: 1rem;
  right: 1rem;
  z-index: 11;
}

/* Kiosk: the gallery becomes an edge-to-edge strip along the top (the
   ImageGallery component flips to a horizontal row via its kiosk prop). */
.kiosk .gallery-wrap {
  top: 0;
  left: 0;
  right: 0;
}

/* Intro modal */
.intro-backdrop {
  position: absolute;
  inset: 0;
  // Above .marker-tip (z50), so a 3D hover tooltip can't render over the
  // intro dialog. Below #modal-loading (z100, common.less) — the loading
  // overlay must still cover the intro while startup assets stream in.
  z-index: 60;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.intro-modal {
  position: relative;
  max-width: min(640px, 92vw);
  max-height: 88vh;
  overflow-y: auto;
  /* The dialog container takes programmatic focus on open (tabindex="-1") —
     never show a ring on the container itself. */
  outline: none;
  background: rgba(4, 6, 24, 0.96);
  border: 2px solid var(--accent-color);
  border-radius: 18px;
  box-shadow: 0 0 30px rgba(0, 0, 0, 0.8);
  padding: 1.75rem 1.5rem 1.25rem;
  color: #eaeaea;
}

.intro-modal-close {
  position: absolute;
  top: 0.6rem;
  right: 0.9rem;
  background: none;
  border: none;
  color: var(--accent-color2);
  font-size: 1.4rem;
  cursor: pointer;
}

/* Splash logos: a bigger Rocket Center logo, then two attribution rows pairing
   each logo with its caption ("…CosmicDS toolkit" / "Powered by WWT") — matches
   the exo-sonification splash, and sidesteps having to size-match a bare sphere
   against the CosmicDS wordmark. */
.intro-modal-logos {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.9rem;
}

.intro-logo-ip {
  height: 80px;
  max-width: 85%;
  width: auto;
  object-fit: contain;
  margin-bottom: 0.25rem;
}

.intro-logo-row {
  display: flex;
  align-items: center;
  justify-content: center;
}

.intro-logo-attr {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #9bb8d8;
  font-size: 0.78rem;
  text-decoration: none;
  transition: color 0.2s;

  &:hover { color: #d0e8ff; }
}

.intro-logo-cds {
  height: 22px;
  width: auto;
  object-fit: contain;
}

.intro-logo-wwt {
  height: 22px;
  width: auto;
  object-fit: contain;
  filter: brightness(1.2);
}

.intro-title {
  text-align: center;
  font-size: 1.5rem;
  color: var(--accent-color);
  margin-bottom: 1rem;
  line-height: 1.2;
}

.intro-section-title {
  font-size: 1.1rem;
  color: var(--accent-color2);
  margin: 1rem 0 0.5rem;
}

.intro-body p {
  margin-bottom: 0.75rem;
  line-height: 1.5;
}

.intro-instructions {
  list-style: none;
  padding: 0;
  margin: 0;

  li {
    display: flex;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
    line-height: 1.4;
  }

  .intro-icon {
    flex: 0 0 1.4rem;
    color: var(--accent-color);
    text-align: center;
    padding-top: 0.15rem;
  }
}

.intro-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1.1rem;
}
.intro-action {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--accent-color);
  background: none;
  color: var(--accent-color);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;

  &.primary {
    background: var(--accent-color);
    color: #140d02;
  }
  &:hover {
    box-shadow: 0 0 8px var(--accent-color);
  }
}

.intro-credits {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 0.82rem;
  color: #bbb;
  text-align: center;
}

/* Survey menu — themed to match the gallery / hamburger menu panels */
.survey-menu {
  width: min(16rem, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: rgba(4, 6, 24, 0.92);
  backdrop-filter: blur(6px);
  border: 1px solid var(--accent-color);
  border-radius: 10px;
  padding: 0.4rem;
  pointer-events: auto;
}

.survey-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25rem 0.4rem 0.4rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 0.3rem;
}

.survey-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--accent-color);
  font-size: 0.9rem;
  font-weight: bold;

  i {
    color: var(--accent-color);
  }
}

.survey-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 40vh;
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
}

.survey-list::-webkit-scrollbar {
  width: 6px;
}
.survey-list::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.25);
  border-radius: 3px;
}

.survey-option {
  background: none;
  border: none;
  width: 100%;
  text-align: left;
  font: inherit;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  color: #eee;
  font-size: 0.85rem;
  cursor: pointer;

  .survey-check {
    width: 1rem;
    text-align: center;
    color: var(--accent-color);
    visibility: hidden;
  }

  &:hover {
    background: rgba(240, 171, 82, 0.12);
    color: #fff;
  }

  &.active {
    color: var(--accent-color);

    .survey-check {
      visibility: visible;
    }
  }
}

.survey-close {
  background: none;
  border: none;
  color: var(--accent-color2);
  cursor: pointer;
}

/* Description panel */
/* Bottom dock (see layoutDock): one flex column for the survey menu or the
   description panel, then the opacity or compare bar. Children shrink rather
   than overlap; the empty part of the dock lets clicks through to the sky. */
.bottom-dock {
  position: absolute;
  left: var(--dock-left, 1rem);
  right: var(--dock-right, 1rem);
  bottom: 0.75rem;
  z-index: 10;
  max-height: var(--dock-max-h, calc(100vh - 5rem));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  pointer-events: none;
}

.description-panel {
  position: relative;
  width: min(60ch, 100%);
  /* The description gets at most ~40% of the screen so the image stays in
     view; inside the dock it shrinks further when space is short. */
  max-height: 40vh;
  max-height: 40dvh;
  min-height: 0;
  flex: 0 1 auto;
  display: flex;
  flex-direction: column;
  background: rgba(4, 6, 24, 0.88);
  backdrop-filter: blur(6px);
  border: 1px solid var(--accent-color);
  border-radius: 12px;
  padding: 0.75rem 1rem 0.9rem;
  color: #eaeaea;
  pointer-events: auto;
}

/* Only the description text scrolls; title, tour caption and actions stay put. */
.desc-body {
  flex: 1 1 auto;
  min-height: 2.5rem;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.desc-close {
  position: absolute;
  top: 0.4rem;
  right: 0.6rem;
  background: none;
  border: none;
  color: var(--accent-color2);
  cursor: pointer;
}

/* Title row: small thumbnail + title side by side (the thumb only shows in 3D,
   where the main view isn't the image itself). */
.desc-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.4rem;
}

/* Clickable (gentle "View in 2D" jump) — glow affordance on hover. */
.desc-thumb-btn {
  flex: 0 0 auto;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 6px;

  &:focus-visible {
    outline: 2px solid var(--accent-color2);
    outline-offset: 2px;
  }
}
.desc-thumb {
  display: block;
  flex: 0 0 auto;
  width: 3rem;
  height: 3rem;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--accent-color);
  cursor: pointer;
  transition: box-shadow 120ms ease;

  &:hover {
    box-shadow: 0 0 8px var(--accent-color);
  }
}

.desc-title {
  color: var(--accent-color);
  font-size: 1.05rem;
  margin: 0 1.5rem 0 0;
}

/* P3.4: prev/next chevrons flanking the title. Borderless icon buttons in the
   secondary theme color, gold on hover, visible ring on :focus-visible only. */
.desc-step {
  flex: 0 0 auto;
  background: none;
  border: none;
  color: var(--accent-color2);
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  padding: 0.2rem 0.35rem;
  transition: color 120ms ease;

  &:hover {
    color: var(--accent-color);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-color2);
    outline-offset: 1px;
    border-radius: 4px;
  }
}

/* Push the next chevron to the right end of the header row and keep it clear of
   the absolute-positioned .desc-close X (which sits at right: 0.6rem). */
.desc-step-next {
  margin-left: auto;
  margin-right: 1.4rem;
}

.desc-distance {
  font-size: 0.78rem;
  color: var(--accent-color2);
  margin: -0.15rem 0 0.45rem;
}

.desc-text {
  font-size: 0.85rem;
  line-height: 1.45;
  margin-bottom: 0.5rem;
}

.desc-credits {
  font-size: 0.78rem;
  color: #bbb;
}

/* Kiosk: a tighter info box — the exhibit screen is portrait, so the full
   60ch/32vh panel crowded the view (and used to overlap the right-hand
   gallery before it moved to the top strip). Text sizes stay as-is for
   readability; the panel still scrolls internally when a description is long. */
.kiosk .description-panel {
  width: min(48ch, 100%);
  max-height: 24vh;
}

.desc-learn {
  margin-left: 0.5rem;
  white-space: nowrap;
}

/* Guided tour strip (audit J8), at the top of the description panel. */
.tour-strip {
  margin: -0.15rem 1.5rem 0.6rem 0;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.tour-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}
.tour-label {
  color: var(--accent-color2);
  font-size: 0.8rem;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.tour-exit {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.8);
  font: inherit;
  font-size: 0.78rem;
  text-decoration: underline;
  cursor: pointer;
}
.tour-caption {
  margin: 0.4rem 0 0.5rem;
  font-size: 0.95rem;
  line-height: 1.4;
  color: #fff;
}
.tour-nav {
  display: flex;
  gap: 0.5rem;
}
.tour-btn {
  padding: 0.35rem 0.8rem;
  border-radius: 6px;
  border: 1px solid var(--accent-color);
  background: none;
  color: var(--accent-color);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;

  &.primary {
    background: var(--accent-color);
    color: #140d02;
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}

/* Compare bar (audit J9): sits where the crossfade bar does. */
.compare-bar {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.6rem;
  width: min(52rem, 100%);
  background: rgba(4, 6, 24, 0.88);
  backdrop-filter: blur(6px);
  border: 1px solid var(--accent-color2);
  border-radius: 999px;
  padding: 0.35rem 0.6rem 0.35rem 1rem;
  pointer-events: auto;
}
.compare-name {
  flex: 0 1 12rem;
  min-width: 0;
  color: #fff;
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.compare-select {
  flex: 1 1 10rem;
  min-width: 0;
  padding: 0.25rem 0.4rem;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(4, 6, 24, 0.95);
  color: #fff;
  font: inherit;
  font-size: 0.8rem;
}
.compare-icon-btn {
  flex: 0 0 auto;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: none;
  color: var(--accent-color2);
  cursor: pointer;

  &:hover {
    color: #fff;
    border-color: var(--accent-color2);
  }
}

/* Kiosk staff warning (audit J2): small, bottom-right, unmissable for staff. */
.kiosk-staff-warning {
  position: absolute;
  right: 0.8rem;
  bottom: 0.6rem;
  z-index: 30;
  padding: 0.35rem 0.7rem;
  border-radius: 6px;
  background: #5a1d00;
  border: 1px solid #ff9e4a;
  color: #ffd9b8;
  font-size: 0.8rem;
  pointer-events: none;
}

/* Crossfade slider */
.crossfade-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: min(36rem, 100%);
  background: rgba(4, 6, 24, 0.82);
  backdrop-filter: blur(6px);
  border: 1px solid var(--accent-color);
  border-radius: 999px;
  padding: 0.4rem 1rem;
  pointer-events: auto;
}

.crossfade-text {
  color: var(--accent-color2);
  font-size: 0.82rem;
  white-space: nowrap;
}

.opacity-range {
  flex: 1;
  accent-color: var(--accent-color);
  cursor: pointer;
}

/* Bottom-left logos */
.bottom-logos {
  position: absolute;
  bottom: 0.6rem;
  left: 0.8rem;
  z-index: 8;
  display: flex;
  align-items: center;
  gap: 0.4rem;

  img {
    height: 30px;
    width: auto;
    vertical-align: middle;
  }
}

/* Kiosk top-center bar: fixed just below the thumbnail strip, holding the
   "take it home" pill and (in 3D) the View-in-2D control. */
.kiosk-top-bar {
  position: absolute;
  top: calc(var(--kiosk-strip-h, 0rem) + 0.6rem);
  left: 50%;
  transform: translateX(-50%);
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

/* Kiosk "take it home" pill — lives in the top-center bar. Matches the
   .control-btn look (dark fill, gold border/text). Kiosk-only. */
.kiosk-home-btn {
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  background: rgba(4, 6, 24, 0.88);
  backdrop-filter: blur(6px);
  border: 1px solid var(--accent-color);
  color: var(--accent-color);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  transition: box-shadow 150ms ease, color 150ms ease;
}
.kiosk-home-btn:hover {
  color: var(--accent-color2);
  box-shadow: 0 0 8px var(--accent-color);
}

/* "View in 2D" inside the kiosk top bar: same look as the description-panel
   version, but sized to sit flush beside the take-home pill. */
.kiosk-view2d {
  margin-top: 0;
  padding: 0.45rem 0.85rem;
  font-size: 0.85rem;
}

/* Attract-mode "Touch to explore" hint — pulsing, screen-center (the most
   obvious spot on the exhibit; it never coexists with a guest interaction,
   so it can't obstruct anything being used), non-interactive. */
.kiosk-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 20;
  padding: 0.55rem 1.2rem;
  border-radius: 999px;
  background: rgba(4, 6, 24, 0.88);
  backdrop-filter: blur(6px);
  border: 1px solid var(--accent-color);
  color: var(--accent-color);
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  box-shadow: 0 0 8px var(--accent-color);
}
@media (prefers-reduced-motion: no-preference) {
  .kiosk-hint {
    animation: kiosk-pulse 2.4s ease-in-out infinite;
  }
}
@keyframes kiosk-pulse {
  0%, 100% { opacity: 0.65; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 1; transform: translate(-50%, -50%) scale(1.05); }
}

/* Attract-loop 3D interlude caption — dark pill, top-center just below the
   kiosk top bar (attract only ever runs in kiosk mode, so the strip-height
   var is always defined; the 1.2rem fallback covers a stray non-kiosk render). */
.kiosk-3d-caption {
  position: absolute;
  top: calc(var(--kiosk-strip-h, 1.2rem) + 3.3rem);
  left: 50%;
  transform: translateX(-50%);
  max-width: min(60ch, 80vw);
  text-align: center;
  pointer-events: none;
  z-index: 20;
  padding: 0.55rem 1.1rem;
  border-radius: 999px;
  background: rgba(4, 6, 24, 0.88);
  backdrop-filter: blur(6px);
  border: 1px solid var(--accent-color);
  color: var(--accent-color);
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  box-shadow: 0 0 8px var(--accent-color);
}
@media (prefers-reduced-motion: no-preference) {
  .kiosk-3d-caption {
    animation: kiosk-caption-in 400ms ease-out;
  }
}
@keyframes kiosk-caption-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@media (max-width: 600px) {
  .kiosk-3d-caption {
    font-size: 0.8rem;
  }
}

/* Transitions */
@media (prefers-reduced-motion: no-preference) {
  .intro-fade-enter-active,
  .intro-fade-leave-active {
    transition: opacity 0.25s ease;
  }
}
.intro-fade-enter-from,
.intro-fade-leave-to {
  opacity: 0;
}

@media (max-width: 600px) {
  .gallery-wrap {
    top: 0.5rem;
    right: 0.5rem;
  }

  /* Keep the gallery on top (z 11) but shrink the info box so it stays clear of
     it. The gallery is also height-capped on mobile (see ImageGallery.vue) so
     it no longer runs down over the bottom panels. */
  .description-panel {
    max-height: none;
    padding: 0.6rem 0.8rem 0.7rem;
  }
  .desc-title {
    font-size: 0.98rem;
  }
  .desc-text {
    font-size: 0.8rem;
  }
  .compare-bar {
    border-radius: 14px;
    padding: 0.5rem 0.75rem;
  }
  .compare-name {
    display: none;
  }
}

/* Landscape phones and other short screens (audit J7). These are wider than
   the 600px breakpoint, so they used to get the desktop layout, where the
   gallery, the description panel and the slider overlapped. Here the gallery
   becomes a narrow right-hand rail (ImageGallery.vue) and the panel and
   sliders sit to its left. */
@media (max-height: 500px) and (orientation: landscape) {
  .top-left-controls {
    top: 0.5rem;
    left: 0.5rem;
  }
  .gallery-wrap {
    top: 0.5rem;
    right: 0.5rem;
  }
  /* Short screens: keep most of the height for the image itself. */
  .description-panel {
    max-height: 52dvh;
    padding: 0.5rem 0.8rem 0.6rem;
  }
  .tour-caption {
    font-size: 0.85rem;
  }
}

/* The corner logos sit under the dock's bars until the screen is wide enough
   for the dock to stay clear of them (the intro still credits CosmicDS/WWT). */
@media (max-width: 1000px) {
  .bottom-logos {
    display: none;
  }
}
</style>
