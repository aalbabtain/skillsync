/**
 * Anonymous visit counts with GoatCounter: no cookies, no personal data, and never any CV or
 * posting text. Runs only when the server reports a site code (GOATCOUNTER_CODE).
 */

type GoatCounter = { count?: (vars: { path: string; title: string; event: boolean }) => void };

declare global {
  interface Window {
    goatcounter?: GoatCounter;
  }
}

const counted = new Set<string>();

export function startAnalytics(code: string) {
  if (!code || document.querySelector("script[data-goatcounter]")) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://gc.zgo.at/count.js";
  script.dataset.goatcounter = `https://${code}.goatcounter.com/count`;
  document.head.appendChild(script);
}

/** Counts one step of the flow, once per visit, so a reload or Back does not count it twice. */
export function track(step: "start" | "skills" | "postings" | "gap" | "plan" | "cv-builder" | "cv-built") {
  if (counted.has(step)) return;
  const counter = window.goatcounter;
  if (!counter?.count) return;
  counted.add(step);
  counter.count({ path: `step-${step}`, title: `Step: ${step}`, event: true });
}

/**
 * How many CVs were checked so far. Our server asks GoatCounter and caches the answer, so ad
 * blockers that stop goatcounter.com in the browser cannot hide it. Zero is shown; null (the
 * counter is off or unreachable) shows nothing.
 */
export type Counts = { checked: number | null; built: number | null };

const COUNTS_KEY = "skillsync-counts";

/** The counts this browser saw last, shown at once while the current ones load. */
export function lastCounts(): Counts {
  try {
    const saved = JSON.parse(localStorage.getItem(COUNTS_KEY) ?? "null") as Partial<Counts> | null;
    const count = (value: unknown) => (typeof value === "number" ? value : null);
    return { checked: count(saved?.checked), built: count(saved?.built) };
  } catch {
    return { checked: null, built: null };
  }
}

export async function fetchCounts(): Promise<Counts> {
  const none = { checked: null, built: null };
  try {
    const response = await fetch("/api/stats");
    if (!response.ok) return none;
    const body = (await response.json()) as Partial<Counts>;
    const count = (value: unknown) => (typeof value === "number" ? value : null);
    const counts = { checked: count(body.checked), built: count(body.built) };
    try {
      localStorage.setItem(COUNTS_KEY, JSON.stringify(counts));
    } catch {
      // Without storage the counts still show; they just load fresh next time.
    }
    return counts;
  } catch {
    return none;
  }
}
