import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { repaintPlaques } from "./scene/plaques.js";
import { warmSurfaces } from "./scene/surfaces.js";
import "./styles.css";

const host = document.getElementById("root");
if (!host) throw new Error("#root missing from index.html");

/**
 * Canvas does not wait for a webfont: asked for a face that has not arrived, it
 * substitutes silently and draws. The rail plaques and the dealer button are
 * painted into canvases and only repainted when their number changes, so a
 * plate drawn during the first few hundred milliseconds of a session would
 * keep its fallback face until that seat happened to bet.
 *
 * Loading the two faces up front and repainting once is the whole fix - a
 * handful of small canvases redrawn, once, before anyone has sat down. The DOM
 * does not need this: it re-renders text whenever a font resolves.
 *
 * Nothing waits on the promise. A font that never loads is a fallback face on
 * some plaques, which is a cosmetic outcome; blocking the app on it would not
 * be.
 */
void Promise.all([
  document.fonts.load('700 16px "Cinzel Decorative"'),
  document.fonts.load('400 16px "Bebas Neue"'),
])
  .then(() => repaintPlaques())
  .catch(() => {
    // No `document.fonts`, or a face that failed to fetch. The fallback chain
    // in `plaques.ts` is a real chain, so there is nothing to recover from.
  });

/**
 * Draw the room's surfaces now, while the lobby is on screen.
 *
 * Every texture in `surfaces.ts` is built lazily, so without this the whole of
 * that per-pixel work happens synchronously on the first render of the 3D room
 * - a freeze at the exact moment a player is deciding whether this thing feels
 * good. The lobby is a form somebody is typing into, so it is free there.
 *
 * After a frame, not immediately: first paint comes first.
 */
requestAnimationFrame(() => {
  warmSurfaces();
});

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
