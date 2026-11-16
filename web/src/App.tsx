import { CircleHelp, Users, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getHealth } from "./api";
import type { RequirementsResult, Skill, SkillsResult } from "./api";
import GapPanel from "./components/GapPanel";
import Landing from "./components/Landing";
import LanguageMenu from "./components/LanguageMenu";
import Logo from "./components/Logo";
import PostingsPanel from "./components/PostingsPanel";
import SkillsPanel from "./components/SkillsPanel";
import type { Entry } from "./components/SkillsPanel";
import Stepper from "./components/Stepper";
import type { StepId } from "./components/Stepper";
import UploadPanel from "./components/UploadPanel";
import { useI18n } from "./i18n";

type Step = "cv" | "skills" | "postings" | "gap";

const STEPS: Step[] = ["cv", "skills", "postings", "gap"];

type Route = { view: "landing"; anchor: string } | { view: "service"; step: Step };

// The address is the source of truth, so Back, Forward and refresh behave as expected.
function readRoute(): Route {
  const hash = window.location.hash.slice(1);
  if ((STEPS as string[]).includes(hash)) return { view: "service", step: hash as Step };
  return { view: "landing", anchor: hash };
}

function navigate(hash: string) {
  if (hash) {
    window.location.hash = hash;
    return;
  }
  window.history.pushState(null, "", window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export default function App() {
  const { t } = useI18n();
  const [route, setRoute] = useState<Route>(readRoute);
  const [extraction, setExtraction] = useState<SkillsResult | null>(null);
  // One list for the skills page and the gap page, so a skill added on either shows on both.
  const [entries, setEntries] = useState<Entry[]>([]);
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
    const sync = () => setRoute(readRoute());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const reachable: StepId[] = ["cv"];
  if (extraction) reachable.push("skills");
  if (confirmed.length > 0) reachable.push("postings");
  if (confirmed.length > 0 && requirements) reachable.push("gap");

  const view = route.view;
  // A step that is not open yet (after a refresh, or a new CV) falls back to the last open one.
  let step: Step = route.view === "service" ? route.step : "cv";
  while (!reachable.includes(step)) step = STEPS[STEPS.indexOf(step) - 1];
  const anchor = route.view === "landing" ? route.anchor : "";

  useEffect(() => {
    if (route.view === "service" && route.step !== step) {
      window.history.replaceState(null, "", `#${step}`);
      setRoute({ view: "service", step });
    }
  }, [route, step]);

  useEffect(() => {
    const target = anchor ? document.getElementById(anchor) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo({ top: 0 });
  }, [view, step, anchor]);

  const goTo = (target: Step) => navigate(target);

  // Forward or back, so the next panel slides in from the side the visitor is heading to.
  const lastStep = useRef<Step>(step);
  const direction = STEPS.indexOf(step) >= STEPS.indexOf(lastStep.current) ? "forward" : "back";
  useEffect(() => {
    lastStep.current = step;
  }, [step]);

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
              navigate("");
            }}
          >
            <Logo animated />
          </a>
          <nav className="head-nav">
            {view === "landing" && (
              <>
                <a className="head-link" href="#how">
                  <Workflow size={16} aria-hidden="true" />
                  {t("nav_how")}
                </a>
                <a className="head-link" href="#who">
                  <Users size={16} aria-hidden="true" />
                  {t("nav_who")}
                </a>
                <a className="head-link" href="#faq">
                  <CircleHelp size={16} aria-hidden="true" />
                  {t("nav_faq")}
                </a>
              </>
            )}
            <LanguageMenu />
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
        <Landing onStart={() => goTo("cv")} />
      ) : (
        <main className="service">
          <Stepper
            current={step}
            reachable={reachable}
            soon={["plan"]}
            onSelect={(target) => {
              if (target !== "plan") goTo(target);
            }}
          />

          <div className="wrap step-stage" data-direction={direction}>
            <section className="panel" aria-labelledby="upload-title" hidden={step !== "cv"}>
              <h2 id="upload-title">{t("upload_h")}</h2>
              {extractor === "gemini" && <p className="privacy-note">{t("privacy_gemini")}</p>}
              <UploadPanel
                onSkills={(result) => {
                  setExtraction(result);
                  setEntries(result.skills.map((skill) => ({ ...skill, source: "verified" })));
                  setConfirmed([]);
                  setRequirements(null);
                  goTo("skills");
                }}
              />
            </section>

            {extraction && (
              <section className="panel" aria-labelledby="skills-title" hidden={step !== "skills"}>
                <SkillsPanel
                  entries={entries}
                  onEntriesChange={setEntries}
                  droppedCount={extraction.dropped_count}
                  onBack={() => goTo("cv")}
                  onConfirm={(skills) => {
                    setConfirmed(skills);
                    goTo("postings");
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
                  onBack={() => goTo("skills")}
                  onResult={(result, titles) => {
                    setRequirements(result);
                    setPostingTitles(titles);
                  }}
                  onNext={() => goTo("gap")}
                />
              )}
            </section>

            {step === "gap" && requirements && (
              <section className="panel" aria-labelledby="gap-title">
                <GapPanel
                  skills={confirmed}
                  requirements={requirements}
                  postingTitles={postingTitles}
                  onBack={() => goTo("postings")}
                  onClaim={(item) => {
                    const added: Entry = { name: item.name, category: item.category, evidence: "", source: "user" };
                    setEntries((current) => [...current, added]);
                    setConfirmed((current) => [...current, { ...added, verified: false }]);
                  }}
                  onUnclaim={(name) => {
                    const isHandAdded = (skill: { name: string; evidence: string }) =>
                      skill.name === name && !skill.evidence;
                    setEntries((current) => current.filter((entry) => !isHandAdded(entry)));
                    setConfirmed((current) => current.filter((skill) => !isHandAdded(skill)));
                  }}
                />
              </section>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
