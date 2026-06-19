import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from _mpl_to_plotly import convert_figure


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

    def test_unsupported_fill_between_returns_none(self):
        fig, ax = plt.subplots()
        ax.fill_between([0, 1, 2], [0, 1, 0])
        self.assertIsNone(convert_figure(fig))

    def test_unsupported_text_returns_none(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1], [0, 1])
        ax.text(0.5, 0.5, "note")
        self.assertIsNone(convert_figure(fig))

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


if __name__ == "__main__":
    unittest.main()
