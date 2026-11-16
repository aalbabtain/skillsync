import { useEffect, useState } from "react";

import { getHealth } from "./api";
import type { RequirementsResult, Skill, SkillsResult } from "./api";
import Logo from "./components/Logo";
import PostingsPanel from "./components/PostingsPanel";
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
    detail: "Pulls required skills from the postings you paste.",
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
  // Kept for Agent 3, which compares these with the confirmed skills.
  const [, setRequirements] = useState<RequirementsResult | null>(null);

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

        <section className="panel" aria-labelledby="postings-title" hidden={step !== "postings"}>
          {confirmed.length > 0 && (
            <PostingsPanel
              confirmedCount={confirmed.length}
              onBack={() => setStep("skills")}
              onResult={setRequirements}
            />
          )}
        </section>

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
