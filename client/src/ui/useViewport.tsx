import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { deviceProfile, sameProfile, type ViewportProfile } from "./viewport.js";

/**
 * The screen's shape, measured once and shared.
 *
 * One reader rather than a `matchMedia` per component, and - more importantly
 * - one answer. The stylesheet needs the same verdict the components do, and a
 * breakpoint written twice is a breakpoint that will disagree with itself the
 * first time one of them is edited. So the hook stamps `data-compact` and
 * `data-touch` on the document element and the CSS keys off those attributes
 * rather than off its own media queries. `viewport.ts` is the only place a
 * threshold is written down.
 */

const DESKTOP: ViewportProfile = {
  compact: false,
  touch: false,
  handheld: false,
};

function read(): ViewportProfile {
  if (typeof window === "undefined") return DESKTOP;
  return deviceProfile({
    width: window.innerWidth,
    height: window.innerHeight,
    // Optional-chained because `matchMedia` is absent in a bare test DOM, and
    // "no idea" should mean "assume a mouse" rather than throw on mount.
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
  });
}

export function useViewport(): ViewportProfile {
  const [profile, setProfile] = useState(read);

  useEffect(() => {
    // Compared before it is stored: a phone fires resize on every scroll that
    // collapses the URL bar, and re-rendering the room for a verdict that did
    // not change is exactly the per-frame React work the scene must not do.
    const update = () =>
      setProfile((current) => {
        const next = read();
        return sameProfile(current, next) ? current : next;
      });

    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    const coarse = window.matchMedia?.("(pointer: coarse)");
    coarse?.addEventListener?.("change", update);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      coarse?.removeEventListener?.("change", update);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.compact = String(profile.compact);
    root.dataset.touch = String(profile.touch);
  }, [profile]);

  return profile;
}

const ViewportContext = createContext<ViewportProfile>(DESKTOP);

export function ViewportProvider({
  value,
  children,
}: {
  value: ViewportProfile;
  children: ReactNode;
}) {
  return <ViewportContext value={value}>{children}</ViewportContext>;
}

/**
 * The shared verdict, for the components too deep to be handed it as a prop -
 * the key chips especially, which appear on nearly every control in the
 * product and must not each grow a `compact` prop threaded down to them.
 */
export function useView(): ViewportProfile {
  return useContext(ViewportContext);
}
