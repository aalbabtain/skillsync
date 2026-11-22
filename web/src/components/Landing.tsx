import {
  Briefcase,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardList,
  FileCheck2,
  FileText,
  FileUp,
  GitCompareArrows,
  GraduationCap,
  Pause,
  Play,
  Route,
  Shuffle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { fetchCounts } from "../analytics";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n";
import { useCountUp, useReducedMotion } from "../motion";
import { startChapterSnap } from "../chapters";
import daicoMark from "../assets/daico-mark.png";
import daicoLogo from "../assets/daico.png";
import Logo from "./Logo";

type Props = {
  onStart: () => void;
  /** GoatCounter site code; when set, the hero shows how many CVs were checked. */
  counterCode: string;
};

type Card = { icon: LucideIcon; title: MessageKey; body: MessageKey };

// The same five steps as the service's step bar, with the same names.
const STEPS: (Card & { soon?: boolean })[] = [
  { icon: FileUp, title: "st_cv", body: "s0" },
  { icon: FileCheck2, title: "st_skills", body: "s1" },
  { icon: ClipboardList, title: "st_postings", body: "s2" },
  { icon: GitCompareArrows, title: "st_gap", body: "s3" },
  { icon: Route, title: "st_plan", body: "s4" },
];

const AUDIENCES: Card[] = [
  { icon: GraduationCap, title: "w1_h", body: "w1" },
  { icon: Shuffle, title: "w2_h", body: "w2" },
  { icon: Briefcase, title: "w3_h", body: "w3" },
];

const FAQ: { q: MessageKey; a: MessageKey }[] = [
  { q: "q0", a: "a0" },
  { q: "q6", a: "a6" },
  { q: "q2", a: "a2" },
  { q: "q7", a: "a7" },
  { q: "q3", a: "a3" },
  { q: "q4", a: "a4" },
  { q: "q5", a: "a5" },
  { q: "q8", a: "a8" },
  { q: "q1", a: "a1" },
];

const PREVIEW: {
  id: "missing" | "needs_proof" | "have";
  icon: LucideIcon;
  title: MessageKey;
  items: { name: string; n: number }[];
}[] = [
  { id: "missing", icon: CircleX, title: "grp_missing_h", items: [{ name: "Kubernetes", n: 3 }, { name: "Docker", n: 2 }] },
  { id: "needs_proof", icon: CircleHelp, title: "grp_proof_h", items: [{ name: "AWS", n: 2 }] },
  { id: "have", icon: CircleCheck, title: "grp_have_h", items: [{ name: "Python", n: 3 }, { name: "SQL", n: 2 }] },
];

const MOTION_KEY = "skillsync-motion";

/**
 * Motion follows the system setting until the visitor chooses with the button; the choice is
 * remembered on this device.
 */
function useMotionChoice() {
  const reduced = useReducedMotion();
  const [choice, setChoice] = useState<"on" | "off" | null>(() => {
    try {
      const saved = window.localStorage.getItem(MOTION_KEY);
      return saved === "on" || saved === "off" ? saved : null;
    } catch {
      return null;
    }
  });
  const playing = choice ? choice === "on" : !reduced;
  const toggle = () => {
    const next = playing ? "off" : "on";
    setChoice(next);
    try {
      window.localStorage.setItem(MOTION_KEY, next);
    } catch {
      // Without storage the choice lasts for this visit only.
    }
  };
  return { playing, toggle };
}

export default function Landing({ onStart, counterCode }: Props) {
  const { t, lang } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { playing, toggle } = useMotionChoice();
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const [fieldReady, setFieldReady] = useState(false);
  const cvWord = t("particles_cv");
  const [checked, setChecked] = useState<number | null>(null);
  const [built, setBuilt] = useState<number | null>(null);
  const shownChecked = useCountUp(checked ?? 0, !playing);
  const shownBuilt = useCountUp(built ?? 0, !playing);

  useEffect(() => {
    if (!counterCode) return;
    let active = true;
    fetchCounts().then((counts) => {
      if (!active) return;
      setChecked(counts.checked);
      setBuilt(counts.built);
    });
    return () => {
      active = false;
    };
  }, [counterCode]);

  useEffect(() => {
    const container = root.current;
    const surface = canvas.current;
    if (!container || !surface) return;
    let stop = () => {};
    let cancelled = false;
    import("../particles")
      .then(({ startField }) =>
        startField({ root: container, canvas: surface, lang, cvWord, isPlaying: () => playingRef.current }),
      )
      .then((dispose) => {
        if (cancelled) dispose();
        else {
          stop = dispose;
          setFieldReady(true);
        }
      })
      .catch(() => setFieldReady(false));
    return () => {
      cancelled = true;
      stop();
    };
  }, [lang, cvWord]);

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    return startChapterSnap(container, () => playingRef.current);
  }, []);

  const startButton = (
    <button className="btn btn-primary btn-lg" onClick={onStart}>
      {t("start")} <span className="arrow" aria-hidden="true">→</span>
    </button>
  );

  return (
    <div
      className={[
        "landing",
        playing && fieldReady ? "reveal-armed" : "",
        fieldReady ? "has-field" : "",
      ].join(" ")}
      ref={root}
    >
      <canvas className="field" ref={canvas} aria-hidden="true" />
      <div className="field-horizon" aria-hidden="true" />

      <section className="chapter chapter-hero" aria-labelledby="hero-title">
        <div className="ch-top" data-mask>
          <div>
            <p className="eyebrow rise">{t("eyebrow")}</p>
            <h1 id="hero-title" className="rise d1">
              {t("hero")}
              <br />
              <span className="hero-accent">{t("hero_accent")}</span>
            </h1>
          </div>
        </div>
        <div className="ch-stage" aria-hidden="true">
          <span className="ch-fallback">
            <Logo />
          </span>
        </div>
        <div className="ch-bottom" data-mask>
          <p className="lead rise d2">{t("lead")}</p>
          <div className="hero-cta rise d2">
            {startButton}
            <a className="btn btn-ghost btn-lg hero-build" href="#cv-builder">
              <FileText size={18} aria-hidden="true" />
              {t("hero_build")}
            </a>
          </div>
          <p className="hero-alt rise d2">
            <a href="#how">{t("see_how")}</a>
          </p>
          {(checked !== null || built !== null) && (
            <div className="hero-stats rise d2">
              {checked !== null && (
                <p className="hero-stat">
                  <span className="hero-stat-dot" aria-hidden="true" />
                  <span className="hero-stat-n" dir="ltr">
                    {shownChecked.toLocaleString("en-US")}
                  </span>
                  <span className="hero-stat-label">{t(checked === 1 ? "stat_checked_one" : "stat_checked")}</span>
                </p>
              )}
              {built !== null && (
                <p className="hero-stat">
                  <span className="hero-stat-dot" aria-hidden="true" />
                  <span className="hero-stat-n" dir="ltr">
                    {shownBuilt.toLocaleString("en-US")}
                  </span>
                  <span className="hero-stat-label">{t(built === 1 ? "stat_built_one" : "stat_built")}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="chapter" id="how" aria-labelledby="how-title">
        <div className="ch-top">
          <div data-mask>
            <p className="eyebrow rise">{t("how_label")}</p>
            <h2 id="how-title" className="rise d1">
              {t("how_title")}
            </h2>
          </div>
          <p className="ch-note rise d2" data-mask>
            {t("how_note")}
          </p>
        </div>
        <div className="ch-stage" aria-hidden="true" />
        <ol className="ch-track" data-mask>
          <span className="ch-track-line" aria-hidden="true" />
          {STEPS.map(({ icon: Icon, title, body, soon }, index) => (
            <li key={title}>
              <span className="ch-tile" aria-hidden="true">
                <Icon size={20} />
              </span>
              <span className="step-n">{t("step_n", { n: index + 1 })}</span>
              <h3>
                {t(title)}
                {soon && <span className="stepper-soon">{t("st_soon")}</span>}
              </h3>
              <p>{t(body)}</p>
            </li>
          ))}
        </ol>
        <p className="ch-build" data-mask>
          <FileText size={16} aria-hidden="true" />
          <span>
            {t("how_build")} <a href="#cv-builder">{t("how_build_link")}</a>
          </span>
        </p>
      </section>

      <section className="chapter" id="result" aria-labelledby="result-title">
        <div className="ch-top">
          <div data-mask>
            <p className="eyebrow rise">{t("preview_label")}</p>
            <h2 id="result-title" className="rise d1">
              {t("preview_h")}
            </h2>
          </div>
          <p className="ch-note rise d2" data-mask>
            {t("preview_note")}
          </p>
        </div>
        <div className="ch-stage" aria-hidden="true" />
        <div className="ch-groups" role="group" aria-label={t("preview_example")} data-mask>
          {PREVIEW.map(({ id, icon: Icon, title, items }) => (
            <div className={`ch-group gap-${id}`} key={id}>
              <p className="ch-group-title">
                <Icon size={16} aria-hidden="true" /> {t(title)}
              </p>
              <ul>
                {items.map((item) => (
                  <li key={item.name}>
                    <strong dir="ltr">{item.name}</strong>
                    <span>{t("asked", { n: item.n, total: 3 })}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="chapter" id="who" aria-labelledby="who-title">
        <div className="ch-top">
          <div data-mask>
            <p className="eyebrow rise">{t("who_label")}</p>
            <h2 id="who-title" className="rise d1">
              {t("who_h")}
            </h2>
          </div>
          <p className="ch-note rise d2" data-mask>
            {t("who_note")}
          </p>
        </div>
        <div className="ch-stage" aria-hidden="true" />
        <ul className="ch-cards" data-mask>
          {AUDIENCES.map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <span className="ch-tile" aria-hidden="true">
                <Icon size={20} />
              </span>
              <h3>{t(title)}</h3>
              <p>{t(body)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="chapter" id="faq" aria-labelledby="faq-title">
        <div className="ch-top">
          <div data-mask>
            <p className="eyebrow rise">{t("faq_label")}</p>
            <h2 id="faq-title" className="rise d1">
              {t("faq_h")}
            </h2>
          </div>
          <div className="ch-note rise d2" data-mask>
            {startButton}
          </div>
        </div>
        <div className="ch-faq-layout">
          <div className="ch-stage" aria-hidden="true" />
          <div className="faq" data-mask>
            {FAQ.map(({ q, a }) => (
              <details key={q}>
                <summary>{t(q)}</summary>
                <p>{t(a)}</p>
              </details>
            ))}
          </div>
        </div>
        {/* The credits close the last chapter, on the same screen as the questions. */}
          <footer className="site-foot">
            <div className="foot-top">
              <div className="foot-brand">
                <Logo />
                <span>{t("foot_vision")}</span>
              </div>
              <ul className="foot-badges">
                <li className="foot-badge">
                  <GraduationCap size={16} aria-hidden="true" />
                  {t("foot_ksu")}
                </li>
                <li className="foot-badge foot-badge-logo">
                  <img className="foot-mark" src={daicoMark} alt="" width={14} height={20} />
                  <img src={daicoLogo} alt="DAICO" width={72} height={16} />
                </li>
              </ul>
            </div>
            <p className="foot-copy">
              <span dir="ltr">© 2026 SkillSync · Ahmed Ababtain</span>
            </p>
          </footer>
      </section>


      {fieldReady && (
        <button className="motion-toggle" type="button" onClick={toggle}>
          {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          <span className="motion-label">{playing ? t("motion_pause") : t("motion_play")}</span>
        </button>
      )}
    </div>
  );
}
