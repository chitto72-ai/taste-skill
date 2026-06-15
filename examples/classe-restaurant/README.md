# Classé Restaurant — Liquid-Glass Website Concept

Full multi-page website concept for [Classé La Dogana Restaurant](https://www.classerestaurant.it/) (Lecce, Italy), built as `index.html` + `i18n.js` with hash routing — no build step. Content mirrors the official site.

The site is **multilingual** — a language selector in the navbar switches the whole site (menu included) between **7 languages**: Italian, English, Spanish, German, Portuguese, Arabic and Chinese. Arabic switches the page to right-to-left. The chosen language is remembered (localStorage).

Pages (matching the original site's navigation): **Home** (video hero, "Dal mare alla cucina", pillars, "Atmosfera unica", asporto/Deliveroo), **Chi Siamo** (philosophy, Ittica De Mar, gallery), **Menù** (13 animated sections with the real menu and prices + official PDF links), **Carta dei Vini** (cellar highlights + Enoweb link), **Eventi** (real tasting events + private events), **Contatti & Posizione** (address, hours, phone, WhatsApp, map, newsletter). Every page ends with the "Prenota un tavolo" band and full footer.

## Run

Open `index.html` directly in a browser, or serve it:

```bash
python3 -m http.server 8000
# → http://localhost:8000/index.html
```

## What's inside

- **Two full-height sections** (Hero + La Cucina), each with a looping background video crossfaded by a custom `requestAnimationFrame` fader (`FadingVideo`) — no CSS transitions, manual loop via the `ended` event.
- **Liquid-glass design system**: `.liquid-glass` / `.liquid-glass-strong` utilities with luminosity blend, backdrop blur, and a masked gradient border ring.
- **`BlurText`**: word-by-word blur-in headline driven by IntersectionObserver + Framer Motion keyframes.
- **Framer Motion entrance animations** with staggered delays (badge → headline → subhead → CTAs → stats → partners).
- **i18n** (`i18n.js`): a `tr()` lookup keyed by the Italian source string, with graceful fallback to Italian for anything untranslated. `BlurText` and the page components resolve their text through `tr()`, so the menu, headings, copy and labels all localize. Dish proper names (e.g. *Spaghetto al Gambero Viola*, *King Crab*, *Wagyu*) and the "(ENG)" PDF labels stay in their original language by design.

## Stack (CDN-only, pinned)

React 18.3.1 UMD · Babel Standalone 7.29.0 · Framer Motion 11.11.17 UMD · Tailwind Play CDN · Google Fonts (Instrument Serif + Barlow).

## Assets & content

Photos are hotlinked from the restaurant's own official website (classerestaurant.it); the two background videos are free stock from [Pexels](https://www.pexels.com) (Pexels license), since the original site uses static imagery. Menu items and prices, opening hours, address, contacts, social links, delivery links and tasting events were sourced from the official site and its published PDF menus; descriptive copy is written for this concept. Menu PDFs and the Enoweb wine list link out to the official documents — verify prices against those before any production use.
