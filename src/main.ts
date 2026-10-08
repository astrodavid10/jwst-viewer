import { createApp, defineAsyncComponent } from "vue";

import JwstViewer from "./jwst-viewer.vue";
import ImageGallery from "./ImageGallery.vue";
import TransitionExpand from "./TransitionExpand.vue";
import { tip as tipDirective } from "./tooltip";
import { boolParam } from "./urlParams";
import "./assets/common.less";

import vuetify from "../plugins/vuetify";

import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

import { WWTComponent, wwtPinia } from "@wwtelescope/engine-pinia";

import { library } from "@fortawesome/fontawesome-svg-core";
import {
  faBookOpen,
  faTimes,
  faChevronDown,
  faChevronUp,
  faChevronLeft,
  faChevronRight,
  faGear,
  faAdjust,
  faStar,
  faInfoCircle,
  faExpand,
  faCompress,
  faSlidersH,
  faRocket,
  faGlobe,
  // Object-type badge / filter-chip icons (see src/jwstTypes.ts).
  faStarOfLife,
  faCompactDisc,
  faCloud,
  faCircleDot,
  faBurst,
  faBraille,
  faHurricane,
  faCircleNodes,
  faLayerGroup,
  faBolt,
  faTableCells,
  faFilter,
  faRing,
  faArrowsAlt,
  faCheck,
  faImage,
  faMagnifyingGlass,
  // Menu, tour, compare and share controls (one icon per action).
  faRoute,
  faPanorama,
  faVectorSquare,
  faBuildingColumns,
  faSatellite,
  faArrowUpRightFromSquare,
  faTableColumns,
  faShareNodes,
  faRightLeft,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";

// Canonical public URL of the deployed site, set at build time
// (VUE_APP_PUBLIC_URL in .env.production.local or the CI environment). The
// kiosk's take-home QR encodes it; when it's empty the QR falls back to the
// current URL, which is wrong for a kiosk served from localhost or a LAN, and
// kiosk mode shows a staff warning (audit J2).
const PUBLIC_URL = process.env.VUE_APP_PUBLIC_URL ?? "";

// ?kioskStats=1 → mount the standalone usage-stats panel instead of the WWT
// viewer (no engine/pinia/vuetify/FontAwesome boot needed). See kioskStats.ts.
// Loaded as a separate chunk so ordinary visitors never download it (J23).
if (boolParam("kioskStats")) {
  createApp(defineAsyncComponent(() => import("./KioskStatsPanel.vue"))).mount("#app");
} else {
  library.add(
    faBookOpen, faTimes, faChevronDown, faChevronUp, faChevronLeft, faChevronRight,
    faGear, faAdjust, faStar, faInfoCircle, faExpand, faCompress, faSlidersH, faRocket, faGlobe,
    faStarOfLife, faCompactDisc, faCloud, faCircleDot, faBurst, faBraille, faHurricane,
    faCircleNodes, faLayerGroup, faBolt, faTableCells, faFilter, faRing, faArrowsAlt, faCheck,
    faImage, faMagnifyingGlass,
    faRoute, faPanorama, faVectorSquare, faBuildingColumns, faSatellite, faArrowUpRightFromSquare,
    faTableColumns, faShareNodes, faRightLeft, faTriangleExclamation,
  );

  createApp(JwstViewer, {
    wwtNamespace: "wwt-jwst-viewer",
    // Bundled locally (served from /public). Swap to a remote catalog URL once published.
    wtml: "jwst.wtml",
    bgWtml: "https://data1.wwtassets.org/packages/2023/06_pas/BackgroundImagery_v2.wtml",
    bgName: "unWISE color, from W2 and W1 bands",
    introTitle: "Explore James Webb Space Telescope Imagery",
    // Image to open on (must match a Place/image name in jwst.wtml). Leave "" to
    // open on the first gallery image. The viewer parks zoomed out on this target
    // and flies in once the intro modal is dismissed. A ?image= link overrides it.
    startImage: "Star-forming region IC 348 (NIRCam image)",
    kioskMode: boolParam("kiosk"),
    kioskHomeUrl: PUBLIC_URL,
  })

    // Plugins
    .use(wwtPinia)
    .use(vuetify)

    // Themed replacement for native `title` tooltips (see src/tooltip.ts).
    .directive("tip", tipDirective)

    // Components
    .component("WorldWideTelescope", WWTComponent)
    .component("font-awesome-icon", FontAwesomeIcon)
    .component("transition-expand", TransitionExpand)
    .component("image-gallery", ImageGallery)

    // Mount
    .mount("#app");
}
