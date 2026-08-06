const apiBaseInput = document.getElementById("api-base");
const templateSelect = document.getElementById("template");
const status = document.getElementById("status");

// Compact: a one-page ATS-safe layout. The right default for a resume being
// fired at an application without being reviewed first.
const DEFAULT_TEMPLATE = "compact_onepage";

const builtInDefault = (typeof MOMENTUM_DEFAULT_API_BASE !== "undefined" && MOMENTUM_DEFAULT_API_BASE)
  || "http://localhost:8000";

async function load() {
  const { apiBase, templateId } = await chrome.storage.local.get(["apiBase", "templateId"]);
  apiBaseInput.placeholder = builtInDefault;
  if (apiBase) apiBaseInput.value = apiBase;
  await loadTemplates(apiBase || builtInDefault, templateId || DEFAULT_TEMPLATE);
}

// The list comes from the backend rather than being hardcoded, so templates
// added or removed there show up here without touching the extension.
async function loadTemplates(base, selected) {
  try {
    const res = await fetch(`${base}/api/resume-builder/templates`);
    if (!res.ok) throw new Error(String(res.status));
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) return;
    templateSelect.innerHTML = list.map(t =>
      `<option value="${t.id}">${t.name}${t.id === DEFAULT_TEMPLATE ? " (default)" : ""}</option>`).join("");
  } catch {
    // Backend unreachable — keep the single hardcoded Compact option so the
    // setting still works offline rather than showing an empty dropdown.
  }
  templateSelect.value = selected;
  if (!templateSelect.value) templateSelect.value = DEFAULT_TEMPLATE;
}

document.getElementById("save-btn").addEventListener("click", async () => {
  let value = apiBaseInput.value.trim().replace(/\/+$/, "");

  await chrome.storage.local.set({ templateId: templateSelect.value || DEFAULT_TEMPLATE });

  if (!value) {
    // Blank is valid: it means "use the built-in default" (localhost, or
    // whatever MOMENTUM_API_BASE was set to in .env when this was built).
    await chrome.storage.local.remove(["apiBase"]);
    status.textContent = `Saved — using the default (${builtInDefault}).`;
    status.className = "status ok";
    return;
  }
  if (!/^https?:\/\//.test(value)) {
    status.textContent = "URL must start with http:// or https://";
    status.className = "status err";
    return;
  }
  await chrome.storage.local.set({ apiBase: value });
  status.textContent = "Saved. Reopen the extension popup to use it.";
  status.className = "status ok";
});

load();
