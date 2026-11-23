# Vendored Lucide subset

This directory contains a small fixed subset of the official [Lucide](https://github.com/lucide-icons/lucide) SVGs, pinned to release `0.468.0` and the exact commit recorded in `provenance.json`. The upstream license is preserved verbatim in `LICENSE`.

`sources/` preserves the original SVG files; `nodes.ts` contains their SVG primitives as React-compatible data. Only `nodes.ts` is imported by the application. Source SVGs and the generator are not public assets, and no Lucide CDN, runtime package, icon font or network request is used.

The application name `home` aliases Lucide's upstream `house` icon. All other names match their upstream filenames. Paths and geometric primitives are unchanged. The wrapper uses a default 1.75px stroke to suit the site's navigation typography; callers can change it with `strokeWidth`.

Regenerate the data offline:

```sh
python3 src/vendor/lucide/generate.py
```

Refresh the pinned upstream source copies and license deliberately:

```sh
python3 src/vendor/lucide/generate.py --download
```

Use the shared component:

```tsx
import { Icon, type IconName } from './Icons'

<Icon name="utensils-crossed" />
<Icon name="menu" size={20} className="navigation-icon" />
```

Icons are decorative by default (`aria-hidden="true"`, `focusable="false"`) and should accompany visible text or a labelled control. If an icon conveys standalone information, pass `aria-hidden={false}`, `role="img"` and an accessible label. All ordinary SVG props are forwarded.
