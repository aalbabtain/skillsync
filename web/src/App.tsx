import { useEffect, useState } from "react";

import { getHealth } from "./api";
import type { RequirementsResult, Skill, SkillsResult } from "./api";
import GapPanel from "./components/GapPanel";
import Landing from "./components/Landing";
import Logo from "./components/Logo";
import PostingsPanel from "./components/PostingsPanel";
import SkillsPanel from "./components/SkillsPanel";
import Stepper from "./components/Stepper";
import type { StepId } from "./components/Stepper";
import UploadPanel from "./components/UploadPanel";
import { useI18n } from "./i18n";

type View = "landing" | "service";
type Step = "cv" | "skills" | "postings" | "gap";

export default function App() {
  const { t, lang, setLang } = useI18n();
  const [view, setView] = useState<View>("landing");
  const [step, setStep] = useState<Step>("cv");
  const [extraction, setExtraction] = useState<SkillsResult | null>(null);
  const [skillsKey, setSkillsKey] = useState(0);
  const [confirmed, setConfirmed] = useState<Skill[]>([]);
  const [extractor, setExtractor] = useState("");
  const demoMode = extractor === "mock";
  const [requirements, setRequirements] = useState<RequirementsResult | null>(null);
  const [postingTitles, setPostingTitles] = useState<string[]>([]);

  useEffect(() => {
    let active = true;

    getHealth()
      .then((health) => {
        if (active) setExtractor(health.extractor);
      })
      .catch(() => {
        if (active) setExtractor("");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view, step]);

  const reachable: StepId[] = ["cv"];
  if (extraction) reachable.push("skills");
  if (confirmed.length > 0) reachable.push("postings");
  if (confirmed.length > 0 && requirements) reachable.push("gap");

  return (
    <div className="page">
      <header className="site-head">
        <div className="wrap head-inner">
          <a
            className="brand"
            href="/"
            aria-label={t("home_label")}
            onClick={(event) => {
              event.preventDefault();
              setView("landing");
            }}
          >
            <Logo />
          </a>
          <nav className="head-nav">
            {view === "landing" && (
              <>
                <a className="head-link" href="#how">
                  {t("nav_how")}
                </a>
                <a className="head-link" href="#who">
                  {t("nav_who")}
                </a>
              </>
            )}
            <button
              className="lang-btn"
              onClick={() => setLang(lang === "ar" ? "en" : "ar")}
              aria-label={t("lang_switch_label")}
              lang={lang === "ar" ? "en" : "ar"}
            >
              {t("lang_switch")}
            </button>
          </nav>
        </div>
      </header>

      {demoMode && (
        <div className="wrap">
          <p className="demo-note" role="status">
            <strong>{t("demo_title")}</strong> {t("demo_body")}
          </p>
        </div>
      )}

      {view === "landing" ? (
        <Landing onStart={() => setView("service")} />
      ) : (
        <main className="service">
          <Stepper
            current={step}
            reachable={reachable}
            soon={["plan"]}
            onSelect={(target) => {
              if (target !== "plan") {
                setStep(target);
              }
            }}
          />

          <div className="wrap">
            <section className="panel" aria-labelledby="upload-title" hidden={step !== "cv"}>
              <h2 id="upload-title">{t("upload_h")}</h2>
              {extractor === "gemini" && <p className="privacy-note">{t("privacy_gemini")}</p>}
              <UploadPanel
                onSkills={(result) => {
                  setExtraction(result);
                  setSkillsKey((key) => key + 1);
                  setConfirmed([]);
                  setRequirements(null);
                  setStep("skills");
                }}
              />
            </section>

            {extraction && (
              <section className="panel" aria-labelledby="skills-title" hidden={step !== "skills"}>
                <SkillsPanel
                  key={skillsKey}
                  initial={extraction.skills}
                  droppedCount={extraction.dropped_count}
                  onBack={() => setStep("cv")}
                  onConfirm={(skills) => {
                    setConfirmed(skills);
                    setStep("postings");
                  }}
                />
              </section>
            )}

            <section
              className="panel"
              aria-labelledby="postings-title"
              hidden={step !== "postings"}
            >
              {confirmed.length > 0 && (
                <PostingsPanel
                  confirmedCount={confirmed.length}
                  onBack={() => setStep("skills")}
                  onResult={(result, titles) => {
                    setRequirements(result);
                    setPostingTitles(titles);
                  }}
                  onNext={() => setStep("gap")}
                />
              )}
            </section>

            {step === "gap" && requirements && (
              <section className="panel" aria-labelledby="gap-title">
                <GapPanel
                  skills={confirmed}
                  requirements={requirements}
                  postingTitles={postingTitles}
                  onBack={() => setStep("postings")}
                />
              </section>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
