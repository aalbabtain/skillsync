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
export function track(step: "start" | "skills" | "postings" | "gap") {
  if (counted.has(step)) return;
  const counter = window.goatcounter;
  if (!counter?.count) return;
  counted.add(step);
  counter.count({ path: `step-${step}`, title: `Step: ${step}`, event: true });
}

/** Shown from this many. Raise it if a small number looks weak on the landing. */
export const MIN_SHOWN = 1;

/**
 * Visits to the whole site, from GoatCounter's public counter (the TOTAL path). Needs "Allow
 * adding visitor counts on your website" in the GoatCounter settings; null when off,
 * unreachable or still zero.
 */
export async function fetchVisits(code: string): Promise<number | null> {
  if (!code) return null;
  try {
    const response = await fetch(`https://${code}.goatcounter.com/counter/TOTAL.json`);
    if (!response.ok) return null;
    const body = (await response.json()) as { count?: string };
    const value = Number(String(body.count ?? "").replace(/[^0-9]/g, ""));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}
