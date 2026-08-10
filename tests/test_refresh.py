import math
import unittest

from refresh import normalize_operator


class NormalizeOperatorTest(unittest.TestCase):
    def test_natalia_without_a_marker_is_one_operator(self):
        variants = [
            "Наталья",
            "Накталья",
            "Наталбя",
            "Наталь",
            "Натальч",
            "Наташлья",
            "Наталья Ш",
        ]
        self.assertEqual(
            [normalize_operator(value) for value in variants],
            ["Наталья"] * len(variants),
        )

    def test_natalia_with_a_marker_stays_separate(self):
        variants = [
            "Наталья А",
            "Наталья  А",
            "Наталья А.",
            "Наталья.А.",
            "Натлья А",
            "наталья a",
        ]
        self.assertEqual(
            [normalize_operator(value) for value in variants],
            ["Наталья А"] * len(variants),
        )

    def test_galina_variants_are_one_operator(self):
        variants = ["Галя", "Галина", "галя", "Галинка"]
        self.assertEqual(
            [normalize_operator(value) for value in variants],
            ["Галина"] * len(variants),
        )

    def test_other_names_and_empty_values_are_preserved(self):
        self.assertEqual(normalize_operator("  елена  "), "Елена")
        self.assertEqual(normalize_operator("—"), "—")
        self.assertIsNone(normalize_operator(None))
        self.assertTrue(math.isnan(normalize_operator(float("nan"))))


if __name__ == "__main__":
    unittest.main()
