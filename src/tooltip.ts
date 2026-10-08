/**
 * `v-tip` — a themed replacement for the native `title` tooltip.
 *
 * Native `title` tooltips can't be styled and clash with the viewer's gold/dark
 * theme. This directive renders a small tooltip element appended to <body> (so
 * it's never clipped by an overflow:hidden container) styled to match the
 * gallery's hover tip, positioned below the host element (flipping above if it
 * would overflow). Usage: `v-tip="'Menu'"` or `v-tip="someComputedString"`.
 */
import { Directive, DirectiveBinding } from "vue";

/** True when hover tooltips should be suppressed: the primary input can't
 * hover (touch device) or the app is running as a museum kiosk. */
export function suppressHoverTips(): boolean {
  return window.matchMedia("(hover: none)").matches
    || document.body.classList.contains("kiosk-mode");
}

let tipEl: HTMLDivElement | null = null;

function removeTip(): void {
  if (tipEl) { tipEl.remove(); tipEl = null; }
}

function showTip(el: HTMLElement, text: string): void {
  if (suppressHoverTips()) { return; }
  if (!text) { return; }
  removeTip();
  const tip = document.createElement("div");
  tip.className = "jwst-ui-tip";
  tip.textContent = text;
  Object.assign(tip.style, {
    position: "fixed",
    zIndex: "10000",
    pointerEvents: "none",
    padding: "0.3rem 0.55rem",
    maxWidth: "16rem",
    background: "rgba(4, 6, 24, 0.95)",
    backdropFilter: "blur(6px)",
    border: "1px solid #f0ab52",
    borderRadius: "6px",
    boxShadow: "0 0 10px rgba(0, 0, 0, 0.6)",
    color: "#fff",
    fontSize: "0.78rem",
    lineHeight: "1.25",
    opacity: "0",
    transition: "opacity 120ms ease",
  });
  document.body.appendChild(tip);

  const r = el.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - tr.width - 4));
  let top = r.bottom + 8;
  if (top + tr.height + 4 > window.innerHeight) { top = r.top - tr.height - 8; }
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  requestAnimationFrame(() => { if (tipEl === tip) { tip.style.opacity = "1"; } });
  tipEl = tip;
}

// Per-element state (text + bound listeners), kept off the DOM node itself so we
// don't trip the no-leading-underscore lint rule on custom element properties.
interface TipState {
  text: string;
  enter: () => void;
  leave: () => void;
}
const states = new WeakMap<HTMLElement, TipState>();

function bind(el: HTMLElement, binding: DirectiveBinding<string>): void {
  const text = binding.value ?? "";
  const existing = states.get(el);
  if (existing) {
    existing.text = text;
    return;
  }
  const state: TipState = {
    text,
    enter: () => showTip(el, states.get(el)?.text ?? ""),
    leave: () => removeTip(),
  };
  states.set(el, state);
  el.addEventListener("mouseenter", state.enter);
  el.addEventListener("mouseleave", state.leave);
  el.addEventListener("focus", state.enter);
  el.addEventListener("blur", state.leave);
}

export const tip: Directive<HTMLElement, string> = {
  mounted: bind,
  updated: bind,
  beforeUnmount(el) {
    const state = states.get(el);
    if (state) {
      el.removeEventListener("mouseenter", state.enter);
      el.removeEventListener("mouseleave", state.leave);
      el.removeEventListener("focus", state.enter);
      el.removeEventListener("blur", state.leave);
      states.delete(el);
    }
    removeTip();
  },
};
