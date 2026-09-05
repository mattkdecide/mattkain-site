# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A static HTML website deployed via GitHub Pages to **mattkain.com**. No build system, no framework, no package manager — everything is plain HTML and CSS, self-contained per file.

## Deployment

Push to `main` → GitHub Pages auto-deploys to mattkain.com (CNAME configured). There is no build step.

To preview locally:
```bash
python3 -m http.server 8080
# or
npx serve .
```

## File structure and conventions

```
index.html          # Public-facing personal CV/bio (indexed)
sistersweekend.html # Personal page (one-off)
mk/index.html       # Private file index — lists all files, access by URL only
mk/                 # Private HTML artifacts (presentations, briefs)
files/adobe/        # Private work files for Adobe APAC engagement
```

**All files in `mk/` and `files/` are private** — they carry `<meta name="robots" content="noindex, nofollow">` and are not linked from the public site.

**Versioned filenames**: active files use a `v2` suffix (e.g. `adobev2.html`, `90-days-apacv2.html`). When creating a replacement for an existing file, append `v2` (or increment the version number) rather than overwriting the original.

**When adding a new file to `mk/` or `files/`**, also add a corresponding entry to `mk/index.html` under the appropriate section (Operations, Strategy, Industry, Working, or Old) with the correct badge.

## Design system

All CSS is written inline in `<style>` tags — no external stylesheets.

### Public site (`index.html`) — dark theme
```css
--bg:       #0d0d0f
--surface:  #141416
--border:   #222226
--text:     #f0f0f2
--muted:    #888898
--faint:    #333340
--accent:   #D97757          /* warm orange */
--accent-lo: rgba(217,119,87,0.12)
```
Font: Inter (Google Fonts), max-width 1040px container.

### Private work files (`files/adobe/`, some `mk/`) — Adobe-themed
Dark variant uses `#0f0f10` / `#eb1000` (Adobe red) accent.
Light variant uses `#f4f4f4` background, `#1a1a1a` text, `#FF0000` Adobe red accent.

### `mk/index.html` — dark, same palette as public site
Section accent colours per category:
- Operations: `#eb1000`
- Strategy: `#3b82f6`
- Industry: `#22c55e`
- Working/WIP: `#f97316`
- Old/Archived: `#555566`

Badge classes: `.badge-new`, `.badge-live`, `.badge-draft`, `.badge-concept`, `.badge-conf`, `.badge-old`

## Key patterns

- Every HTML file is fully self-contained — no shared CSS files, no JS imports.
- Responsive via `@media (max-width: 640px)` breakpoints.
- Container widths: 960px (`mk/`) or 1040px (public site).
- Private files use `noindex, nofollow` meta tag.
- The `publish-to-mattkain` skill handles publishing Claude-generated artifacts to this site.
