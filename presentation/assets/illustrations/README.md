# Illustrations

The presentation's custom illustrations (cover hero, connected-modules ecosystem,
disconnected→connected challenges infographic, technology architecture, implementation
roadmap) are authored as **inline SVG inside `presentation/index.html`**, not as external
files in this folder.

Reason: every illustration carries text labels (module names, phase names) that must
participate in the EN/AR i18n system (`data-i18n-en` / `data-i18n-ar`) and mirror
correctly in RTL. Inline SVG keeps those labels translatable and the connector-line
draw animations addressable from `js/animation.js`; external `<img>` SVGs would freeze
them as English-only pixels.

Static raster/vector assets that need no translation (logos, screenshots, icons) live
in their own sibling folders.
