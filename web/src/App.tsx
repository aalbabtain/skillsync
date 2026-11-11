import Logo from "./components/Logo";

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

export default function App() {
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

      <main className="wrap">
        <section className="hero">
          <p className="eyebrow">SWE 485 · Course project</p>
          <h1>Align your skills with the job market.</h1>
          <p className="lead">
            Upload your CV. SkillSync verifies what you can prove, compares it with real job
            postings, and builds a learning plan for the gap.
          </p>
        </section>

        <section className="panel" aria-labelledby="upload-title">
          <h2 id="upload-title">Start with your CV</h2>
          <div className="dropzone">
            <p className="dropzone-title">PDF upload</p>
            <p className="dropzone-hint">
              Coming in the next step — PDF only, up to 5 MB. Nothing is stored after the run.
            </p>
          </div>
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
