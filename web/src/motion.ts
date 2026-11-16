import { useEffect, useState } from "react";
import type { RefObject } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** True when the visitor asked their system for less motion. Every animation checks it. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

/**
 * Fades [data-reveal] elements in as they scroll into view. Content is visible by default:
 * it is only hidden once this runs, so it never stays invisible if scripts or observers fail.
 */
export function useRevealOnScroll(root: RefObject<HTMLElement | null>, reduced: boolean) {
  useEffect(() => {
    const container = root.current;
    if (!container || reduced || !("IntersectionObserver" in window)) return;

    const targets = Array.from(container.querySelectorAll<HTMLElement>("[data-reveal]"));
    container.classList.add("reveal-armed");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );

    targets.forEach((target) => observer.observe(target));
    return () => {
      observer.disconnect();
      container.classList.remove("reveal-armed");
    };
  }, [root, reduced]);
}

/** How far (0 to 1) an element has travelled through the middle of the viewport. */
export function useScrollProgress(target: RefObject<HTMLElement | null>, reduced: boolean): number {
  const [progress, setProgress] = useState(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      setProgress(1);
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const element = target.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      const start = window.innerHeight * 0.85;
      const end = window.innerHeight * 0.35;
      const value = (start - box.top) / (start - end + box.height * 0.5);
      setProgress(Math.min(1, Math.max(0, value)));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [target, reduced]);

  return progress;
}

/** Counts up through `steps` ticks, `delays[i]` ms apart, then stops. Jumps to the end when reduced. */
export function useTimeline(delays: number[], reduced: boolean, key: unknown = null): number {
  const [tick, setTick] = useState(reduced ? delays.length : 0);

  useEffect(() => {
    if (reduced) {
      setTick(delays.length);
      return;
    }
    setTick(0);
    const timers: number[] = [];
    let elapsed = 0;
    delays.forEach((delay, index) => {
      elapsed += delay;
      timers.push(window.setTimeout(() => setTick(index + 1), elapsed));
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, key]);

  return tick;
}
