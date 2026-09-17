// ============================================================================
// Momentum — application autofill
// ============================================================================
// Fills a live application form from the profile stored in Momentum, then
// stops. It does not submit, and that is a design decision rather than an
// unfinished feature.
//
// An application form is a set of statements you are making: that you are
// authorised to work somewhere, that a visa claim is accurate, that everything
// entered is true. A script that submits those has made a declaration the
// person never saw. It also means defeating whatever bot detection sits on the
// page, and mass-submitted applications are the easiest thing in the world for
// a recruiter to spot and filter out.
//
// So: fill everything, highlight what was filled, flag what could not be, and
// leave the submit button to a human. Three seconds of review per application
// rather than three minutes of typing.

(function () {
  "use strict";

  const FILLED_STYLE = "2px solid #3D5AFE";
  const MISSED_STYLE = "2px dashed #E4A335";

  // Label text -> profile field. Matched loosely (lowercased substring), so
  // "Phone number*", "Mobile Phone" and "Telephone" all land on `phone`.
  // Order matters: the first match wins, so the more specific patterns for a
  // field must come before the general ones.
  const FIELD_MAP = [
    [["first name", "given name", "forename"], (p) => (p.full_name || "").split(/\s+/)[0]],
    [["last name", "surname", "family name"], (p) => (p.full_name || "").split(/\s+/).slice(1).join(" ")],
    [["full name", "your name", "name"], (p) => p.full_name],
    [["email"], (p) => p.email],
    [["phone", "mobile", "telephone", "contact number"], (p) => p.phone],
    [["linkedin"], (p) => p.linkedin],
    [["github"], (p) => p.github],
    [["portfolio", "personal website", "website", "blog"], (p) => p.website],
    [["city", "town", "current location", "where are you based"], (p) => p.city],
    [["country"], (p) => p.country],
    [["notice period", "how much notice"], (p) => p.notice_period],
    [["earliest start", "start date", "when can you start", "availability"], (p) => p.earliest_start],
    [["salary", "compensation expectation", "expected pay", "rate"],
      (p) => (p.salary_expectation ? `${p.salary_currency || ""}${p.salary_expectation}`.trim() : "")],
    [["current title", "current role", "job title", "current position"], (p) => p.current_title],
    [["current company", "current employer", "employer"], (p) => p.current_company],
    [["years of experience", "years experience", "how many years"],
      (p) => (p.years_experience != null ? String(p.years_experience) : "")],
    [["visa", "immigration status", "work permit"], (p) => p.visa_status],
    [["how did you hear", "where did you hear", "referral source", "source"], (p) => p.how_did_you_hear],
    [["preferred location", "locations"], (p) => p.preferred_locations],
  ];

  // Yes/no questions. Each returns true, false, or null for "don't touch it".
  // Sponsorship is the one everybody gets wrong, and it is asked both ways
  // round — "do you need sponsorship" and "are you authorised without
  // sponsorship" are opposite questions with the same answer underneath, so
  // each phrasing is matched separately rather than guessed at.
  const BOOLEAN_MAP = [
    [["require sponsorship", "need sponsorship", "require visa sponsorship",
      "will you now or in the future require"], (p) => p.needs_sponsorship],
    [["authorized to work", "authorised to work", "legally authorized",
      "right to work", "eligible to work"], (p) => p.right_to_work],
    [["willing to relocate", "open to relocation", "relocate"], (p) => p.willing_to_relocate],
  ];

  // CSS.escape is missing in some embedded browsers and test environments, and
  // an undefined escape silently produces the selector label[for="undefined"],
  // which matches nothing — so every field whose only label is a label[for]
  // pair goes unfilled with no error anywhere.
  // innerText is layout-dependent and is undefined outside a rendering
  // context; textContent always exists. Preferring innerText keeps the
  // visible-text semantics where they are available, without depending on them.
  function textOf(node) {
    if (!node) return "";
    return String(node.innerText || node.textContent || "");
  }

  function cssEscape(value) {
    if (typeof CSS !== "undefined" && CSS && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/([^\w-])/g, "\\$1");
  }

  // The text belonging to this control *alone* — not the question its group
  // asks. For a radio button that distinction is everything: the option says
  // "Yes", the fieldset says "Will you require sponsorship?", and matching the
  // option against the combined string makes every radio look like a "yes".
  function ownLabelFor(el) {
    const wrapper = el.closest("label");
    if (wrapper) {
      const clone = wrapper.cloneNode(true);
      clone.querySelectorAll("input, select, textarea").forEach(n => n.remove());
      const text = (clone.textContent || "").trim();
      if (text) return text.toLowerCase();
    }
    if (el.id) {
      const lab = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      const labText = textOf(lab).trim();
      if (labText) return labText.toLowerCase();
    }
    return String(el.getAttribute("aria-label") || el.value || "").toLowerCase().trim();
  }

  function labelTextFor(el) {
    // Five ways a form associates a label with a control, in the order they
    // are worth trusting. Frameworks like Greenhouse and Workday use different
    // ones, and aria-label is often the only thing present on a custom widget.
    const bits = [];
    if (el.id) {
      const lab = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (lab) bits.push(textOf(lab));
    }
    const wrapper = el.closest("label");
    if (wrapper) bits.push(textOf(wrapper));
    if (el.getAttribute("aria-label")) bits.push(el.getAttribute("aria-label"));
    if (el.getAttribute("placeholder")) bits.push(el.getAttribute("placeholder"));
    if (el.name) bits.push(el.name.replace(/[_\-\[\]]+/g, " "));
    const group = el.closest("fieldset, .field, .form-group, [class*='question']");
    if (group) {
      const legend = group.querySelector("legend, label, .label, h3, h4");
      if (legend) bits.push(textOf(legend));
    }
    return bits.join(" ").toLowerCase().replace(/\s+/g, " ").trim();
  }

  // React and Vue keep their own copy of an input's value, and setting
  // `el.value` directly updates the DOM without telling them — the field looks
  // filled and submits empty. Going through the native setter and then firing
  // the events they listen for is what makes the framework agree.
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillSelect(el, wanted) {
    const target = String(wanted).toLowerCase();
    const option = Array.from(el.options).find(o =>
      o.text.toLowerCase().trim() === target || o.value.toLowerCase() === target)
      || Array.from(el.options).find(o => o.text.toLowerCase().includes(target));
    if (!option) return false;
    el.value = option.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function fillBooleanControl(el, label, value) {
    const yesWords = ["yes", "true", "i am", "authorized", "authorised"];
    const noWords = ["no", "false", "not "];
    const want = value ? yesWords : noWords;
    if (el.tagName === "SELECT") {
      const option = Array.from(el.options).find(o =>
        want.some(w => o.text.toLowerCase().trim().startsWith(w)));
      if (!option) return false;
      el.value = option.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    if (el.type === "radio") {
      const own = ownLabelFor(el) || String(el.value || "").toLowerCase();
      const isYes = yesWords.some(w => own.startsWith(w));
      const isNo = noWords.some(w => own.startsWith(w));
      if ((value && isYes) || (!value && isNo)) { el.click(); return true; }
      return false;
    }
    return false;
  }

  function mark(el, ok) {
    el.style.outline = ok ? FILLED_STYLE : MISSED_STYLE;
    el.style.outlineOffset = "1px";
  }

  function autofill(profile) {
    const controls = Array.from(document.querySelectorAll(
      "input, textarea, select")).filter(el => {
      if (el.disabled || el.readOnly) return false;
      if (["hidden", "submit", "button", "image", "password"].includes(el.type)) return false;
      // A control that already has something in it was filled by the person
      // or by the site; overwriting it is how autofill loses someone's work.
      if (el.value && el.type !== "radio" && el.type !== "checkbox") return false;
      return el.offsetParent !== null;   // skip anything not actually visible
    });

    let filled = 0;
    const unfilled = [];
    const seen = new Set();
    const answeredGroups = new Set();
    const pending = [];

    for (const el of controls) {
      const label = labelTextFor(el);
      if (!label) continue;

      let done = false;

      for (const [patterns, get] of BOOLEAN_MAP) {
        if (!patterns.some(p => label.includes(p))) continue;
        const value = get(profile);
        if (value === null || value === undefined) break;
        done = fillBooleanControl(el, label, value);
        break;
      }

      if (!done && el.type !== "radio" && el.type !== "checkbox") {
        for (const [patterns, get] of FIELD_MAP) {
          if (!patterns.some(p => label.includes(p))) continue;
          const value = get(profile);
          if (!value) break;
          // One value per field: a page with "Name" in three places should
          // not get the same answer typed into a search box at the top.
          const key = patterns[0];
          if (seen.has(key)) break;
          if (el.tagName === "SELECT") done = fillSelect(el, value);
          else { setValue(el, String(value)); done = true; }
          if (done) seen.add(key);
          break;
        }
      }

      if (done) {
        filled++;
        mark(el, true);
        if (el.type === "radio" && el.name) answeredGroups.add(el.name);
      } else if (el.required || /\*/.test(label)) {
        pending.push({ el, label });
      }
    }

    // Flagging happens after every control has been visited, not during. A
    // radio group is answered by its *second* option as often as its first, so
    // judging "Yes" the moment it isn't picked reports a gap that "No" fills
    // half a millisecond later — and a warning list with false entries in it
    // is one people stop reading.
    for (const { el, label } of pending) {
      if (el.type === "radio" && el.name && answeredGroups.has(el.name)) continue;
      unfilled.push(label.slice(0, 60));
      mark(el, false);
    }

    return { filled, unfilled: unfilled.slice(0, 12), total: controls.length };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "MOMENTUM_AUTOFILL") {
      try {
        sendResponse(autofill(msg.profile || {}));
      } catch (e) {
        sendResponse({ error: String(e && e.message || e), filled: 0, unfilled: [] });
      }
      return true;
    }
    if (msg && msg.type === "MOMENTUM_AUTOFILL_PING") {
      sendResponse({ ok: true });
      return true;
    }
  });
})();
