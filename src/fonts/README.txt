Chef Sergio & Co. / approved salon typography

EB Garamond carries display and prose. Archivo carries controls and small labels.
Display: weight 500, tracking -0.005em. Prose: weight 400, 19/28 px at a 16 px root.
Functional labels and controls: Archivo 400, normally 14-16 px. True italic is
available for occasional emphasis. No synthesized weights or italics.

EB Garamond source: unchanged installed Version 1.001 variable upright/italic
binaries, wght 400-800, audited in output/brand-identity-salon/font-audit.txt.
The web WOFF2 files are derived subsets of those originals: Latin through U+024F,
combining marks, common punctuation/currencies, and the site's used symbols.
Core shaping, kerning, standard ligatures and numeric features are retained;
unused ornamental alternates are omitted. Copyright names are retained. The
685 encoded characters and wght 400-800 range are unchanged by this feature trim.
Subsetting and WOFF2 conversion used FontTools; original licenses are included.
No Reserved Font Name is specified in this distribution's OFL header.

Archivo web font is an unchanged copy of the audited Latin variable WOFF2,
wght 100-900. UI explicitly requests 400 instead of relying on its default.

Initial-load derivatives (scripts/subset-identity-fonts.py): Garamond's core
upright/italic files retain Latin-1, combining marks and common punctuation,
all applicable existing layout features, and the full wght 400-800 range.
The original full Garamond files remain unchanged, with complementary CSS
unicode ranges covering every other encoded character. Regeneration verifies
identical core outlines and advances at weights 400, 500 and 800 after WOFF2
round-tripping. Archivo's variable core retains all 231 encoded characters
and all existing shaping features, and CSS selects it only for weights 400-500.
Its original internal axis/normalization (100-900, default 600) is retained to
avoid endpoint rounding. Only 301 positive gvar tuples that are inactive
throughout 400-500 are removed. Generated outlines/advances at 400, 450 and 500
and the full shaping tables are verified identical. Quiet UI and the primary
action share one font download; all other 100-399 and 501-900 weights still use
the unchanged original file. The CSS-scoped core is not a general replacement
for the complete original outside its declared 400-500 range.
Original licenses, names and notices are retained. The script pins source
SHA-256 values and supports --check for an in-memory reproducibility check.
Built with FontTools 4.68.0 / Brotli 1.2.1; upright core 44,316 bytes, italic
core 45,744 bytes, Archivo core 26,200 bytes. Upright plus UI initial payload
is 70,516 bytes instead of 116,180; original files remain complete fallbacks.

Both families are distributed under SIL Open Font License 1.1. Retain the full
licenses and copyright notices when distributing these font files.
https://github.com/google/fonts/tree/main/ofl/ebgaramond
https://github.com/google/fonts/tree/main/ofl/archivo

Approved color roles (sRGB):
Ink    #2D2B27 / 45,43,39    primary type, identifying artwork, dark surfaces
Ivory  #FCFAF5 / 252,250,245 principal field and intended paper character
Rouge  #8E352F / 142,53,47   actions, focus, restrained accents
Pearl  #E6E1D8 / 230,225,216 secondary section fields, rules and divisions
Hover  #742922 / 116,41,34   functional darker Rouge

Pearl is not a functional field/control boundary. Those use stronger Ink/Rouge.
The intended paper color and ink appearance require physical proofing; these
screen values are not a measured CMYK or spot-ink match.
