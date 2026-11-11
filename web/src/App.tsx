import { useEffect, useState } from "react";

import { getHealth } from "./api";
import type { Skill, SkillsResult } from "./api";
import Logo from "./components/Logo";
import SkillsPanel from "./components/SkillsPanel";
import UploadPanel from "./components/UploadPanel";

const agents = [
  {
    step: 1,
    name: "CV & Fit Assessor",
    detail: "Verifies claimed skills, then screens postings for fit.",
  },
  {
    step: 2,
    name: "Requirements Extractor",
    detail: "Pulls required skills from the matched postings.",
  },
  {
    step: 3,
    name: "Gap Evaluator",
    detail: "Computes what you have against what is required.",
  },
  {
    step: 4,
    name: "Plan Builder",
    detail: "Drafts a prioritized plan to close the gap.",
  },
];

type Step = "cv" | "skills" | "postings";

export default function App() {
  const [step, setStep] = useState<Step>("cv");
  const [extraction, setExtraction] = useState<SkillsResult | null>(null);
  const [skillsKey, setSkillsKey] = useState(0);
  const [confirmed, setConfirmed] = useState<Skill[]>([]);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    let active = true;

    getHealth()
      .then((health) => {
        if (active) setDemoMode(health.extractor === "mock");
      })
      .catch(() => {
        if (active) setDemoMode(false);
      });

    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="page">
      <header className="site-head">
        <div className="wrap head-inner">
          <a className="brand" href="/" aria-label="SkillSync, back to top">
            <Logo />
          </a>
          <span className="badge">Scaffold</span>
        </div>
      </header>

        {demoMode && (
          <p className="demo-note" role="status">
            <strong>Demo mode.</strong> No Gemini key is configured, so skills are matched from a
            built-in list instead of the model.
          </p>
        )}

      <main className="wrap">
        <section className="hero">
          <p className="eyebrow">SWE 485 · Course project</p>
          <h1>Align your skills with the job market.</h1>
          <p className="lead">
            Upload your CV. SkillSync verifies what you can prove, compares it with real job
            postings, and builds a learning plan for the gap.
          </p>
        </section>

        <section className="panel" aria-labelledby="upload-title" hidden={step !== "cv"}>
          <h2 id="upload-title">Start with your CV</h2>
          <UploadPanel
            onSkills={(result) => {
              setExtraction(result);
              setSkillsKey((key) => key + 1);
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

        {step === "postings" && (
          <section className="panel" aria-labelledby="postings-title">
            <p className="eyebrow">Next step</p>
            <h2 id="postings-title">Job postings</h2>
            <p className="lead">
              {confirmed.length} {confirmed.length === 1 ? "skill" : "skills"} confirmed. Posting
              screening against these skills comes next.
            </p>
            <div className="skills-actions">
              <button className="btn btn-ghost" onClick={() => setStep("skills")}>
                Back
              </button>
            </div>
          </section>
        )}

        <section className="panel" aria-labelledby="pipeline-title">
          <h2 id="pipeline-title">The pipeline</h2>
          <ol className="pipeline">
            {agents.map((agent) => (
              <li className="step" key={agent.step}>
                <span className="step-n">Agent {agent.step}</span>
                <h3>{agent.name}</h3>
                <p>{agent.detail}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="site-foot wrap">
        <span>SkillSync · Ahmed Ababtain</span>
      </footer>
    </div>
  );
}
