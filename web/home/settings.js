// Home settings: a sheet on the right. Up/Down picks a row, Left/Right (or OK) changes it, and
// every change applies at once so you can see it behind the sheet.
window.Settings = (function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const ROWS = [
    { section: "You" },
    { id: "name", label: "Your name", type: "text" },
    { id: "clock", label: "Clock", options: [[12, "12-hour"], [24, "24-hour"]] },
    { section: "Look" },
    { id: "backdrop", label: "Backdrop", options: Object.entries(Prefs.BACKDROPS).map(([k, v]) => [k, v.name]), swatch: true },
    { id: "night", label: "Night mode", options: [["auto", "Darker after 7 pm"], ["off", "Off"]] },
    { section: "Top banner" },
    { id: "banner", label: "Shows", options: [["mix", "Picks + new releases"], ["foryou", "Picks for you"], ["new", "New releases"]] },
    { id: "rotate", label: "Changes every", options: [[6, "6 seconds"], [8, "8 seconds"], [15, "15 seconds"], [0, "Never"]] },
    { section: "Screensaver" },
    { id: "saver", label: "Style", options: [["film", "Film art"], ["clock", "Clock"], ["backdrop", "Backdrop"], ["off", "Off"]] },
    { id: "saverAfter", label: "Starts after", options: [[1, "1 minute"], [5, "5 minutes"], [10, "10 minutes"], [30, "30 minutes"]] },
    { id: "preview", label: "Preview screensaver", type: "action" },
    { section: "Home" },
    { id: "arrange", label: "Rearrange apps", type: "action" },
    { id: "library", label: "Add or remove apps", type: "action" },
    { id: "tvsettings", label: "TV settings", type: "action" },
    { id: "reset", label: "Reset Home to default", type: "action", danger: true },
  ];

  let ctx = null, focused = null, open = false, confirmReset = false;

  function valueHtml(row) {
    if (row.type === "text") return `<input value="${esc(Prefs.get(row.id))}" maxlength="20" spellcheck="false">`;
    if (row.type === "action") return row.id === "reset" && confirmReset ? "Press OK again" : "›";
    const v = Prefs.get(row.id);
    const opt = row.options.find((o) => o[0] === v) || row.options[0];
    const sw = row.swatch ? `<span class="swatch ${opt[0]}"></span>` : "";
    return `<span class="chev">‹</span>${sw}${esc(opt[1])}<span class="chev">›</span>`;
  }

  function render() {
    const list = $("sheet-list");
    list.innerHTML = ROWS.map((r) => r.section
      ? `<div class="s-section">${r.section}</div>`
      : `<button class="srow${r.danger ? " danger" : ""}" data-id="${r.id}"><span class="lbl">${r.label}</span><span class="val">${valueHtml(r)}</span></button>`
    ).join("");
    list.querySelectorAll("input").forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "Enter") commitName(input.value);
          input.blur();
          refreshRow("name");
        }
      });
      input.addEventListener("blur", () => commitName(input.value));
    });
  }

  function commitName(v) {
    const name = v.trim();
    if (name !== Prefs.get("name")) { Prefs.set("name", name); ctx.apply("name"); }
  }

  function refreshRow(id) {
    const el = $("sheet-list").querySelector(`.srow[data-id="${id}"] .val`);
    const row = ROWS.find((r) => r.id === id);
    if (el && row.type !== "text") el.innerHTML = valueHtml(row);
  }

  function setFocus(el) {
    if (focused) focused.classList.remove("focus");
    focused = el;
    if (!el) return;
    el.classList.add("focus");
    el.scrollIntoView({ block: "nearest" });
    if (confirmReset && el.dataset.id !== "reset") { confirmReset = false; refreshRow("reset"); }
  }

  function cycle(step) {
    const row = ROWS.find((r) => r.id === focused.dataset.id);
    if (!row.options) return false;
    const i = row.options.findIndex((o) => o[0] === Prefs.get(row.id));
    const next = row.options[(i + step + row.options.length) % row.options.length][0];
    Prefs.set(row.id, next);
    refreshRow(row.id);
    ctx.apply(row.id);
    return true;
  }

  function activate() {
    const id = focused.dataset.id;
    const row = ROWS.find((r) => r.id === id);
    if (row.type === "text") { const input = focused.querySelector("input"); input.focus(); input.select(); return; }
    if (row.options) return cycle(1);
    if (id === "reset") {
      if (!confirmReset) { confirmReset = true; refreshRow("reset"); return; }
      confirmReset = false;
      Prefs.reset();
      render();
      setFocus($("sheet-list").querySelector(`.srow[data-id="reset"]`));
      ctx.apply("all");
      ctx.toast("Home is back to how it started");
      return;
    }
    api.close();
    ctx.action(id);
  }

  const api = {
    get open() { return open; },
    show(context) {
      ctx = context;
      open = true;
      confirmReset = false;
      $("sheet").hidden = false;
      render();
      setFocus($("sheet-list").querySelector(".srow"));
    },
    close() {
      open = false;
      setFocus(null);
      $("sheet").hidden = true;
      ctx.closed();
    },
    // Returns true when the sheet used the key.
    key(k) {
      if (!open) return false;
      const rows = [...$("sheet-list").querySelectorAll(".srow")];
      const i = rows.indexOf(focused);
      if (k === "up" && i > 0) setFocus(rows[i - 1]);
      else if (k === "down" && i < rows.length - 1) setFocus(rows[i + 1]);
      else if (k === "left") cycle(-1);
      else if (k === "right") cycle(1);
      else if (k === "ok") activate();
      else if (k === "back") api.close();
      return true;
    },
    click(el) {
      setFocus(el);
      activate();
    },
  };
  return api;
})();
