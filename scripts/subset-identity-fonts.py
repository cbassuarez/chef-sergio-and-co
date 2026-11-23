"""Build the identity's initial-load faces without replacing its approved source fonts.

Requires FontTools + Brotli (the recorded build uses fonttools 4.68.0 and brotli 1.2.1).
Run: python3 scripts/subset-identity-fonts.py [--check]
--check regenerates in memory and verifies the checked-in outputs without writing files.
Original full faces remain the fallback for all other encoded characters/weights.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from io import BytesIO
from pathlib import Path

from fontTools import subset
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / 'src/fonts'
SOURCES = {
    'eb-garamond-latin-wght.woff2': '12790d713f7311ca89125e0558d15c5f4a460e71d83a58ed7c8ca2e41b73e488',
    'eb-garamond-latin-italic-wght.woff2': 'fe42b2756e3aae3c9aa7445b7720093cb18b7caee84c3ef54de23292f500adc8',
    'archivo-latin-wght.woff2': '7c59b09511f172d20fbf5feaf7aff9e844460cdb286d8930a1f546b39ed1a5e1',
}
# Keep accents and combining marks with their basic letters, and every punctuation/currency
# character used by the opening. Other encoded characters stay available in the original face.
CORE = set(range(0x20, 0x100)) | set(range(0x300, 0x370)) | set(range(0x2000, 0x2070)) | {0x20AC, 0x2122, 0x2212}


def unicode_ranges(values: set[int]) -> str:
    ranges = []
    for point in sorted(values):
        if ranges and ranges[-1][1] + 1 == point:
            ranges[-1][1] = point
        else:
            ranges.append([point, point])
    return ', '.join(f'U+{a:04X}' + (f'-{b:04X}' if b != a else '') for a, b in ranges)


def font_bytes(font: TTFont) -> bytes:
    font.flavor = 'woff2'
    output = BytesIO()
    font.save(output)
    return output.getvalue()


def open_source(name: str) -> TTFont:
    path = FONTS / name
    if hashlib.sha256(path.read_bytes()).hexdigest() != SOURCES[name]:
        raise ValueError(f'{name}: approved source changed; review provenance before updating its source hash')
    return TTFont(path, recalcTimestamp=False)


def outline(font: TTFont, glyph: str, weight: int):
    glyphs = font.getGlyphSet(location={'wght': weight})
    pen = DecomposingRecordingPen(glyphs)
    glyphs[glyph].draw(pen)
    return glyphs[glyph].width, pen.value


def core_face(name: str) -> tuple[bytes, dict]:
    source = open_source(name)
    original_cmap = source.getBestCmap()
    kept = set(original_cmap) & CORE
    font = open_source(name)
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']  # retain every existing feature applicable to the retained glyphs
    options.name_IDs = ['*']
    options.name_legacy = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=kept)
    subsetter.subset(font)
    generated = font_bytes(font)
    final = TTFont(BytesIO(generated), recalcTimestamp=False)
    final_cmap = final.getBestCmap()
    assert set(final_cmap) == kept
    assert [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in final['fvar'].axes] == [
        (a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in source['fvar'].axes
    ]
    # Verify actual outlines and advances after WOFF2 round-tripping at the site's two
    # requested Garamond weights and the retained variable range's upper endpoint.
    for weight in (400, 500, 800):
        for char in kept:
            assert outline(source, original_cmap[char], weight) == outline(final, final_cmap[char], weight), (name, weight, hex(char))
    return generated, {
        'characters': len(kept), 'retained_weight_range': [400, 800],
        'core_unicode_range': unicode_ranges(kept),
        'fallback_unicode_range': unicode_ranges(set(original_cmap) - kept),
        'outlines_and_advances': 'identical at weights 400, 500 and 800',
    }


def archivo_face() -> tuple[bytes, dict]:
    source = open_source('archivo-latin-wght.woff2')
    font = open_source('archivo-latin-wght.woff2')
    # CSS selects this face only for 400-500. Those weights are below the original
    # default 600, so gvar tents beginning at normalized zero and peaking above it
    # are inactive over the entire supported interval. Removing only those tents
    # leaves the original normalization, outlines, metrics and shaping exact;
    # restricting/remapping the axis would round one endpoint's advances.
    assert [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in font['fvar'].axes] == [('wght', 100, 600, 900)]
    removed = 0
    for glyph, variations in font['gvar'].variations.items():
        kept = []
        for variation in variations:
            axis = variation.axes.get('wght')
            if axis and axis[0] >= 0 and axis[1] > 0:
                removed += 1
            else:
                kept.append(variation)
        font['gvar'].variations[glyph] = kept
    generated = font_bytes(font)
    final = TTFont(BytesIO(generated), recalcTimestamp=False)
    assert final.getBestCmap().keys() == source.getBestCmap().keys()
    assert final.getGlyphOrder() == source.getGlyphOrder()
    for tag in ('GSUB', 'GPOS', 'fvar', 'avar', 'HVAR', 'hhea', 'OS/2', 'hmtx', 'cmap', 'name', 'post'):
        assert source[tag].compile(source) == final[tag].compile(final), tag
    for table, fields in (
        ('head', ('unitsPerEm',)),
        ('hhea', ('ascent', 'descent', 'lineGap')),
        ('OS/2', ('sTypoAscender', 'sTypoDescender', 'sTypoLineGap', 'sxHeight', 'sCapHeight', 'usWinAscent', 'usWinDescent')),
    ):
        for field in fields:
            assert getattr(source[table], field) == getattr(final[table], field), (table, field)
    for weight in (400, 450, 500):
        for glyph in source.getGlyphOrder():
            assert outline(source, glyph, weight) == outline(final, glyph, weight), (weight, glyph)
    return generated, {'characters': len(final.getBestCmap()), 'css_weight_range': [400, 500],
                       'binary_axis_range': [100, 900], 'removed_inactive_positive_gvar_tuples': removed,
                       'outlines_and_advances': 'identical at weights 400, 450 and 500',
                       'vertical_metrics': 'identical to the approved source',
                       'other_weights': 'unchanged original variable face, CSS ranges 100-399 and 501-900'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    report = {}
    for source, target in (
        ('eb-garamond-latin-wght.woff2', 'eb-garamond-core-wght.woff2'),
        ('eb-garamond-latin-italic-wght.woff2', 'eb-garamond-core-italic-wght.woff2'),
        ('archivo-latin-wght.woff2', 'archivo-core-wght.woff2'),
    ):
        generated, details = archivo_face() if target == 'archivo-core-wght.woff2' else core_face(source)
        path = FONTS / target
        if args.check:
            assert path.read_bytes() == generated, f'{target}: regenerate the checked-in file'
        else:
            path.write_bytes(generated)
        report[target] = {'bytes': len(generated), 'sha256': hashlib.sha256(generated).hexdigest(),
                          'source': source, 'source_sha256': SOURCES[source], **details}
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
