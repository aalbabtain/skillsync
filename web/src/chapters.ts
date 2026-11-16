export function headerHeight() {
  return document.querySelector<HTMLElement>(".site-head")?.offsetHeight ?? 0;
}

/** Where the morph stands: 0 on the first chapter, 1 on the second, and eased between. */
export function chapterProgress(chapters: HTMLElement[]) {
  const head = headerHeight();
  const mid = window.scrollY + head + (window.innerHeight - head) / 2;
  const centers = chapters.map((c) => c.getBoundingClientRect().top + window.scrollY + c.offsetHeight / 2);
  if (mid <= centers[0]) return 0;
  for (let i = 0; i < centers.length - 1; i++) {
    if (mid < centers[i + 1]) {
      const f = (mid - centers[i]) / (centers[i + 1] - centers[i]);
      const held = Math.min(1, Math.max(0, (f - 0.08) / 0.84));
      return i + (held < 0.5 ? 4 * held ** 3 : 1 - Math.pow(-2 * held + 2, 3) / 2);
    }
  }
  return centers.length - 1;
}

/**
 * One deliberate scroll moves a whole chapter, and the object re-forms on the way. A faint
 * brush of the wheel or trackpad does nothing. Mouse and keyboard only; touch scrolls freely.
 */
export function startChapterSnap(root: HTMLElement, isPlaying: () => boolean): () => void {
  const chapters = Array.from(root.querySelectorAll<HTMLElement>(".chapter"));
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  const THRESHOLD = 60; // wheel travel needed: one mouse notch (about 100) moves, a brush does not
  const QUIET_MS = 350; // travel resets after this long without wheel input
  const DURATION = 1600; // long enough to watch the object re-form
  const COOLDOWN = 450; // trackpad momentum after a glide is ignored for this long
  let travel = 0;
  let quiet = 0;
  let gliding = false;
  let lockedUntil = 0;
  let glideFrame = 0;

  const active = () => fine.matches && isPlaying();
  const topOf = (n: number) =>
    n === 0 ? 0 : chapters[n].getBoundingClientRect().top + window.scrollY - headerHeight();
  const current = () => {
    const mid = window.scrollY + window.innerHeight * 0.5;
    let found = 0;
    chapters.forEach((_, n) => {
      if (topOf(n) <= mid) found = n;
    });
    return found;
  };
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function glide(n: number) {
    const i = Math.max(0, Math.min(chapters.length - 1, n));
    const to = Math.min(topOf(i), document.documentElement.scrollHeight - window.innerHeight);
    const from = window.scrollY;
    if (Math.abs(to - from) < 2) return;
    gliding = true;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      window.scrollTo({ top: from + (to - from) * ease(t), behavior: "instant" });
      if (t < 1) glideFrame = requestAnimationFrame(step);
      else {
        gliding = false;
        lockedUntil = performance.now() + COOLDOWN;
        travel = 0;
      }
    };
    glideFrame = requestAnimationFrame(step);
  }

  const onWheel = (e: WheelEvent) => {
    if (!active() || e.ctrlKey) return;
    const dir = Math.sign(e.deltaY);
    if (!dir) return;
    const i = current();
    const c = chapters[i];
    // A chapter taller than the screen (an opened answer, for one) scrolls normally to its edge.
    // Only a chapter that is itself taller than the screen counts; the demo note above the
    // first one only pushes it down.
    const absTop = c.getBoundingClientRect().top + window.scrollY;
    const tall = c.offsetHeight > window.innerHeight - headerHeight() + 4;
    if (tall && dir > 0 && absTop + c.offsetHeight > window.scrollY + window.innerHeight + 4) return;
    if (tall && dir < 0 && absTop - headerHeight() < window.scrollY - 4) return;
    if (dir > 0 && i === chapters.length - 1) return;
    e.preventDefault();
    if (gliding || performance.now() < lockedUntil) {
      travel = 0;
      return;
    }
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? window.innerHeight : 1;
    if (Math.sign(travel) !== dir) travel = 0;
    travel += e.deltaY * unit;
    window.clearTimeout(quiet);
    quiet = window.setTimeout(() => {
      travel = 0;
    }, QUIET_MS);
    if (Math.abs(travel) >= THRESHOLD) {
      travel = 0;
      glide(i + dir);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (!active() || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, select, summary, button, [contenteditable], [role=menu]")) return;
    const next = ["ArrowDown", "PageDown"].includes(e.key) || (e.key === " " && !e.shiftKey);
    const prev = ["ArrowUp", "PageUp"].includes(e.key) || (e.key === " " && e.shiftKey);
    const i = current();
    let to: number | null = null;
    if (next && i < chapters.length - 1) to = i + 1;
    if (prev && i > 0) to = i - 1;
    if (e.key === "Home") to = 0;
    if (e.key === "End") to = chapters.length - 1;
    if (to === null || gliding) return;
    e.preventDefault();
    glide(to);
  };

  // A section link whose address is already showing does not fire a hash change; glide instead.
  const onClick = (e: MouseEvent) => {
    const link = (e.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>('a[href^="#"]');
    if (!link || link.getAttribute("href") !== window.location.hash) return;
    const n = chapters.findIndex((c) => `#${c.id}` === link.getAttribute("href"));
    if (n < 0) return;
    e.preventDefault();
    if (active()) glide(n);
    else window.scrollTo({ top: topOf(n) });
  };

  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  document.addEventListener("click", onClick);
  return () => {
    cancelAnimationFrame(glideFrame);
    window.clearTimeout(quiet);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("click", onClick);
  };
}
