// ============================================================
// legend_edit.js
// Logique pure de presentation/edition de legende (sans DOM).
// Charge dans le webview (self.LegendEdit) et sous Node (require).
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.LegendEdit = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LINE_DASHES = [
    { label: "plein", value: "solid" },
    { label: "tirets", value: "dash" },
    { label: "points", value: "dot" },
    { label: "tiret-point", value: "dashdot" }
  ];
  const MARKER_SYMBOLS = [
    { label: "aucun", value: "" },
    { label: "cercle", value: "circle" },
    { label: "carre", value: "square" },
    { label: "triangle", value: "triangle-up" },
    { label: "losange", value: "diamond" },
    { label: "croix", value: "x" }
  ];
  const BASE_COLORS = [
    { label: "bleu", value: "#1f77b4" },
    { label: "orange", value: "#ff7f0e" },
    { label: "vert", value: "#2ca02c" },
    { label: "rouge", value: "#d62728" },
    { label: "violet", value: "#9467bd" },
    { label: "brun", value: "#8c564b" },
    { label: "rose", value: "#e377c2" },
    { label: "gris", value: "#7f7f7f" },
    { label: "olive", value: "#bcbd22" },
    { label: "cyan", value: "#17becf" }
  ];

  const PALETTES = [
    { label: "Matplotlib", value: "tab10", colors: BASE_COLORS.map(function(c){ return c.value; }) },
    { label: "Colorblind", value: "okabe", colors: ["#0072b2", "#e69f00", "#009e73", "#d55e00", "#cc79a7", "#56b4e9", "#f0e442", "#000000"] },
    { label: "Viridis", value: "viridis", colors: ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"] },
    { label: "Plasma", value: "plasma", colors: ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"] },
    { label: "Cividis", value: "cividis", colors: ["#00204c", "#123570", "#3b496c", "#575d6d", "#707173", "#8a8678", "#a59c74", "#c3b369", "#e1cc55", "#ffe945"] },
    { label: "Gris", value: "gray", colors: ["#111111", "#333333", "#555555", "#777777", "#999999", "#bbbbbb", "#dddddd"] }
  ];

  function paletteColors(name) {
    const key = String(name || "tab10");
    const found = PALETTES.filter(function(p){ return p.value === key; })[0] || PALETTES[0];
    return found.colors.slice();
  }

  function toHexColor(color, fallback) {
    const fb = fallback || "#1f77b4";
    const raw = String(color || "").trim().toLowerCase();
    let m = /^#([0-9a-f]{6})$/.exec(raw);
    if (m) { return "#" + m[1]; }
    m = /^#([0-9a-f]{3})$/.exec(raw);
    if (m) {
      return "#" + m[1].split("").map(function(ch){ return ch + ch; }).join("");
    }
    m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(raw);
    if (m) {
      return "#" + [m[1], m[2], m[3]].map(function(part){
        const n = Math.max(0, Math.min(255, Number(part) || 0));
        return n.toString(16).padStart(2, "0");
      }).join("");
    }
    return fb;
  }

  function hexToRgba(color, alpha) {
    const hex = toHexColor(color, "#1f77b4");
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function rgbToHsv(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === rn) { h = ((gn - bn) / d) % 6; }
      else if (max === gn) { h = (bn - rn) / d + 2; }
      else { h = (rn - gn) / d + 4; }
      h *= 60;
      if (h < 0) { h += 360; }
    }
    const s = max === 0 ? 0 : d / max;
    return { h: h, s: s, v: max };
  }

  function hsvToRgb(h, s, v) {
    const hh = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs((hh / 60) % 2 - 1));
    const m = v - c;
    let r1 = 0, g1 = 0, b1 = 0;
    if (hh < 60) { r1 = c; g1 = x; }
    else if (hh < 120) { r1 = x; g1 = c; }
    else if (hh < 180) { g1 = c; b1 = x; }
    else if (hh < 240) { g1 = x; b1 = c; }
    else if (hh < 300) { r1 = x; b1 = c; }
    else { r1 = c; b1 = x; }
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255)
    };
  }

  function hsvToHex(h, s, v) {
    const c = hsvToRgb(h, s, v);
    return "#" + [c.r, c.g, c.b].map(function (n) {
      return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
    }).join("");
  }

  function hexToHsv(hex) {
    const h = toHexColor(hex, "#1f77b4");
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    return rgbToHsv(r, g, b);
  }

  function compareLegendPrefix(title, fallback) {
    const t = String(title == null ? "" : title).trim();
    if (!/[a-zA-Z0-9]/.test(t)) { return String(fallback || ""); }
    return t.length > 18 ? t.slice(0, 15) + "..." : t;
  }

  function readTrace(trace) {
    const t = trace || {};
    const line = t.line || {};
    const marker = t.marker || {};
    return {
      name: t.name != null ? String(t.name) : "",
      color: String(line.color || marker.color || ""),
      dash: line.dash || "solid",
      width: typeof line.width === "number" ? line.width : 2,
      symbol: marker.symbol || "",
      markerSize: typeof marker.size === "number" ? marker.size : 6
    };
  }

  function buildRestyle(values) {
    const v = values || {};
    const patch = {};
    if (typeof v.name === "string" && v.name.length) { patch.name = v.name; }
    if (v.color) {
      const color = toHexColor(v.color, v.color);
      patch["line.color"] = color;
      patch["marker.color"] = color;
      patch["fillcolor"] = hexToRgba(color, 0.25);
    }
    if (v.dash) { patch["line.dash"] = v.dash; }
    if (isFinite(v.width) && Number(v.width) > 0) { patch["line.width"] = Number(v.width); }
    if (v.symbol !== undefined) { patch["marker.symbol"] = v.symbol; }
    if (isFinite(v.markerSize) && Number(v.markerSize) > 0) { patch["marker.size"] = Number(v.markerSize); }
    return patch;
  }

  function applyPatch(trace, patch) {
    if (!trace || !patch) { return trace; }
    Object.keys(patch).forEach(function (key) {
      const parts = key.split(".");
      let target = trace;
      for (let i = 0; i < parts.length - 1; i++) {
        if (target[parts[i]] == null || typeof target[parts[i]] !== "object") {
          target[parts[i]] = {};
        }
        target = target[parts[i]];
      }
      target[parts[parts.length - 1]] = patch[key];
    });
    return trace;
  }

  return {
    LINE_DASHES: LINE_DASHES,
    MARKER_SYMBOLS: MARKER_SYMBOLS,
    BASE_COLORS: BASE_COLORS,
    PALETTES: PALETTES,
    paletteColors: paletteColors,
    toHexColor: toHexColor,
    rgbToHsv: rgbToHsv,
    hsvToRgb: hsvToRgb,
    hsvToHex: hsvToHex,
    hexToHsv: hexToHsv,
    compareLegendPrefix: compareLegendPrefix,
    readTrace: readTrace,
    buildRestyle: buildRestyle,
    applyPatch: applyPatch
  };
});
