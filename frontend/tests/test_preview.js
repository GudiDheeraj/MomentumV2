/**
 * The CV preview draws a page, every time.
 *
 * The reported bug: "on some situations resume is blank". The panel showed its
 * grey skeleton and stayed on it for ever, with no error and no spinner — the
 * one state that is indistinguishable from "still loading".
 *
 * The cause was a cached claim that outlived the thing it described.
 * rbRenderPdfPreview() skips the work when the payload-and-size key matches the
 * last one it drew, but that key is a module variable and #rbx-page is rebuilt
 * from scratch every time the builder is opened. So the second visit put the
 * skeleton back on screen while the key still said the page was drawn, and the
 * only code that would have redrawn it decided there was nothing to do.
 *
 * A second, quieter one: the Advert and CV-text tabs hide the stage, so a
 * redraw triggered while either was open measured a width of zero, clamped to
 * the 220px floor, and drew an A4 page at postage-stamp resolution.
 *
 * These are geometry-free checks — is there a canvas, and was it drawn at a
 * sensible size — so they survive redesigns of the panel around them.
 *
 * Needs the backend on :8000 and the frontend on :5173, and playwright:
 *   python3 -m uvicorn app.main:app --port 8000        (from backend/)
 *   python3 -m http.server 5173                        (from frontend/)
 *   node frontend/tests/test_preview.js
 */
const { chromium } = require("playwright");

const BASE = process.env.MT_WEB || "http://127.0.0.1:5173/index.html";
const API = process.env.MT_API || "http://127.0.0.1:8000";
const CHROME = process.env.MT_CHROME || undefined;
const JD = "Data Engineer. SQL, Azure, dbt, Airflow, Power BI, data pipelines, ETL.";

let failures = 0;
const say = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : "  — " + JSON.stringify(detail)}`);
};

// What the panel is actually showing, in the terms the bug was reported in.
const panel = () => {
  const host = document.getElementById("rbx-page");
  if (!host) return { host: false };
  const canvas = host.querySelector(".rbx-pdf-page");
  return {
    pages: host.querySelectorAll(".rbx-pdf-page").length,
    skeleton: !!host.querySelector(".rbx-pdf-placeholder"),
    error: !!host.querySelector(".rbx-pdf-error"),
    stillDimmed: host.classList.contains("is-rendering"),
    drawnAt: canvas ? canvas.width : 0,
  };
};

(async () => {
  const browser = await chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    args: ["--no-proxy-server", "--proxy-bypass-list=<-loopback>"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(String(e)));
  // env.js points at whatever the deployment uses; the tests talk to localhost.
  await page.route("**/env.js", async (route) => {
    const r = await route.fetch();
    await route.fulfill({
      status: 200, contentType: "application/javascript",
      body: (await r.text()).replace(/http:\/\/localhost:8000/g, API),
    });
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(async (api) => {
    const res = await fetch(api + "/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "demo@momentum.app", password: "demo123" }),
    });
    const d = await res.json();
    localStorage.setItem("momentum_token", d.access_token);
    localStorage.setItem("momentum_user", JSON.stringify(d.user));
  }, API);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);

  const openBuilder = async () => {
    await page.evaluate(() => document.querySelector('.nav-item[data-page="resumes"]')?.click());
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => /resume builder|build a resume|new resume/i.test(x.textContent || ""));
      b?.click();
    });
    await page.waitForTimeout(2500);
  };
  const leaveTo = async (nav) => {
    await page.evaluate((n) => document.querySelector(`.nav-item[data-page="${n}"]`)?.click(), nav);
    await page.waitForTimeout(900);
  };
  // A page is on screen: at least one canvas, no skeleton, and drawn big enough
  // to read rather than blown up from a thumbnail.
  const drew = async (label, wait = 2200) => {
    await page.waitForTimeout(wait);
    const p = await page.evaluate(panel);
    say(label, p.pages > 0 && !p.skeleton && p.drawnAt > 500, p);
    return p;
  };

  console.log("\n== it draws on the way in ==");
  await openBuilder();
  await drew("the first visit shows a page");

  console.log("\n== and on every visit after that ==");
  // This is the reported bug. Before the fix the panel showed a skeleton here
  // and never recovered, however long you waited.
  for (const [i, nav] of ["dashboard", "jobs", "applications"].entries()) {
    await leaveTo(nav);
    await openBuilder();
    await drew(`re-entry ${i + 1} (via ${nav}) shows a page`);
  }

  console.log("\n== and after a reload ==");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2600);
  if (!(await page.evaluate(panel)).host) await openBuilder();
  await drew("a reload lands on a page");

  console.log("\n== redrawing while the stage is hidden ==");
  await page.evaluate(() => rbSwitchTab("tailor"));
  await page.waitForTimeout(800);
  await page.evaluate((jd) => {
    const b = document.getElementById("rbx-jd");
    if (b) { b.value = jd; b.dispatchEvent(new Event("input", { bubbles: true })); }
  }, JD);
  await page.waitForTimeout(2000);
  await page.evaluate(() => { RB_TAILOR.docView = "advert"; rbRenderDocView(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const other = (rbState.templates || []).find((t) => t.id !== RESUME_BUILDER_STATE.templateId);
    if (other) RESUME_BUILDER_STATE.templateId = other.id;
    EDITOR.values.summary = (EDITOR.values.summary || "") + " Rendered out of sight.";
    rbRenderPreview(true);
  });
  await page.waitForTimeout(1800);
  const blind = await page.evaluate(panel);
  say("a hidden redraw still uses a readable size", blind.drawnAt > 500, blind);
  await page.evaluate(() => { RB_TAILOR.docView = "preview"; rbRenderDocView(); });
  await drew("and the page is there when the tab comes back");

  console.log("\n== the doc tabs can be cycled ==");
  for (let i = 0; i < 3; i++) {
    for (const d of ["advert", "cv", "preview"]) {
      await page.evaluate((v) => { RB_TAILOR.docView = v; rbRenderDocView(); }, d);
      await page.waitForTimeout(230);
    }
  }
  await drew("cycling CV / Advert / CV text leaves a page");

  console.log("\n== and the panel resized ==");
  await page.evaluate(() => {
    const g = document.getElementById("rbx-grip");
    if (!g) return;
    const r = g.getBoundingClientRect();
    g.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.left, clientY: r.top + 20, pointerId: 1 }));
    for (let x = 0; x < 12; x++)
      window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: r.left - x * 18, clientY: r.top + 20, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: r.left - 200, clientY: r.top + 20, pointerId: 1 }));
  });
  await drew("dragging the divider leaves a page");
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(900);
  await page.setViewportSize({ width: 1600, height: 950 });
  await drew("resizing the window leaves a page");

  console.log("\n== a render that fails says so ==");
  await page.route("**/api/resume-builder/preview", (r) => r.abort());
  await page.evaluate(() => { EDITOR.values.summary = "A render that cannot succeed."; rbRenderPreview(true); });
  await page.waitForTimeout(2200);
  const broken = await page.evaluate(panel);
  // Either the last good page stays or an error appears — never a skeleton that
  // looks like it is still working.
  say("a failure is not shown as a skeleton", !broken.skeleton && (broken.error || broken.pages > 0), broken);
  await page.unroute("**/api/resume-builder/preview");
  await page.evaluate(() => { EDITOR.values.summary = "And a render that can."; rbRenderPreview(true); });
  await drew("the next render recovers");

  console.log("\n== typing does not make the preview reload ==");
  // The preview follows every keystroke, which is the point of it. What it must
  // not do is *look* like it is following every keystroke. It used to: each
  // letter removed the page from the document and inserted a new one, and dimmed
  // the panel to 58% under a "Rendering…" pill while it did. Measured at an
  // ordinary typing speed, the page was rebuilt fourteen times for thirteen
  // characters and spent 2.6 of 6.6 seconds greyed out.
  //
  // So the two things counted here are the two visible ones: how often the
  // canvas on screen is thrown away, and how often the panel is dimmed. Both
  // should be nil while typing — the same canvas painted over, and no wait long
  // enough to be worth announcing.
  await page.evaluate(() => {
    window.__seen = { swaps: 0, dims: 0 };
    const host = document.getElementById("rbx-page");
    new MutationObserver((recs) => recs.forEach((r) => {
      if (r.type === "childList" && r.removedNodes.length) window.__seen.swaps++;
      if (r.type === "attributes" && host.classList.contains("is-rendering")) window.__seen.dims++;
    })).observe(host, { childList: true, attributes: true, attributeFilter: ["class"] });
    // An earlier check left the builder on the Tailor tab, where the edit pane
    // is display:none and nothing in it can be focused.
    rbSwitchTab("edit");
    rbState.open = "sec-profile";
    rbRenderSections();
  });
  await page.waitForTimeout(700);
  const focused = await page.evaluate(() => {
    const ta = document.querySelector('[data-f="summary"]');
    if (!ta) return false;
    ta.scrollIntoView({ block: "center" });
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    return document.activeElement === ta;
  });
  say("the summary field is ready to type into", focused);
  // 240ms a character: an ordinary speed, and slower than the render debounce,
  // so every letter really does start its own redraw.
  for (const c of "Typed slowly") {
    await page.keyboard.type(c);
    await page.waitForTimeout(240);
  }
  await page.waitForTimeout(1600);
  const typed = await page.evaluate(() => ({
    ...window.__seen,
    text: (EDITOR.values.summary || "").includes("Typed slowly"),
    pages: document.querySelectorAll(".rbx-pdf-page").length,
  }));
  say("the typing reached the résumé", typed.text, typed);
  say("the page was never thrown away and redrawn", typed.swaps === 0, typed);
  say("and never dimmed to announce a wait nobody can feel", typed.dims === 0, typed);
  say("the preview is still there afterwards", typed.pages > 0, typed);

  say("no page errors", crashes.length === 0, crashes.slice(0, 2));
  await ctx.close();
  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})();
