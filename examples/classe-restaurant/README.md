# Classé Restaurant — Liquid-Glass Website Concept

Full multi-page website concept for [Classé La Dogana Restaurant](https://www.classerestaurant.it/) (fine-dining seafood, Lecce, Italy), built as a single self-contained `index.html` with hash routing — no build step.

Pages: **Home** (video hero + La Cucina + teasers), **Menù** (six animated menu sections + wine card), **Chi Siamo** (philosophy + chef Ivan Tronci), **Esperienze** (terrace, Steinway piano room, private events, tastings), **Contatti** (address, hours, booking).

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

## Stack (CDN-only, pinned)

React 18.3.1 UMD · Babel Standalone 7.29.0 · Framer Motion 11.11.17 UMD · Tailwind Play CDN · Google Fonts (Instrument Serif + Barlow).

## Assets & content

All videos and photos are hotlinked free stock media from [Pexels](https://www.pexels.com) (Pexels license) chosen to match the restaurant's subjects (oysters, seafood pasta, sushi, elegant interiors, grand piano, terrace), as the official site's media was not accessible. All copy is original, written around publicly available facts about the restaurant: address (Viale della Libertà 93/b, Lecce), phone, hours, chef Ivan Tronci, signature dishes (crudité di mare, ostriche imperiali, spaghetti alla tartare di tonno), 20+ crystal glass types, Steinway & Sons piano room, terrace, private events. The menu page is a representative selection, not the official menu.
