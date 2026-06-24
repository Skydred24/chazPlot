// test/check_panel_html.js — garde-fou structurel du webview (sans navigateur).
// Verifie que media/panel.html conserve les placeholders substitues par
// extension.js et tous les id DOM utilises par le script. Aucune dependance.
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "media", "panel.html");
const html = fs.readFileSync(file, "utf8");

const placeholders = [
  "{{nonce}}", "{{cspSource}}", "{{plotlyUri}}",
  "{{errorMathUri}}", "{{insetLayoutUri}}", "{{plotNavUri}}",
  "{{measureMathUri}}", "{{csvExportUri}}", "{{compareUtilUri}}",
  "{{bundleMetaUri}}", "{{figureFilterUri}}", "{{pdfExportUri}}",
  "{{legendEditUri}}", "{{autoscaleUri}}", "{{customPlotStylesJson}}",
];
const requiredIds = [
  "count", "searchInput", "compareStatus", "compareSide", "compareStack",
  "fitToggle", "sortSelect", "pasteFig", "saveAll", "deleteAll", "list", "empty", "overlay", "ovTitle",
  "ovCoords", "ovClose", "ovBody", "compareOverlay", "compareTitle",
  "compareOpacityWrap", "compareOpacity", "compareClose", "errorToggle",
  "errorWarn", "errorPanel", "errorApply", "errorHide", "errorReset", "errorSummary", "compareBody",
  "keepSelToggle",
  "compareSave", "compareCopy", "compareCsv", "compareBundle",
  "publicationEditor", "pubPreset", "pubApply", "pubClose",
  "annotationEditor", "annText", "annTextColor", "annFontSize", "annBold", "annArrowColor",
  "annShowArrow", "annTextColors", "annArrowColors", "annApply", "annDelete", "annClose",
  "legendEditor", "leName", "leTextValue", "leFontSize", "leBold", "leItalic",
  "leColor", "leDash", "leWidth", "leSymbol", "leMarkerSize", "leBaseColors", "leAdvancedColors",
  "leSvSquare", "leHueStrip", "leHex", "leApply", "leClose",
];

const errors = [];
for (const p of placeholders) {
  if (!html.includes(p)) errors.push("placeholder manquant : " + p);
}
for (const id of requiredIds) {
  if (!new RegExp('id="' + id + '"').test(html)) {
    errors.push("id manquant : " + id);
  }
}
if (errors.length) {
  console.error("ECHEC check_panel_html:\n" + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log(
  "OK check_panel_html : " + placeholders.length + " placeholders, " +
  requiredIds.length + " ids."
);
