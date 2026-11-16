import {
  BadgeCheck,
  Briefcase,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardList,
  FileCheck2,
  GitCompareArrows,
  GraduationCap,
  Lock,
  Quote,
  Route,
  ScanSearch,
  Shuffle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n";
import Logo from "./Logo";

type Props = {
  onStart: () => void;
};

type Card = { icon: LucideIcon; title: MessageKey; body: MessageKey };

const STEPS: Card[] = [
  { icon: FileCheck2, title: "s1_h", body: "s1" },
  { icon: ClipboardList, title: "s2_h", body: "s2" },
  { icon: GitCompareArrows, title: "s3_h", body: "s3" },
  { icon: Route, title: "s4_h", body: "s4" },
];

const TRUST: Card[] = [
  { icon: Quote, title: "trust1_h", body: "trust1" },
  { icon: ScanSearch, title: "trust2_h", body: "trust2" },
  { icon: Lock, title: "trust3_h", body: "trust3" },
];

const AUDIENCES: Card[] = [
  { icon: GraduationCap, title: "w1_h", body: "w1" },
  { icon: Shuffle, title: "w2_h", body: "w2" },
  { icon: Briefcase, title: "w3_h", body: "w3" },
];

const FAQ: { q: MessageKey; a: MessageKey }[] = [
  { q: "q1", a: "a1" },
  { q: "q2", a: "a2" },
  { q: "q3", a: "a3" },
  { q: "q4", a: "a4" },
  { q: "q5", a: "a5" },
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

export default function Landing({ onStart }: Props) {
  const { t } = useI18n();

  const sample = [
    { name: "Python", quote: t("sample_quote_python") },
    { name: "PostgreSQL", quote: t("sample_quote_postgres") },
  ];

  const startButton = (
    <button className="btn btn-primary btn-lg" onClick={onStart}>
      {t("start")} <span className="arrow" aria-hidden="true">→</span>
    </button>
  );

  return (
    <div className="landing">
      <section className="hero-split wrap" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 id="hero-title">{t("hero")}</h1>
          <p className="lead">{t("lead")}</p>
          <div className="hero-cta">
            {startButton}
            <a className="btn btn-ghost btn-lg" href="#how">
              {t("see_how")}
            </a>
          </div>
        </div>

        <figure className="proof" aria-label={t("sample")}>
          <figcaption className="proof-head">
            <span>{t("sample")}</span>
            <span>{t("sample_meta")}</span>
          </figcaption>
          {sample.map((item) => (
            <div className="proof-row" key={item.name}>
              <div className="proof-top">
                <strong dir="ltr">{item.name}</strong>
                <span className="tag tag-ok">
                  <BadgeCheck size={13} aria-hidden="true" /> {t("verified")}
                </span>
              </div>
              <p className="proof-quote" dir="auto">
                {item.quote}
              </p>
            </div>
          ))}
          <div className="proof-row">
            <div className="proof-top">
              <strong dir="ltr">Docker</strong>
              <span className="tag tag-gap">{t("gap_badge")}</span>
            </div>
            <p className="proof-quote">{t("gap_note")}</p>
          </div>
        </figure>
      </section>

      <section className="steps-strip" id="how" aria-labelledby="how-title">
        <div className="wrap">
          <h2 id="how-title" className="visually-hidden">
            {t("how_h")}
          </h2>
          <ol className="steps-grid">
            {STEPS.map(({ icon: Icon, title, body }, index) => (
              <li key={title}>
                <span className="icon-tile" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span className="step-n">{t("step_n", { n: index + 1 })}</span>
                <h3>{t(title)}</h3>
                <p>{t(body)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="wrap band" aria-labelledby="trust-title">
        <h2 id="trust-title">{t("trust_h")}</h2>
        <ul className="card-grid">
          {TRUST.map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <span className="icon-tile" aria-hidden="true">
                <Icon size={20} />
              </span>
              <h3>{t(title)}</h3>
              <p>{t(body)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="wrap band" aria-labelledby="preview-title">
        <div>
          <h2 id="preview-title">{t("preview_h")}</h2>
          <p className="band-lead">{t("preview_lead")}</p>
        </div>
        <div className="preview" aria-hidden="true">
          {PREVIEW.map(({ id, icon: Icon, title, items }) => (
            <div className={`preview-col gap-${id}`} key={id}>
              <p className="preview-title">
                <Icon size={16} /> {t(title)}
              </p>
              {items.map((item) => (
                <div className="preview-item" key={item.name}>
                  <strong dir="ltr">{item.name}</strong>
                  <span>{t("asked", { n: item.n, total: 3 })}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="wrap band" id="who" aria-labelledby="who-title">
        <h2 id="who-title">{t("who_h")}</h2>
        <ul className="card-grid">
          {AUDIENCES.map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <span className="icon-tile" aria-hidden="true">
                <Icon size={20} />
              </span>
              <h3>{t(title)}</h3>
              <p>{t(body)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="wrap band" id="faq" aria-labelledby="faq-title">
        <h2 id="faq-title">{t("faq_h")}</h2>
        <div className="faq">
          {FAQ.map(({ q, a }) => (
            <details key={q}>
              <summary>{t(q)}</summary>
              <p>{t(a)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="wrap closing" aria-labelledby="closing-title">
        <div>
          <h2 id="closing-title">{t("final_h")}</h2>
          <p>{t("final")}</p>
        </div>
        {startButton}
      </section>

      <footer className="site-foot wrap">
        <Logo />
        <span>{t("foot_vision")}</span>
        <span className="foot-meta">
          <a
            className="foot-link"
            href="https://github.com/aalbabtain/skillsync"
            target="_blank"
            rel="noreferrer"
          >
            {t("source_code")}
          </a>
          <span dir="ltr">Ahmed Ababtain</span>
        </span>
      </footer>
    </div>
  );
}
