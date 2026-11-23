"""Rebuild src/fonts/bricolage-grotesque-site-wght.woff2 (look C's face, trimmed for the hero's critical path).

Usage: pip install fonttools brotli && python scripts/subset-font.py
Keeps weights 400-800 and the characters the site's copy uses; check-coverage below fails if the built site uses a
character the subset lacks (other than those served by the Latin Extended fallback face in styles.css).
"""
import glob
import html
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = 'node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2'
OUT = 'src/fonts/bricolage-grotesque-site-wght.woff2'
UNICODES = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + [0x2009, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x202F, 0x20AC, 0x2122, 0x2212]

if len(sys.argv) > 1 and sys.argv[1] == 'check-coverage':
    chars = set()
    for p in glob.glob('dist/**/*.html', recursive=True):
        t = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', open(p, encoding='utf-8').read(), flags=re.S)
        chars |= set(html.unescape(re.sub(r'<[^>]+>', ' ', t)))
    missing = sorted(c for c in chars - set(map(chr, UNICODES)) if not c.isspace() and not (0x100 <= ord(c) <= 0x2FF))
    print('uncovered:', missing or 'none')
    sys.exit(1 if missing else 0)

font = instancer.instantiateVariableFont(TTFont(SRC), {'wght': (400, 800)})
opts = subset.Options()
opts.flavor = 'woff2'
opts.layout_features = ['kern', 'liga', 'calt', 'tnum', 'lnum']
opts.name_IDs = ['*']
s = subset.Subsetter(opts)
s.populate(unicodes=UNICODES)
s.subset(font)
font.flavor = 'woff2'
os.makedirs(os.path.dirname(OUT), exist_ok=True)
font.save(OUT)
print(OUT, os.path.getsize(OUT), 'bytes')
