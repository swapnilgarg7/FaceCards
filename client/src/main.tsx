import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { dropPlaqueCache } from "./scene/plaques.js";
import "./styles.css";

const host = document.getElementById("root");
if (!host) throw new Error("#root missing from index.html");

/**
 * Canvas does not wait for a webfont: asked for a face that has not arrived, it
 * substitutes silently and draws. The rail plaques and the dealer button are
 * drawn into canvases and cached forever, so a plate drawn during the first few
 * hundred milliseconds of a session would keep its fallback face for the rest
 * of the evening.
 *
 * Loading the two faces up front and throwing that cache away once is the whole
 * fix - a handful of small canvases redrawn, once, before anyone has sat down.
 * The DOM does not need this: it re-renders text whenever a font resolves.
 *
 * Nothing waits on the promise. A font that never loads is a fallback face on
 * some plaques, which is a cosmetic outcome; blocking the app on it would not
 * be.
 */
void Promise.all([
  document.fonts.load('700 16px "Cinzel Decorative"'),
  document.fonts.load('400 16px "Bebas Neue"'),
])
  .then(() => dropPlaqueCache())
  .catch(() => {
    // No `document.fonts`, or a face that failed to fetch. The fallback chain
    // in `plaques.ts` is a real chain, so there is nothing to recover from.
  });

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
