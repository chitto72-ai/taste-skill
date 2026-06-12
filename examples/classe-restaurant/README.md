# Classé Restaurant — Liquid-Glass Landing Page

Single-page landing concept for [Classé La Dogana Restaurant](https://www.classerestaurant.it/) (fine-dining seafood, Lecce, Italy), built as a self-contained `index.html` — no build step.

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

## Assets

Background videos are hotlinked free stock footage from [Pexels](https://www.pexels.com) (Pexels license): candlelit table (hero) and dish service (La Cucina). Copy is original, written from public information about the restaurant (seafood crudo from Italian seas, 20+ crystal glass types, Steinway & Sons piano room, terrace).
