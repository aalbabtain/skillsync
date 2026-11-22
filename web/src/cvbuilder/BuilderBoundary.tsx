import { Component } from "react";
import type { ReactNode } from "react";

import { useI18n } from "../i18n";

const STORAGE_KEY = "skillsync-cv";

function Recovered({ onRestart }: { onRestart: () => void }) {
  const { t } = useI18n();
  return (
    <main className="cvb wrap">
      <section className="cvb-welcome" role="alert">
        <h2>{t("cvb_title")}</h2>
        <p className="cvb-lead">{t("cvb_crashed")}</p>
        <button className="btn btn-primary" type="button" onClick={onRestart}>
          {t("cvb_restart")}
        </button>
      </section>
    </main>
  );
}

/**
 * If the builder ever fails to render (for example, answers saved by an older version), the
 * saved answers are cleared and the person gets a way to start again, never a blank page.
 */
export default class BuilderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing saved, or storage blocked: starting again still works.
    }
  }

  render() {
    if (this.state.failed) return <Recovered onRestart={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}
