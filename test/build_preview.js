// Construit un test/preview_panel.html autonome a partir du vrai media/panel.html
// pour verifier visuellement le lecteur d'animation et la mise en page hors VS Code.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let html = fs.readFileSync(path.join(root, "media", "panel.html"), "utf8");

// 1) retirer la meta CSP (sinon nos scripts stub sans nonce sont bloques)
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "");
// 2) retirer le <script src plotly> (on fournit un stub Plotly)
html = html.replace(/<script src="\{\{plotlyUri\}\}"><\/script>/, "");
// 3) neutraliser les placeholders restants
html = html.replace(/\{\{nonce\}\}/g, "test").replace(/\{\{cspSource\}\}/g, "");

// 4) injecter un bootstrap : stub acquireVsCodeApi + Plotly + donnees d'exemple
const bootstrap = `
<script>
  // --- stub Plotly minimal (applique layout.height + enregistre les handlers) ---
  window.Plotly = {
    newPlot: function(el, data, layout){
      const h = (layout && layout.height) ? (layout.height + "px") : "300px";
      el.style.height = h;
      el._handlers = {};
      el.on = function(name, cb){ el._handlers[name] = cb; };
      el.innerHTML = "<div style='padding:8px;text-align:center;color:#555'>[Plotly stub — height=" + h + ", hovermode=" + (layout && layout.hovermode) + "]</div>";
    },
    relayout: function(el, upd){ if (upd && upd.height){ el.style.height = upd.height + "px";
      el.innerHTML = "<div style='padding:8px;text-align:center;color:#555'>[Plotly stub — height=" + upd.height + "px]</div>"; } },
    purge: function(){}, Plots: { resize: function(){} }
  };
  // --- frames d'animation generees au canvas ---
  function makeFrames(count){
    const out = [];
    for (let i = 0; i < count; i++){
      const c = document.createElement("canvas");
      c.width = 480; c.height = 300;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,c.width,c.height);
      ctx.strokeStyle = "#3060c0"; ctx.lineWidth = 2; ctx.beginPath();
      for (let x = 0; x < c.width; x++){
        const y = 150 + 110 * Math.sin((x/40) + i*0.4);
        if (x === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
      ctx.fillStyle = "#222"; ctx.font = "16px sans-serif";
      ctx.fillText("frame " + (i+1), 16, 26);
      out.push(c.toDataURL("image/png").split(",")[1]);
    }
    return out;
  }
  // --- stub de l'API VS Code ---
  window.acquireVsCodeApi = function(){
    return {
      postMessage: function(msg){
        if (msg.type === "ready"){
          const figs = [
            { id: 1, title: "Animation de demonstration", ts: "12:00:00",
              frames: makeFrames(24), interval: 80, plotly: null, pgf: null, svg: null, png: null },
            { id: 2, title: "Figure Plotly (statique)", ts: "12:00:05",
              plotly: { data: [{ type: "scatter", mode: "lines", x: [0, 1, 2], y: [0, 1, 4], name: "A" }],
                layout: { height: 384 }, width_in: 7, height_in: 4 },
              pgf: btoa("\\\\begin{pgfpicture}\\n\\\\end{pgfpicture}\\n"),
              svg: null, png: null, frames: null },
            { id: 3, title: "Figure Plotly B", ts: "12:00:09",
              plotly: { data: [{ type: "scatter", mode: "lines", x: [0, 1, 2], y: [0, 1.5, 2], name: "B" }],
                layout: { height: 384 }, width_in: 7, height_in: 4 },
              pgf: btoa("\\\\begin{pgfpicture}\\n\\\\end{pgfpicture}\\n"),
              svg: null, png: null, frames: null }
          ];
          setTimeout(function(){ window.postMessage({ type: "reset", figs: figs }, "*"); }, 0);
        } else {
          console.log("[postMessage]", JSON.stringify(msg));
        }
      }
    };
  };
</script>
`;
html = html.replace("</head>", bootstrap + "</head>");

fs.writeFileSync(path.join(__dirname, "preview_panel.html"), html, "utf8");
console.log("wrote test/preview_panel.html");
