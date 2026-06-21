import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from _mpl_to_plotly import convert_figure, convert_figure_with_reason


class ConvertBaseTests(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def test_simple_line_one_scatter_trace(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1, 2], [3, 4, 5])
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        self.assertEqual(len(spec["data"]), 1)
        self.assertEqual(spec["data"][0]["type"], "scatter")
        self.assertEqual(spec["data"][0]["mode"], "lines")

    def test_log_scale(self):
        fig, ax = plt.subplots()
        ax.plot([1, 10, 100], [1, 2, 3])
        ax.set_xscale("log")
        spec = convert_figure(fig)
        self.assertEqual(spec["layout"]["xaxis"]["type"], "log")

    def test_bar_orientation(self):
        fig, ax = plt.subplots()
        ax.barh(["a", "b"], [1, 2])
        spec = convert_figure(fig)
        bars = [t for t in spec["data"] if t["type"] == "bar"]
        self.assertTrue(bars and bars[0]["orientation"] == "h")

    def test_fill_between_becomes_filled_scatter(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1, 2], [0, 1, 0])
        ax.fill_between([0, 1, 2], [0, 1, 0], alpha=0.25, label="area")
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        fills = [t for t in spec["data"] if t.get("fill") == "toself"]
        self.assertTrue(fills)
        self.assertEqual(fills[0]["name"], "area")

    def test_errorbar_becomes_plotly_error_y(self):
        fig, ax = plt.subplots()
        ax.errorbar([0, 1, 2], [1, 2, 1], yerr=[0.1, 0.2, 0.3], fmt="o", label="measure")
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        trace = spec["data"][0]
        self.assertIn("error_y", trace)
        self.assertEqual(trace["name"], "measure")
        for actual, expected in zip(trace["error_y"]["array"], [0.1, 0.2, 0.3]):
            self.assertAlmostEqual(actual, expected)

    def test_boxplot_patch_artist_keeps_filled_boxes(self):
        fig, ax = plt.subplots()
        ax.boxplot([np.arange(5), np.arange(5) + 1], patch_artist=True)
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        fills = [t for t in spec["data"] if t.get("fill") == "toself"]
        self.assertGreaterEqual(len(fills), 2)

    def test_text_and_annotate_become_plotly_annotations(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1], [0, 1])
        ax.text(0.5, 0.5, "note")
        ax.annotate("peak", xy=(1, 1), xytext=(0.7, 0.9), arrowprops={"arrowstyle": "->"})
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        annotations = {a["text"]: a for a in spec["layout"]["annotations"]}
        self.assertIn("note", annotations)
        self.assertIn("peak", annotations)
        self.assertTrue(annotations["peak"]["showarrow"])

    def test_two_subplots_two_axis_pairs(self):
        fig, (ax1, ax2) = plt.subplots(1, 2)
        ax1.plot([0, 1], [0, 1])
        ax2.plot([0, 1], [1, 0])
        spec = convert_figure(fig)
        self.assertIn("xaxis", spec["layout"])
        self.assertIn("xaxis2", spec["layout"])
        # non-régression twinx : aucun axe en overlay
        for key, val in spec["layout"].items():
            if key.startswith("yaxis"):
                self.assertNotIn("overlaying", val)


import datetime as _dt


class ConvertDateTests(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def test_date_axis_becomes_type_date(self):
        fig, ax = plt.subplots()
        days = [_dt.date(2024, 1, 1), _dt.date(2024, 1, 2), _dt.date(2024, 1, 3)]
        ax.plot(days, [1, 2, 3])
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        self.assertEqual(spec["layout"]["xaxis"]["type"], "date")
        # x converti en chaînes ISO (plus des datenums flottants)
        self.assertIsInstance(spec["data"][0]["x"][0], str)

    def test_bar_on_date_axis_width_in_ms(self):
        fig, ax = plt.subplots()
        days = [_dt.date(2024, 1, 1), _dt.date(2024, 1, 2), _dt.date(2024, 1, 3)]
        ax.bar(days, [1, 2, 3])
        spec = convert_figure(fig)
        self.assertEqual(spec["layout"]["xaxis"]["type"], "date")
        bar = [t for t in spec["data"] if t["type"] == "bar"][0]
        # largeur convertie en millisecondes (jours * 86.4M) -> >> 1
        self.assertTrue(all(w > 1e6 for w in bar["width"]))


class ConvertLegendTests(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def test_legend_lower_left(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1], [0, 1], label="serie")
        ax.legend(loc="lower left")
        spec = convert_figure(fig)
        leg = spec["layout"]["legend"]
        self.assertEqual(leg["xanchor"], "left")
        self.assertEqual(leg["yanchor"], "bottom")
        self.assertLess(leg["x"], 0.5)
        self.assertLess(leg["y"], 0.5)

    def test_legend_bbox_to_anchor_outside_axes(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1], [0, 1], label="serie")
        ax.legend(loc="upper left", bbox_to_anchor=(1.02, 1.0), borderaxespad=0)
        spec = convert_figure(fig)
        leg = spec["layout"]["legend"]
        self.assertEqual(leg["xanchor"], "left")
        self.assertEqual(leg["yanchor"], "top")
        self.assertGreater(leg["x"], spec["layout"]["xaxis"]["domain"][1])


class ConvertTwinxTests(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def test_twinx_overlay_single_x(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1, 2], [0, 1, 2])
        ax2 = ax.twinx()
        ax2.plot([0, 1, 2], [10, 5, 1])
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        # un seul axe X
        x_axes = [k for k in spec["layout"] if k.startswith("xaxis")]
        self.assertEqual(len(x_axes), 1)
        # un axe Y secondaire en overlay a droite
        self.assertEqual(spec["layout"]["yaxis2"]["overlaying"], "y")
        self.assertEqual(spec["layout"]["yaxis2"]["side"], "right")
        # les traces du twin pointent vers x principal et y2
        y2_traces = [t for t in spec["data"] if t.get("yaxis") == "y2"]
        self.assertTrue(y2_traces and all(t["xaxis"] == "x" for t in y2_traces))

    def test_twinx_secondary_legend_kept(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1], [0, 1], label="A")
        ax2 = ax.twinx()
        ax2.plot([0, 1], [2, 3], label="B")
        ax2.legend(loc="upper left")  # legende posee sur l'axe twin
        spec = convert_figure(fig)
        self.assertTrue(spec["layout"]["showlegend"])
        self.assertIn("legend", spec["layout"])


class ConvertTwinyTests(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def test_twiny_overlay_single_y(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1, 2], [0, 1, 2])
        ax2 = ax.twiny()
        ax2.plot([10, 20, 30], [0, 1, 2])
        ax2.text(20, 1, "top axis")
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        # deux axes X, mais un seul axe Y partage
        x_axes = [k for k in spec["layout"] if k.startswith("xaxis")]
        y_axes = [k for k in spec["layout"] if k.startswith("yaxis")]
        self.assertEqual(len(x_axes), 2)
        self.assertEqual(len(y_axes), 1)
        self.assertEqual(spec["layout"]["xaxis2"]["overlaying"], "x")
        self.assertEqual(spec["layout"]["xaxis2"]["side"], "top")
        x2_traces = [t for t in spec["data"] if t.get("xaxis") == "x2"]
        self.assertTrue(x2_traces and all(t["yaxis"] == "y" for t in x2_traces))
        annotations = {a["text"]: a for a in spec["layout"]["annotations"]}
        self.assertEqual(annotations["top axis"]["xref"], "x2")
        self.assertEqual(annotations["top axis"]["yref"], "y")


class ConvertContourQuiverPolarTests(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def _mesh(self):
        x = np.linspace(-2, 2, 18)
        y = np.linspace(-2, 2, 18)
        X, Y = np.meshgrid(x, y)
        Z = np.sin(X * Y)
        return X, Y, Z

    def test_contourf_becomes_filled_scatter(self):
        fig, ax = plt.subplots()
        X, Y, Z = self._mesh()
        ax.contourf(X, Y, Z, levels=5, cmap="viridis")
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        fills = [t for t in spec["data"] if t.get("fill") == "toself"]
        self.assertTrue(fills)
        self.assertTrue(all(t["type"] == "scatter" for t in fills))

    def test_contour_becomes_line_scatter(self):
        fig, ax = plt.subplots()
        X, Y, Z = self._mesh()
        ax.contour(X, Y, Z, levels=5, colors="black")
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        lines = [t for t in spec["data"] if t.get("mode") == "lines"]
        self.assertTrue(lines)
        self.assertTrue(all(t["type"] == "scatter" for t in lines))

    def test_quiver_becomes_filled_arrow_polygons(self):
        fig, ax = plt.subplots()
        X, Y, _Z = self._mesh()
        ax.quiver(X[::6, ::6], Y[::6, ::6], np.cos(X[::6, ::6]), np.sin(Y[::6, ::6]), color="red")
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        arrows = [t for t in spec["data"] if t.get("fill") == "toself"]
        self.assertTrue(arrows)
        self.assertTrue(all(t["type"] == "scatter" for t in arrows))

    def test_polar_line_and_scatter_become_scatterpolar(self):
        fig, ax = plt.subplots(subplot_kw={"projection": "polar"})
        theta = np.linspace(0, 2 * np.pi, 24)
        ax.plot(theta, 1 + 0.2 * np.sin(3 * theta), label="curve")
        ax.scatter(theta[::6], np.ones(4), c=np.arange(4))
        ax.legend(loc="upper right")
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        self.assertIn("polar", spec["layout"])
        self.assertTrue(all(t["type"] == "scatterpolar" for t in spec["data"]))
        self.assertTrue(all(t["subplot"] == "polar" for t in spec["data"]))
        self.assertTrue(spec["layout"]["showlegend"])


class ConvertReasonTests(unittest.TestCase):
    """Diagnostic de fallback : convert_figure_with_reason explique POURQUOI
    une figure n'est pas convertie en Plotly."""

    def tearDown(self):
        plt.close("all")

    def test_success_has_no_reason(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1, 2], [3, 4, 5])
        spec, reason = convert_figure_with_reason(fig)
        self.assertIsNotNone(spec)
        self.assertIsNone(reason)

    def test_no_axes_reason(self):
        fig = plt.figure()
        spec, reason = convert_figure_with_reason(fig)
        self.assertIsNone(spec)
        self.assertEqual(reason["code"], "no_axes")
        self.assertTrue(reason["message"])

    def test_unsupported_artist_names_the_artist(self):
        fig, ax = plt.subplots()
        x = np.linspace(-2, 2, 12)
        X, Y = np.meshgrid(x, x)
        ax.streamplot(x, x, X, Y)
        spec, reason = convert_figure_with_reason(fig)
        self.assertIsNone(spec)
        self.assertEqual(reason["code"], "unsupported_artist")
        # le nom de la classe matplotlib non geree apparait dans le detail
        self.assertTrue(reason["detail"])
        self.assertIn("Collection", reason["detail"])

    def test_too_many_points_reason(self):
        fig, ax = plt.subplots()
        n = 500001
        ax.plot(np.arange(n), np.arange(n))
        spec, reason = convert_figure_with_reason(fig)
        self.assertIsNone(spec)
        self.assertEqual(reason["code"], "too_many_points")

    def test_convert_figure_wrapper_returns_spec_only(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1], [0, 1])
        self.assertEqual(convert_figure(fig), convert_figure_with_reason(fig)[0])


class ConvertColorbarTests(unittest.TestCase):
    """#8 : la legende de champ (colorbar) doit porter son titre/unite."""

    def tearDown(self):
        plt.close("all")

    def test_imshow_colorbar_title(self):
        fig, ax = plt.subplots()
        im = ax.imshow([[1, 2], [3, 4]])
        fig.colorbar(im, label="Temp (K)")
        spec = convert_figure(fig)
        hm = [t for t in spec["data"] if t["type"] == "heatmap"][0]
        self.assertEqual(hm["colorbar"]["title"]["text"], "Temp (K)")

    def test_pcolormesh_colorbar_title(self):
        fig, ax = plt.subplots()
        qm = ax.pcolormesh(np.arange(16).reshape(4, 4).astype(float))
        fig.colorbar(qm, label="champ")
        spec = convert_figure(fig)
        hm = [t for t in spec["data"] if t["type"] == "heatmap"][0]
        self.assertEqual(hm["colorbar"]["title"]["text"], "champ")

    def test_scatter_colormap_colorbar_title(self):
        fig, ax = plt.subplots()
        sc = ax.scatter([0, 1, 2], [0, 1, 2], c=[1.0, 2.0, 3.0])
        fig.colorbar(sc, label="valeur")
        spec = convert_figure(fig)
        sct = [t for t in spec["data"] if t.get("mode") == "markers"][0]
        self.assertEqual(sct["marker"]["colorbar"]["title"]["text"], "valeur")

    def test_no_colorbar_no_title(self):
        fig, ax = plt.subplots()
        ax.imshow([[1, 2], [3, 4]])  # pas de fig.colorbar -> pas de titre
        spec = convert_figure(fig)
        hm = [t for t in spec["data"] if t["type"] == "heatmap"][0]
        self.assertNotIn("colorbar", hm)


if __name__ == "__main__":
    unittest.main()
