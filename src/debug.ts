// Console debug hooks (window.jwstApp, window.__gxSpriteInfo, …) are only
// installed when the page is opened with ?debug=1, so production visitors don't
// get the whole component and engine singleton exposed on `window`.
// The read-only window.__* tuning knobs still work without the flag; this only
// gates the hooks that *write* to window.
import { boolParam } from "./urlParams";

export const DEBUG = boolParam("debug");
