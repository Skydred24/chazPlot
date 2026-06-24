import os
import sys
import unittest

import matplotlib
matplotlib.use("Agg")
import matplotlib.colors as mcolors
import matplotlib.style as mstyle
from matplotlib import rcParams

STYLES_DIR = os.path.join(os.path.dirname(__file__), "..", "python", "styles")




class VendoredFilesTests(unittest.TestCase):
    def _load(self, name):
        path = os.path.join(STYLES_DIR, name + ".mplstyle")
        return mstyle.core._rc_params_in_file(path)

    def test_science_loads_key_params(self):
        params = self._load("science")
        self.assertEqual(params["axes.linewidth"], 0.5)
        self.assertEqual(params["xtick.direction"], "in")
        self.assertEqual(params["ytick.direction"], "in")
        self.assertTrue(params["xtick.minor.visible"])
        self.assertTrue(params["ytick.minor.visible"])
        self.assertFalse(params["legend.frameon"])
        self.assertEqual(params["font.family"], ["serif"])
        self.assertFalse(params["text.usetex"])
        colors = [mcolors.to_hex(c["color"]).lower()
                  for c in params["axes.prop_cycle"]]
        self.assertEqual(colors[0], "#0c5da5")

    def test_ieee_loads_delta(self):
        params = self._load("ieee")
        self.assertEqual(params["font.size"], 8.0)
        colors = [mcolors.to_hex(c["color"]).lower()
                  for c in params["axes.prop_cycle"]]
        self.assertEqual(colors[0], "#000000")

    def test_nature_loads_delta(self):
        params = self._load("nature")
        self.assertEqual(params["font.size"], 7.0)
        self.assertEqual(params["font.family"], ["sans-serif"])


class RegisterTests(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
        import vscode_spyder_plots_backend  # noqa: F401 — import = enregistrement
        self.matplotlib = matplotlib

    def test_names_registered(self):
        for name in ("science", "ieee", "nature"):
            self.assertIn(name, mstyle.available)

    def test_science_context_applies(self):
        import matplotlib.pyplot as plt
        with plt.style.context("science"):
            self.assertEqual(matplotlib.rcParams["axes.linewidth"], 0.5)
            self.assertEqual(matplotlib.rcParams["xtick.direction"], "in")
            self.assertTrue(matplotlib.rcParams["ytick.minor.visible"])
            self.assertFalse(matplotlib.rcParams["legend.frameon"])
            self.assertEqual(matplotlib.rcParams["font.family"], ["serif"])
            self.assertFalse(matplotlib.rcParams["text.usetex"])

    def test_ieee_stacks_on_science(self):
        import matplotlib.pyplot as plt
        with plt.style.context(["science", "ieee"]):
            self.assertEqual(matplotlib.rcParams["font.size"], 8.0)
            first = mcolors.to_hex(
                list(matplotlib.rcParams["axes.prop_cycle"])[0]["color"]).lower()
            self.assertEqual(first, "#000000")


if __name__ == "__main__":
    unittest.main()
