# Fixture set

The image set the Milestone 0 robustness matrix is measured against. Sources are
normalised by `scripts/normalize-fixtures.ts`: fitted inside 1600px on the long
edge, flattened onto white, written as PNG. SVG illustrations are rasterised and
their rasteriser padding trimmed.

1600px is chosen because it is what a photographer actually publishes, and the
published copy is the one that gets screenshot, cropped and re-encoded.

## What is published here

| Category | Count | Published |
|---|---|---|
| Photo | 5 | yes |
| Illustration | 6 | yes |
| Screenshot | 5 | **no — see below** |
| AI-generated | 0 | — still needed |

**The screenshot fixtures are deliberately not committed.** They are the
author's own screen captures and contain unreleased projects and a machine
hostname. They stay local, so the matrix is measured over all 16 fixtures while
only 11 are redistributed. Results for the screenshot rows are therefore
reported but not independently reproducible from this repo alone.

## Credits

**Photographs** — [Unsplash](https://unsplash.com), used under the Unsplash
Licence: Alina Chernovolova, Quan Jing, Queensland Australia, Robert Heiser,
SanDisk.

**Illustrations** — [unDraw](https://undraw.co) by Katerina Limpitsouni.

Grain stores only fingerprints, never images, which is what makes the licence
question straightforward for the seeded corpus as well.
