import type { ReactNode } from "react";

import type { Resume } from "./types";
import { splitDates } from "./english";
import { hasArabic } from "./validate";

type Props = {
  resume: Resume;
  // The answer being typed: shown in the page before it is sent, marked as live.
  live?: string;
  // Lines being written or just written: marked as fresh.
  fresh?: string[];
  // Shown inside the page when Arabic text waits for its English form.
  translatingLabel: string;
  // What the model is writing and has not sent a line for yet: a placeholder shows there.
  writing?: "summary" | "job" | "project";
  // The finished CV: sections with nothing in them are left out, as in the Word file.
  final?: boolean;
};

/**
 * The CV as it will print: always English and left to right, in the owner's reference layout
 * (centred name, one contact line, ruled headings, dates at the end of each title line). It is
 * also the PDF: printing the page shows this element alone.
 */
export default function CvPreview({ resume, live, fresh = [], translatingLabel, writing, final = false }: Props) {
  const pending = <span className="cv-pending">Writing…</span>;
  const mark = (text: string): ReactNode => {
    let node: ReactNode = text;
    if (hasArabic(text)) {
      node = (
        <span className="cv-tr" dir="rtl" lang="ar" title={translatingLabel}>
          {text}
        </span>
      );
    }
    if (live && text === live.trim()) return <span className="cv-live">{node}</span>;
    if (fresh.includes(text)) return <span className="cv-fresh">{node}</span>;
    return node;
  };
  const empty = (text: string) => <span className="cv-empty">{text}</span>;
  const p = resume.personal;
  const c = resume.contact;
  const contact = [c.location, c.phone, c.email, bare(c.linkedin), bare(c.github)].filter(Boolean);
  const skills = Object.entries(resume.skills).filter(([, items]) => items.length);
  const title = p.target_title || p.field;

  return (
    <article className="cv-paper" dir="ltr" lang="en" aria-label="CV">
      <p className="cv-name">{p.name ? mark(p.name) : empty("[Your name]")}</p>
      {title && <p className="cv-title">{mark(title)}</p>}
      <p className="cv-contact">
        {contact.length
          ? contact.map((part, index) => (
              <span key={index}>
                {index > 0 && " | "}
                {mark(part)}
              </span>
            ))
          : empty("[Email | Phone | City]")}
      </p>

      {(!final || resume.summary) && <h4 className="cv-h">Professional Summary</h4>}
      {final && !resume.summary ? null : resume.summary ? <p>{mark(resume.summary)}</p> : writing === "summary" ? <p>{pending}</p> : <p className="cv-empty">…</p>}

      {resume.experience.length > 0 && (
        <>
          <h4 className="cv-h">Experience</h4>
          {resume.experience.map((job, index) => (
            <div key={index}>
              <TitleRow title={mark([job.title, job.company].filter(Boolean).join(", "))} dates={dates(job.start, job.end)} />
              {job.role_line && <p className="cv-role">{mark(job.role_line)}</p>}
              <Bullets lines={job.bullets} mark={mark} />
              {writing === "job" && index === resume.experience.length - 1 && !job.bullets.length && <ul><li>{pending}</li></ul>}
            </div>
          ))}
        </>
      )}

      {(!final || resume.education.length > 0) && <h4 className="cv-h">Education</h4>}
      {final && !resume.education.length ? null : resume.education.length ? (
        resume.education.map((school, index) => (
          <div key={index}>
            <TitleRow title={mark(school.institution)} dates={school.end} />
            {(school.degree || school.major || school.gpa) && (
              <p>
                {school.degree && mark(school.degree)}
                {school.major && <> in {mark(school.major)}</>}
                {school.gpa && <> | GPA: {school.gpa}</>}
              </p>
            )}
          </div>
        ))
      ) : (
        <p className="cv-empty">…</p>
      )}

      {(!final || resume.projects.length > 0) && <h4 className="cv-h">Projects</h4>}
      {final && !resume.projects.length ? null : resume.projects.length ? (
        resume.projects.map((project, index) => (
          <div key={index}>
            <TitleRow title={mark(project.name)} link={bare(project.url)} dates={dates(project.start, project.end)} />
            {project.role_line && <p className="cv-role">{mark(project.role_line)}</p>}
            <Bullets lines={project.bullets} mark={mark} />
            {writing === "project" && index === resume.projects.length - 1 && !project.bullets.length && <ul><li>{pending}</li></ul>}
          </div>
        ))
      ) : (
        <p className="cv-empty">…</p>
      )}

      {(!final || skills.length > 0) && <h4 className="cv-h">Technical Skills</h4>}
      {final && !skills.length ? null : skills.length ? (
        skills.map(([category, items]) => (
          <p key={category}>
            <b>{category}:</b> {mark(items.join(", "))}
          </p>
        ))
      ) : (
        <p className="cv-empty">…</p>
      )}

      {resume.certifications.length > 0 && (
        <>
          <h4 className="cv-h">Certifications</h4>
          {resume.certifications.map((cert, index) => (
            <p key={index}>{mark(cert.name)}</p>
          ))}
        </>
      )}
      {resume.languages.length > 0 && (
        <>
          <h4 className="cv-h">Languages</h4>
          <p>{mark(resume.languages.join(", "))}</p>
        </>
      )}
      {resume.volunteering.length > 0 && (
        <>
          <h4 className="cv-h">Volunteering</h4>
          <Bullets lines={resume.volunteering} mark={mark} />
        </>
      )}
      {resume.activities.length > 0 && (
        <>
          <h4 className="cv-h">Activities &amp; Memberships</h4>
          {resume.activities.map((line, index) => {
            const [title, dates] = splitDates(line);
            return <TitleRow key={index} title={mark(title)} dates={dates} />;
          })}
        </>
      )}
      {resume.awards.length > 0 && (
        <>
          <h4 className="cv-h">Awards</h4>
          <Bullets lines={resume.awards} mark={mark} />
        </>
      )}
    </article>
  );
}

function TitleRow({ title, link, dates }: { title: ReactNode; link?: string; dates?: string }) {
  return (
    <p className="cv-row">
      <span>
        <b>{title}</b>
        {link && <> | {link}</>}
      </span>
      {dates && <span>{dates}</span>}
    </p>
  );
}

function Bullets({ lines, mark }: { lines: string[]; mark: (text: string) => ReactNode }) {
  if (!lines.length) return null;
  return (
    <ul>
      {lines.map((line, index) => (
        <li key={index}>{mark(line)}</li>
      ))}
    </ul>
  );
}

function bare(link: string): string {
  return link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

function dates(start: string, end: string): string {
  return [start, end].filter(Boolean).join(" – ");
}
