import { createApp } from "vue";

import JwstViewer from "./jwst-viewer.vue";
import KioskStatsPanel from "./KioskStatsPanel.vue";
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
} from "@fortawesome/free-solid-svg-icons";
// ?kioskStats=1 → mount the standalone usage-stats panel instead of the WWT
// viewer (no engine/pinia/vuetify/FontAwesome boot needed). See kioskStats.ts.
if (boolParam("kioskStats")) {
  createApp(KioskStatsPanel).mount("#app");
} else {
  library.add(faBookOpen);
  library.add(faTimes);
  library.add(faChevronDown);
  library.add(faChevronUp);
  library.add(faChevronLeft);
  library.add(faChevronRight);
  library.add(faGear);
  library.add(faAdjust);
  library.add(faStar);
  library.add(faInfoCircle);
  library.add(faExpand);
  library.add(faCompress);
  library.add(faSlidersH);
  library.add(faRocket);
  library.add(faGlobe);
  library.add(faStarOfLife);
  library.add(faCompactDisc);
  library.add(faCloud);
  library.add(faCircleDot);
  library.add(faBurst);
  library.add(faBraille);
  library.add(faHurricane);
  library.add(faCircleNodes);
  library.add(faLayerGroup);
  library.add(faBolt);
  library.add(faTableCells);
  library.add(faFilter);
  library.add(faRing);
  library.add(faArrowsAlt);
  library.add(faCheck);
  library.add(faImage);
  library.add(faMagnifyingGlass);

  createApp(JwstViewer, {
    wwtNamespace: "wwt-jwst-viewer",
    // Bundled locally (served from /public). Swap to a remote catalog URL once published.
    wtml: "jwst.wtml",
    bgWtml: "https://data1.wwtassets.org/packages/2023/06_pas/BackgroundImagery_v2.wtml",
    bgName: "unWISE color, from W2 and W1 bands",
    introTitle: "Explore James Webb Space Telescope Imagery",
    // Image to open on (must match a Place/image name in jwst.wtml). Leave "" to
    // open on the first gallery image. The viewer parks zoomed out on this target
    // and flies in once the intro modal is dismissed.
    startImage: "Centaurus A (MIRI + NIRCam image wide-field view)",
    kioskMode: boolParam("kiosk"),
    // Canonical public URL for the take-home QR code shown in kiosk mode. Leave
    // "" to derive from the current URL minus kiosk params — WRONG if the kiosk
    // loads from localhost/LAN, so set this before museum deployment!
    kioskHomeUrl: "",
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
