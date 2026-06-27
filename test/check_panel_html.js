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
  "{{legendEditUri}}", "{{autoscaleUri}}", "{{dataImportUri}}", "{{boardLayoutUri}}",
  "{{curveDigitizeUri}}",
  "{{customPlotStylesJson}}",
];
const requiredIds = [
  "count", "searchInput", "selectionTools", "compareStatus", "compareSide", "compareStack",
  "fitToggle", "importCsv", "importImage", "pasteFig", "saveAll", "deleteAll", "list", "empty", "overlay", "ovTitle",
  "ovCoords", "ovClose", "ovBody", "compareOverlay", "compareTitle",
  "compareOpacityWrap", "compareOpacity", "compareClose", "errorToggle",
  "errorWarn", "errorPanel", "errorApply", "errorHide", "errorReset", "errorSummary", "compareBody",
  "keepSelToggle",
  "compareSave", "compareCopy", "compareCsv", "compareBundle",
  "publicationEditor", "pubPreset", "pubApply", "pubClose",
  "pubCreateBtn", "pubCreate", "pubCreateName", "pubCreateTitle", "pubCreateAxis",
  "pubCreateLegend", "pubCreateTick", "pubCreateLine", "pubCreateGrid", "pubCreateSave", "pubCreateCancel",
  "annotationEditor", "annText", "annTextColor", "annFontSize", "annBold", "annArrowColor",
  "annShowArrow", "annTextColors", "annArrowColors", "annApply", "annDelete", "annClose",
  "legendEditor", "leName", "leTextValue", "leFontSize", "leBold", "leItalic",
  "leColor", "leDash", "leWidth", "leSymbol", "leMarkerSize", "leBaseColors", "leAdvancedColors",
  "leSvSquare", "leHueStrip", "leHex", "leApply", "leClose", "leLegendSize", "leDeleteGuide",
  "insetConnectorEditor", "iceCorners", "iceColors", "iceLines", "iceClose",
  "boardBtn", "boardOverlay", "boardTitleInput", "boardRows", "boardCols",
  "boardWidth", "boardLegend", "boardOrder", "boardPreview", "boardHint",
  "boardClose", "boardCancel", "boardCompose",
  "digitizeImage", "digitizeOverlay", "digCalibXmin", "digCalibXmax",
  "digCalibYmin", "digCalibYmax", "digXlog", "digYlog", "digCurveList",
  "digManualBtn", "digOutFigure", "digOutCsv", "digOutCode", "digClose",
  "digBrushCanvas", "digBrushBtn", "digBrushSize", "digBrushExtract", "digBrushClear",
  "digCalibBtn", "digCalibRows", "digCalibStatus",
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
