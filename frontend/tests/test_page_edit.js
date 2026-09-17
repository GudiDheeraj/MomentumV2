/**
 * Editing the CV by clicking a line on the preview.
 *
 * The preview is a PDF painted onto a canvas, so the thing that makes it
 * clickable is a map: pdf.js's text layer, matched back to the string each run
 * of text was rendered from. These checks are about that map being *right*,
 * because a map that is subtly wrong is worse than no map at all — clicking the
 * job title and editing the second job's role would be a data-loss bug that
 * looks like a feature.
 *
 * Three traps in particular, all found while building it:
 *   - "Data Analyst" is the job title AND the role of the second entry AND two
 *     words in the middle of the summary. Only one of those is what you clicked.
 *   - "EXPERIENCE" is a heading the template drew. The résumé does not own it,
 *     so it must not be editable — but the word appears inside the summary, so
 *     a naive substring match hands the heading to the summary.
 *   - Long lines wrap, and the second half of a wrapped bullet has to lead back
 *     to the same bullet as the first half.
 *
 * Needs the backend on :8000 and the frontend on :5173, and playwright:
 *   node frontend/tests/test_page_edit.js
 */
const { chromium } = require("playwright");

const BASE = process.env.MT_WEB || "http://127.0.0.1:5173/index.html";
const API = process.env.MT_API || "http://127.0.0.1:8000";
const CHROME = process.env.MT_CHROME || undefined;

let failures = 0;
const say = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : "  — " + JSON.stringify(detail)}`);
};

// A résumé written to trip every one of those traps at once.
const VALUES = {
  full_name: "Dheeraj Gudi",
  title: "Data Analyst",
  email: "dheeraj@example.com",
  phone: "+44 7733 658594",
  location: "Newcastle Upon Tyne, England",
  // Deliberately longer than a line, so the wrap is exercised: the second half
  // of it has to lead back to the same line of the summary as the first half.
  summary: "- Data Analyst with four years of experience in reporting and operations management across two organisations, delivering dashboards for senior stakeholders and leading the data quality work behind them.\n- Skilled in SQL and Power BI.",
  skills: "Programming Languages: Python, SQL, R\nCloud and Data Platforms: AWS, Microsoft Azure",
  experience: [
    "Operations Delivery Manager | Department for Work and Pensions | Newcastle, UK | Aug 2025 - Present",
    "- Manage advanced Excel reporting and data visualisation for the team.",
    "- Lead a team of 12 to 15 specialist caseworkers handling complex cases across every region of Britain.",
    "---",
    "Data Analyst | Tata Consultancy Services | Bangalore, India | Jul 2021 - Oct 2023",
    "- Analysed financial datasets using SQL and Python across client portfolios.",
  ].join("\n"),
  education: "MSc, Data Science (Merit) | Durham University, Durham, UK | Sep 2023 - Jan 2025",
  projects: "Casework Forecasting Model: Built a weekly forecast in Python that cut manual planning time for three teams.",
  certifications: "Google Cloud Certified, Associate Cloud Engineer",
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
    localStorage.removeItem("momentum_rb_page_edit");
    localStorage.removeItem("momentum_rb_edit_tip");
  }, API);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  await page.evaluate(() => document.querySelector('.nav-item[data-page="resumes"]')?.click());
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /resume builder|build a resume|new resume/i.test(x.textContent || ""));
    b?.click();
  });
  await page.waitForTimeout(2400);
  await page.evaluate((v) => {
    Object.assign(EDITOR.values, v);
    ["publications", "custom_sections"].forEach((k) => { delete EDITOR.values[k]; });
    EDITOR.values.custom_sections = [];
    rbState.entries = null;
    rbRenderSections();
    rbRenderPreview(true);
  }, VALUES);
  await page.waitForTimeout(3000);

  // Every zone, and what it says it edits.
  const map = async () => page.evaluate(() => {
    const targets = rbEditTargets();
    const by = Object.fromEntries(targets.map((t) => [t.path, t.text]));
    return {
      zones: [...document.querySelectorAll(".rbx-hit")].map((h) => ({
        path: h.dataset.edit, text: by[h.dataset.edit],
        top: parseFloat(h.style.top), left: parseFloat(h.style.left), width: parseFloat(h.style.width),
      })),
      paths: targets.map((t) => t.path),
      texts: by,
    };
  });

  console.log("\n== the page is clickable ==");
  let m = await map();
  say("there are zones on the page", m.zones.length > 10, m.zones.length);
  say("the panel is in editing mode",
      await page.evaluate(() => !!document.querySelector(".rbx-right.rbx-editable")));
  say("the pencil reads as on",
      await page.evaluate(() => document.getElementById("rbx-rhead-edit")?.getAttribute("aria-pressed") === "true"));

  console.log("\n== everything editable has somewhere to click ==");
  const missing = m.paths.filter((p) => !m.zones.some((z) => z.path === p));
  say("no part of the résumé is unreachable", missing.length === 0,
      missing.map((p) => `${p} = ${m.texts[p]}`));

  console.log("\n== and nothing points at the wrong thing ==");
  const at = (path) => m.zones.filter((z) => z.path === path);
  const zoneNear = (top) => m.zones.filter((z) => Math.abs(z.top - top) < 0.9);
  // The name and the job title are two boxes on one line, in that order.
  const name = at("v|full_name")[0], role = at("v|title")[0];
  say("the name is on the page", !!name);
  say("the job title is beside it, not under it",
      !!role && !!name && Math.abs(role.top - name.top) < 0.6 && role.left > name.left,
      { name, role });
  // The trap: the second entry's role reads the same as the job title.
  const entryRole = at("e|experience|1|title")[0];
  say("the second entry's role is down in the entry, not up in the header",
      !!entryRole && !!name && entryRole.top > name.top + 10, { entryRole, name });
  // The other trap: a line whose words appear inside a longer line.
  const sum0 = at("l|summary|0");
  say("the summary's first line is claimed by the summary", sum0.length >= 1, sum0);
  say("and it covers the line rather than two words of it",
      sum0.some((z) => z.width > 50), sum0);
  say("the job title did not steal the summary",
      !role || Math.abs(role.top - (sum0[0] || {}).top) > 0.9, { role, sum0 });
  // Headings belong to the template. Nothing on the résumé should own them.
  const headings = await page.evaluate(() => {
    const targets = rbEditTargets();
    return ["summary", "experience", "education", "skills", "projects", "certifications"]
      .filter((w) => targets.some((t) => t.norm === w));
  });
  say("no section heading is mistaken for content", headings.length === 0, headings);

  console.log("\n== a wrapped line leads back to one string ==");
  const wrapped = m.zones.reduce((acc, z) => (acc[z.path] = (acc[z.path] || 0) + 1, acc), {});
  const multi = Object.entries(wrapped).filter(([, n]) => n > 1);
  say("a line that wraps is clickable on both halves", multi.length > 0, wrapped);
  say("and both halves lead to the same field",
      multi.every(([p]) => at(p).length === wrapped[p]));

  // A box per line is how it has to be drawn, but it is one sentence. Lighting
  // up only the half the pointer is inside says the other half belongs to
  // something else — which is the wrong thing to say about the line somebody is
  // deciding whether to rewrite.
  const wrapPath = (multi[0] || [])[0];
  say("there is a wrapped line to check", !!wrapPath, wrapped);
  if (wrapPath) {
    await page.locator(`.rbx-hit[data-edit="${wrapPath}"]`).first().hover();
    await page.waitForTimeout(350);
    const hot = await page.evaluate((p) => ({
      lit: document.querySelectorAll(`.rbx-hit[data-edit="${p}"].is-hot`).length,
      of: document.querySelectorAll(`.rbx-hit[data-edit="${p}"]`).length,
      strays: document.querySelectorAll(`.rbx-hit.is-hot:not([data-edit="${p}"])`).length,
    }), wrapPath);
    say("hovering lights up every line of it", hot.lit === hot.of && hot.of >= 2, hot);
    say("and nothing else", hot.strays === 0, hot);

    await page.locator(`.rbx-hit[data-edit="${wrapPath}"]`).first().click();
    await page.waitForTimeout(600);
    const ed = await page.evaluate((p) => {
      const hits = [...document.querySelectorAll(`.rbx-hit[data-edit="${p}"]`)];
      const box = document.querySelector(".rbx-pedit").getBoundingClientRect();
      const lines = hits.map((h) => h.getBoundingClientRect());
      return {
        marked: hits.filter((h) => h.classList.contains("is-editing")).length, of: hits.length,
        covers: lines.some((b) => box.top < b.bottom - 1 && box.bottom > b.top + 1),
      };
    }, wrapPath);
    say("opening it marks every line of it", ed.marked === ed.of && ed.of >= 2, ed);
    // Anchored under the last line rather than the first, so the editor is not
    // sitting on top of the words being edited.
    say("the editor clears the whole line, not just its first half", !ed.covers, ed);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    say("closing clears the highlight everywhere", await page.evaluate(() =>
      document.querySelectorAll(".rbx-hit.is-editing, .rbx-hit.is-hot").length) === 0);
  }

  console.log("\n== the parts of an entry heading are separate ==");
  ["title", "company", "location", "dates"].forEach((part) => {
    const z = at(`e|experience|0|${part}`)[0];
    say(`the ${part} has its own box`, !!z, part);
  });
  const heads = ["title", "company", "location", "dates"].map((p) => at(`e|experience|0|${p}`)[0]).filter(Boolean);
  say("they sit on one line, left to right",
      heads.length === 4 && heads.every((z) => Math.abs(z.top - heads[0].top) < 0.6)
      && heads.map((z) => z.left).join() !== [...heads.map((z) => z.left)].sort((a, b) => b - a).join(),
      heads);

  console.log("\n== editing a point changes the résumé ==");
  const NEW = "Rebuilt the management reporting pack in Power BI, cutting the monthly close by two days.";
  await page.locator('.rbx-hit[data-edit="b|experience|0|0"]').first().click();
  await page.waitForTimeout(500);
  say("an editor opens", await page.evaluate(() => !!document.querySelector(".rbx-pedit")));
  say("it says what is being edited",
      /employment history/i.test(await page.evaluate(() => document.querySelector(".rbx-pedit-what")?.textContent || "")));
  say("prefilled with the point as written, without its dash",
      await page.evaluate(() => document.querySelector(".rbx-pedit-ta").value) === "Manage advanced Excel reporting and data visualisation for the team.");
  await page.evaluate((t) => {
    const ta = document.querySelector(".rbx-pedit-ta");
    ta.value = t; ta.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".rbx-pedit-save").click();
  }, NEW);
  await page.waitForTimeout(2600);
  const after = await page.evaluate(() => ({
    exp: EDITOR.values.experience,
    dirty: !!EDITOR.dirty,
    inForm: [...document.querySelectorAll(".rbx-bullet-input")].map((i) => i.value),
    open: !!document.querySelector(".rbx-pedit"),
    zones: document.querySelectorAll(".rbx-hit").length,
  }));
  say("the point is rewritten", after.exp.includes("- " + NEW), after.exp.split("\n")[1]);
  say("its dash is kept", /^- /m.test(after.exp.split("\n")[1] || ""));
  say("the entry around it is untouched",
      after.exp.includes("Lead a team of 12 to 15") && after.exp.includes("Tata Consultancy Services"));
  say("the form on the left says the same thing", after.inForm.includes(NEW), after.inForm);
  say("the résumé is marked unsaved", after.dirty);
  say("the editor closed", !after.open);
  say("the page is still clickable afterwards", after.zones > 10, after.zones);

  console.log("\n== Esc leaves it alone ==");
  await page.locator('.rbx-hit[data-edit="v|title"]').first().click();
  await page.waitForTimeout(450);
  await page.evaluate(() => {
    const ta = document.querySelector(".rbx-pedit-ta");
    ta.value = "Something nobody asked for"; ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(900);
  say("the job title is as it was",
      await page.evaluate(() => EDITOR.values.title) === VALUES.title,
      await page.evaluate(() => EDITOR.values.title));
  say("and the editor is gone", await page.evaluate(() => !document.querySelector(".rbx-pedit")));

  console.log("\n== clicking away keeps the typing ==");
  await page.locator('.rbx-hit[data-edit="v|location"]').first().click();
  await page.waitForTimeout(450);
  await page.evaluate(() => {
    const ta = document.querySelector(".rbx-pedit-ta");
    ta.value = "Newcastle, United Kingdom"; ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.mouse.click(300, 700);
  await page.waitForTimeout(2400);
  say("the edit was kept", await page.evaluate(() => EDITOR.values.location) === "Newcastle, United Kingdom",
      await page.evaluate(() => EDITOR.values.location));

  console.log("\n== a section with no box in the form is still editable ==");
  // Certifications have no editor in the left-hand pane at all, so the page is
  // the only place they can be changed.
  const certZone = await page.evaluate(() =>
    !!document.querySelector('.rbx-hit[data-edit="l|certifications|0"]'));
  say("certifications can be clicked on the page", certZone);
  if (certZone) {
    await page.locator('.rbx-hit[data-edit="l|certifications|0"]').first().click();
    await page.waitForTimeout(450);
    await page.evaluate(() => {
      const ta = document.querySelector(".rbx-pedit-ta");
      ta.value = "Google Cloud Certified, Professional Data Engineer";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(".rbx-pedit-save").click();
    });
    await page.waitForTimeout(2400);
    say("and changed", await page.evaluate(() => EDITOR.values.certifications)
        === "Google Cloud Certified, Professional Data Engineer",
        await page.evaluate(() => EDITOR.values.certifications));
  }

  console.log("\n== the mode can be turned off ==");
  await page.evaluate(() => document.getElementById("rbx-rhead-edit").click());
  await page.waitForTimeout(500);
  say("the panel stops being editable",
      await page.evaluate(() => !document.querySelector(".rbx-right.rbx-editable")));
  say("the zones stop taking clicks", await page.evaluate(() => {
    const h = document.querySelector(".rbx-hit");
    return !h || getComputedStyle(h).pointerEvents === "none";
  }));
  say("and the choice is remembered",
      await page.evaluate(() => localStorage.getItem("momentum_rb_page_edit")) === "off");
  await page.evaluate(() => document.getElementById("rbx-rhead-edit").click());
  await page.waitForTimeout(500);
  say("turning it back on restores the zones",
      await page.evaluate(() => !!document.querySelector(".rbx-right.rbx-editable")
        && getComputedStyle(document.querySelector(".rbx-hit")).pointerEvents === "auto"));

  console.log("\n== the zones ride the layout ==");
  // Percentages of the sheet, so they must land on the text at any size.
  const spot = async () => page.evaluate(() => {
    const h = document.querySelector('.rbx-hit[data-edit="v|full_name"]');
    const c = document.querySelector(".rbx-pdf-page");
    if (!h || !c) return null;
    const a = h.getBoundingClientRect(), b = c.getBoundingClientRect();
    return { x: (a.left - b.left) / b.width, y: (a.top - b.top) / b.height, w: a.width / b.width };
  });
  const wide = await spot();
  await page.setViewportSize({ width: 1120, height: 900 });
  await page.waitForTimeout(2200);
  const narrow = await spot();
  say("a zone stays over its own words when the panel resizes",
      !!wide && !!narrow && Math.abs(wide.x - narrow.x) < 0.02
      && Math.abs(wide.y - narrow.y) < 0.02 && Math.abs(wide.w - narrow.w) < 0.02,
      { wide, narrow });

  console.log("\n== it survives the tabs on the right ==");
  // Advert and CV text hide the page entirely. Coming back has to bring the
  // zones back with it, not just the picture.
  await page.evaluate(() => rbSwitchTab("tailor"));
  await page.waitForTimeout(900);
  await page.evaluate(() => { RB_TAILOR.docView = "advert"; rbRenderDocView(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { RB_TAILOR.docView = "preview"; rbRenderDocView(); });
  await page.waitForTimeout(2400);
  const back = await page.evaluate(() => ({
    zones: document.querySelectorAll(".rbx-hit").length,
    editable: !!document.querySelector(".rbx-right.rbx-editable"),
  }));
  say("the zones come back with the page", back.zones > 10 && back.editable, back);
  await page.evaluate(() => rbSwitchTab("edit"));
  await page.waitForTimeout(1200);

  console.log("\n== and it holds up across the designs ==");
  // The map is built from the words, not from any template's structure, so it
  // has to survive a sidebar, a two-column, a timeline, a letter-spaced
  // heading, a design that prints skills as chips with the labels thrown away,
  // and one that prints the lead achievement twice. Those are the ones picked
  // here; MT_ALL_TEMPLATES=1 runs the whole catalogue.
  const SAMPLE = ["ats_plain", "twocolumn_sidebar", "modern_minimalist", "swiss_grid",
                  "creative_colorful", "timeline", "achievement_focused", "photo_sidebar",
                  "executive_twopage", "japan_rirekisho"];
  const all = await page.evaluate(() => (rbState.templates || []).map((t) => t.id));
  const sweep = process.env.MT_ALL_TEMPLATES ? all : all.filter((id) => SAMPLE.includes(id));
  if (!process.env.MT_ALL_TEMPLATES) {
    console.log(`    (${sweep.length} of ${all.length} designs — MT_ALL_TEMPLATES=1 for the rest)`);
  }
  await page.setViewportSize({ width: 1500, height: 950 });
  for (const id of sweep) {
    await page.evaluate((tid) => { RESUME_BUILDER_STATE.templateId = tid; rbRenderPreview(true); }, id);
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const targets = rbEditTargets();
      const zones = [...document.querySelectorAll(".rbx-hit")];
      const held = Object.fromEntries(targets.map((t) => [t.path, t.norm]));
      const flat = (s) => s.replace(/ /g, "");
      // The one that matters: a box must be over words the string it claims
      // actually contains. Designs are free to print the same line twice —
      // several do — so two boxes for one string is not a fault. A box over
      // words that string never held is.
      const wrong = zones.map((z) => {
        const t = held[z.dataset.edit], f = z.dataset.frag || "";
        if (t == null) return `${z.dataset.edit}: no such string`;
        if (!f || t.includes(f) || flat(t).includes(flat(f))) return null;
        return `${z.dataset.edit} sits over ${JSON.stringify(f.slice(0, 36))}`;
      }).filter(Boolean);
      const paths = new Set(zones.map((z) => z.dataset.edit));
      return { zones: zones.length, wrong,
               missing: targets.filter((t) => !paths.has(t.path)).map((t) => t.path),
               total: targets.length };
    });
    say(`${id}: nothing points at the wrong words`, r.wrong.length === 0, r.wrong);
    // japan_rirekisho prints neither a LinkedIn nor a website, so there is
    // nothing on its page to click for those two. Not printed is not missing.
    const allowed = id === "japan_rirekisho" ? 2 : 0;
    say(`${id}: everything printed can be clicked`, r.missing.length <= allowed,
        { missing: r.missing, of: r.total });
  }

  console.log("\n== and in the dark ==");
  // The builder's palette is declared on .rbx, so anything parented to the body
  // resolves every one of those variables to its light-mode fallback. The
  // editor did exactly that once: a white box in dark mode, with the app's own
  // dark rule for <textarea> still applying inside it — pale grey text on
  // white, which is unreadable rather than merely wrong.
  await page.evaluate(() => localStorage.setItem("momentum_theme", "dark"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  if (!(await page.evaluate(() => !!document.getElementById("rbx-page")))) {
    await page.evaluate(() => document.querySelector('.nav-item[data-page="resumes"]')?.click());
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => /resume builder|build a resume|new resume/i.test(x.textContent || ""));
      b?.click();
    });
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(1400);
  await page.locator(".rbx-hit").first().click();
  await page.waitForTimeout(600);
  const dark = await page.evaluate(() => {
    const pe = document.querySelector(".rbx-pedit");
    if (!pe) return null;
    const lum = (c) => {
      const [r, g, b] = (c.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const ta = pe.querySelector(".rbx-pedit-ta");
    return {
      inBuilder: !!pe.closest(".rbx"),
      panel: lum(getComputedStyle(pe).backgroundColor),
      field: lum(getComputedStyle(ta).backgroundColor),
      ink: lum(getComputedStyle(ta).color),
      onScreen: pe.getBoundingClientRect().width > 100,
    };
  });
  say("the editor is inside the builder, where the palette lives", !!dark && dark.inBuilder, dark);
  say("it is dark, not a white box", !!dark && dark.panel < 0.3 && dark.field < 0.3, dark);
  say("and the text in it can be read", !!dark && dark.ink - dark.field > 0.5, dark);
  say("it is still positioned over the page", !!dark && dark.onScreen, dark);

  say("no page errors", crashes.length === 0, crashes.slice(0, 2));
  await ctx.close();
  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})();
