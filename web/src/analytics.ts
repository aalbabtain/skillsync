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

/**
 * How many CVs were checked so far. Our server asks GoatCounter and caches the answer, so ad
 * blockers that stop goatcounter.com in the browser cannot hide it. Zero is shown; null (the
 * counter is off or unreachable) shows nothing.
 */
export async function fetchCheckedCount(): Promise<number | null> {
  try {
    const response = await fetch("/api/stats");
    if (!response.ok) return null;
    const body = (await response.json()) as { checked?: number | null };
    return typeof body.checked === "number" ? body.checked : null;
  } catch {
    return null;
  }
}
