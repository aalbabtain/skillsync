import { useI18n } from "../i18n";
import Logo from "./Logo";

type Props = {
  onStart: () => void;
};

const SAMPLE = [
  { name: "Python", quote: "Built the SkillSync pipeline in Python and FastAPI" },
  { name: "PostgreSQL", quote: "صممتُ قاعدة بيانات PostgreSQL لنظام الحجوزات" },
];

export default function Landing({ onStart }: Props) {
  const { t } = useI18n();

  const steps = [
    { title: t("s1_h"), body: t("s1") },
    { title: t("s2_h"), body: t("s2") },
    { title: t("s3_h"), body: t("s3") },
    { title: t("s4_h"), body: t("s4") },
  ];

  const audiences = [
    { title: t("w1_h"), body: t("w1") },
    { title: t("w2_h"), body: t("w2") },
    { title: t("w3_h"), body: t("w3") },
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
          {SAMPLE.map((item) => (
            <div className="proof-row" key={item.name}>
              <div className="proof-top">
                <strong dir="ltr">{item.name}</strong>
                <span className="tag tag-ok">{t("verified")}</span>
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
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className="step-n">{t("step_n", { n: index + 1 })}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="wrap band" id="who" aria-labelledby="who-title">
        <h2 id="who-title">{t("who_h")}</h2>
        <ul className="who-grid">
          {audiences.map((item) => (
            <li key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
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
          <a className="foot-link" href="https://github.com/aalbabtain/skillsync" target="_blank" rel="noreferrer">
            {t("source_code")}
          </a>
          <span dir="ltr">Ahmed Ababtain</span>
        </span>
      </footer>
    </div>
  );
}
