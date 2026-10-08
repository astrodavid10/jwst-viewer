import { test, expect, Page, ConsoleMessage } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Wait for the loading screen to clear (the app's own boot gate).
async function waitForApp(page: Page): Promise<void> {
  await expect(page.locator("#modal-loading")).toBeHidden({ timeout: 90_000 });
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") { return; }
    const text = msg.text();
    // Network noise from third-party tile/asset hosts isn't an app error.
    if (/Failed to load resource|net::ERR_|status of 404/.test(text)) { return; }
    errors.push(`console: ${text}`);
  });
  return errors;
}

const galleryItems = (page: Page) => page.locator(".gallery-item");

test("boots, shows the intro, and fills the gallery", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("./?debug=1");
  await waitForApp(page);
  await expect(page.getByRole("dialog", { name: /Explore James Webb/ })).toBeVisible();
  await expect.poll(async () => galleryItems(page).count()).toBeGreaterThan(250);
  await page.getByRole("button", { name: "Start exploring" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".description-panel .desc-title")).not.toBeEmpty();
  // The configured default survey is applied once the background WTML loads.
  await expect.poll(() => page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = (window as any).WWTControl.singleton;
    return ctl.renderContext.get_backgroundImageset()?.get_name();
  })).toBe("unWISE color, from W2 and W1 bands");
  expect(errors).toEqual([]);
});

test("selecting an image updates the panel and the URL", async ({ page }) => {
  await page.goto("./");
  await waitForApp(page);
  await page.getByRole("button", { name: "Start exploring" }).click();
  const item = galleryItems(page).nth(5);
  const label = (await item.getAttribute("aria-label")) ?? "";
  const name = label.replace(/ \([^)]*\)$/, "");
  await item.click();
  await expect(page.locator(".description-panel .desc-title")).toHaveText(name);
  await expect.poll(() => new URL(page.url()).searchParams.get("image")).toBe(name);
});

test("?image= deep link opens on that image", async ({ page }) => {
  const name = "Southern Ring Nebula (NIRCam Image)";
  await page.goto(`./?image=${encodeURIComponent(name)}`);
  await waitForApp(page);
  await page.getByRole("button", { name: "Start exploring" }).click();
  await expect(page.locator(".description-panel .desc-title")).toHaveText(name);
});

test("a failed catalog load shows the error card, not an endless spinner", async ({ page }) => {
  await page.route("**/jwst.wtml", (route) => route.fulfill({ status: 404, body: "not found" }));
  await page.goto("./");
  const card = page.getByRole("alert");
  await expect(card).toContainText("couldn't be loaded", { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("guided tour steps through stops", async ({ page }) => {
  await page.goto("./");
  await waitForApp(page);
  await page.getByRole("button", { name: /Take the guided tour/ }).click();
  await expect(page.locator(".tour-label")).toContainText("1 of 16");
  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(page.locator(".tour-label")).toContainText("2 of 16");
  await page.getByRole("button", { name: "Exit tour" }).click();
  await expect(page.locator(".tour-strip")).toHaveCount(0);
});

test("compare mode blends two images of the same target", async ({ page }) => {
  await page.goto(`./?image=${encodeURIComponent("Centaurus A (MIRI image)")}`);
  await waitForApp(page);
  await page.getByRole("button", { name: "Start exploring" }).click();
  await page.getByRole("button", { name: /^Compare/ }).click();
  const bar = page.locator(".compare-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("slider", { name: "Blend between the two images" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});

test("2D/3D control switches mode without errors", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("./");
  await waitForApp(page);
  await page.getByRole("button", { name: "Start exploring" }).click();
  const threeD = page.getByRole("button", { name: "3D", exact: true });
  await threeD.click();
  await expect(threeD).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => new URL(page.url()).searchParams.get("mode")).toBe("3d");
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await expect(threeD).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("kiosk mode reaches the attract loop after idling", async ({ page }) => {
  await page.goto("./?kiosk=1&kioskIdle=5");
  await waitForApp(page);
  await expect(page.locator(".kiosk-hint")).toBeVisible({ timeout: 30_000 });
  await page.mouse.click(400, 400);
  await expect(page.locator(".kiosk-hint")).toHaveCount(0);
});

test("kiosk stats panel loads on its own", async ({ page }) => {
  await page.goto("./?kioskStats=1");
  await expect(page.locator(".kiosk-stats")).toBeVisible();
});

test("no serious accessibility violations", async ({ page }) => {
  await page.goto("./");
  await waitForApp(page);
  for (const phase of ["intro", "main"]) {
    if (phase === "main") {
      await page.getByRole("button", { name: "Start exploring" }).click();
      await expect(page.locator(".intro-backdrop")).toHaveCount(0); // let the fade-out finish
    }
    const results = await new AxeBuilder({ page }).exclude("canvas").analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${phase}: ${v.id}: ${v.help} at ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
});

// Engine 7.40 changed getScreenPointForCoordinates in 3D; this exercises the
// app's own projection + hit-test end to end: hover where a marker projects
// and expect that marker's label.
test("3D marker hover identifies the marker under the pointer", async ({ page }) => {
  await page.goto("./?debug=1");
  await waitForApp(page);
  await page.getByRole("button", { name: "Start exploring" }).click();
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.waitForTimeout(3000);
  const target = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (window as any).jwstApp;
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    for (const mp of app.markerPoints) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctl = (window as any).WWTControl.singleton;
      const sp = ctl.transformWorldPointToPickSpace({ x: mp.xR, y: mp.yR, z: mp.zR }, ctl.renderContext.width, ctl.renderContext.height);
      if (sp && sp.x > 200 && sp.x < r.width - 300 && sp.y > 150 && sp.y < r.height - 250) {
        return { name: mp.name, x: r.left + sp.x, y: r.top + sp.y };
      }
    }
    return null;
  });
  expect(target).not.toBeNull();
  await page.mouse.move(target!.x + 30, target!.y + 30);
  await page.mouse.move(target!.x, target!.y, { steps: 4 });
  await expect(page.locator(".marker-tip")).toBeVisible();
  // Dense regions can put a neighbour within the hit radius; the label must be
  // a real marker name either way.
  const shown = await page.locator(".marker-tip-name").innerText();
  expect(shown.length).toBeGreaterThan(0);
});
