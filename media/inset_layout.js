// ============================================================
// inset_layout.js
// Placement du zoom-inset : generation de candidats, scoring,
// bornage. Fonctions pures (aucun acces Plotly/DOM, que des
// nombres en entree). Charge dans le webview (self.InsetLayout)
// et sous Node (require). Aucune dependance.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.InsetLayout = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- helpers geometriques purs ----
  function rectArea(rect) {
    if (!rect) { return 0; }
    return Math.max(0, rect.x1 - rect.x0) * Math.max(0, rect.y1 - rect.y0);
  }
  function rectOverlapArea(a, b) {
    if (!a || !b) { return 0; }
    const x = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
    const y = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    return x * y;
  }
  // Valeur de donnee -> coordonnee paper, via la plage complete et le domaine.
  function valueToPaper(value, fullRange, domain) {
    if (!fullRange || fullRange[0] === fullRange[1]) { return null; }
    const t = (value - fullRange[0]) / (fullRange[1] - fullRange[0]);
    return domain[0] + t * (domain[1] - domain[0]);
  }

  // ---- generation des candidats ----
  // Grille fine : `steps` positions par axe (coins inclus). cornerKind = nombre
  // de bords du domaine touches (2 = vrai coin, 1 = bord, 0 = interieur).
  function makeInsetCandidates(xDomain, yDomain, opts) {
    opts = opts || {};
    const sizes = opts.sizes || [0.34, 0.29, 0.24, 0.20];
    const steps = opts.steps || 6;
    const dx = Math.max(0.1, xDomain[1] - xDomain[0]);
    const dy = Math.max(0.1, yDomain[1] - yDomain[0]);
    const eps = Math.min(dx, dy) * 0.02;
    const candidates = [];
    const seen = {};
    sizes.forEach(function (scale, sizeIndex) {
      const w = dx * scale;
      const h = dy * scale;
      const xMax = xDomain[1] - w;
      const yMax = yDomain[1] - h;
      if (xMax < xDomain[0] - 1e-9 || yMax < yDomain[0] - 1e-9) { return; }
      for (let i = 0; i < steps; i++) {
        const tx = steps === 1 ? 0 : i / (steps - 1);
        const x0 = xDomain[0] + tx * (xMax - xDomain[0]);
        for (let j = 0; j < steps; j++) {
          const ty = steps === 1 ? 0 : j / (steps - 1);
          const y0 = yDomain[0] + ty * (yMax - yDomain[0]);
          const x1 = x0 + w;
          const y1 = y0 + h;
          const key = [x0, x1, y0, y1].map(function (v) { return v.toFixed(4); }).join(":");
          if (seen[key]) { continue; }
          seen[key] = true;
          const touchesX = (x0 - xDomain[0] <= eps) || (xDomain[1] - x1 <= eps);
          const touchesY = (y0 - yDomain[0] <= eps) || (yDomain[1] - y1 <= eps);
          candidates.push({
            xDomain: [x0, x1], yDomain: [y0, y1],
            x0: x0, x1: x1, y0: y0, y1: y1,
            outerXDomain: xDomain.slice(), outerYDomain: yDomain.slice(),
            sizeIndex: sizeIndex,
            cornerKind: (touchesX ? 1 : 0) + (touchesY ? 1 : 0)
          });
        }
      }
    });
    return candidates;
  }

  // ---- scoring (a minimiser) ----
  // Priorites decroissantes : selection (jamais couverte) > occupation des
  // donnees > recouvrement d'annotations > coin naturel > taille.
  function scoreInsetCandidate(candidate, ctx) {
    const candidateArea = Math.max(rectArea(candidate), 1e-4);
    let score = 0;

    // 1. recouvrement de la selection : redhibitoire
    if (ctx.selectedPaper) {
      score += (rectOverlapArea(candidate, ctx.selectedPaper) / candidateArea) * 9000;
    }

    // 2. occupation : fraction des points echantillonnes dans le candidat
    let total = 0, inside = 0;
    const traces = ctx.traces || [];
    for (let t = 0; t < traces.length; t++) {
      const xs = traces[t].x || [], ys = traces[t].y || [];
      const count = Math.min(xs.length, ys.length);
      if (count === 0) { continue; }
      const step = Math.max(1, Math.floor(count / 2200));
      for (let i = 0; i < count; i += step) {
        const xv = xs[i], yv = ys[i];
        if (xv == null || yv == null || isNaN(xv) || isNaN(yv)) { continue; }
        const px = valueToPaper(xv, ctx.xFull, candidate.outerXDomain);
        const py = valueToPaper(yv, ctx.yFull, candidate.outerYDomain);
        if (px == null || py == null) { continue; }
        total++;
        if (px >= candidate.x0 && px <= candidate.x1 && py >= candidate.y0 && py <= candidate.y1) { inside++; }
      }
    }
    const occupancy = total > 0 ? inside / total : 0;
    score += occupancy * 1000;

    // 3. recouvrement d'annotations
    const rects = ctx.annotationRects || [];
    for (let r = 0; r < rects.length; r++) {
      const overlap = rectOverlapArea(candidate, rects[r]);
      if (overlap > 0) { score += 120 + (overlap / candidateArea) * 500; }
    }

    // 4. coin naturel : bonus negatif (coin < bord < centre)
    score += (2 - candidate.cornerKind) * 2;

    // 5. taille : a occupation egale, prefere le plus grand
    score += candidate.sizeIndex * 3;

    return score;
  }

  // ---- choix du meilleur candidat ----
  function chooseInsetDomain(ctx) {
    const xDomain = ctx.xDomain || [0.08, 0.96];
    const yDomain = ctx.yDomain || [0.12, 0.94];
    const candidates = makeInsetCandidates(xDomain, yDomain, ctx.options);
    if (candidates.length === 0) { return { xDomain: [0.62, 0.96], yDomain: [0.60, 0.94] }; }
    let best = candidates[0];
    let bestScore = scoreInsetCandidate(best, ctx);
    for (let i = 1; i < candidates.length; i++) {
      const s = scoreInsetCandidate(candidates[i], ctx);
      if (s < bestScore) { best = candidates[i]; bestScore = s; }
    }
    return { xDomain: best.xDomain, yDomain: best.yDomain };
  }

  // ---- bornage d'un placement manuel (drag/resize) ----
  // Rectangle paper -> placement borne au domaine principal, taille mini imposee.
  function clampPlacement(rect, xDomain, yDomain, minSize) {
    const ms = minSize == null ? 0.12 : minSize;
    const outW = xDomain[1] - xDomain[0];
    const outH = yDomain[1] - yDomain[0];
    const w = Math.min(Math.max(rect.x1 - rect.x0, ms), outW);
    const h = Math.min(Math.max(rect.y1 - rect.y0, ms), outH);
    const x0 = Math.min(Math.max(rect.x0, xDomain[0]), xDomain[1] - w);
    const y0 = Math.min(Math.max(rect.y0, yDomain[0]), yDomain[1] - h);
    return { xDomain: [x0, x0 + w], yDomain: [y0, y0 + h] };
  }

  return {
    makeInsetCandidates: makeInsetCandidates,
    scoreInsetCandidate: scoreInsetCandidate,
    chooseInsetDomain: chooseInsetDomain,
    clampPlacement: clampPlacement
  };
});
