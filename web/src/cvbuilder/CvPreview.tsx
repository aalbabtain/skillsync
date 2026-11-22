import type { ReactNode } from "react";

import type { Resume } from "./types";
import { hasArabic } from "./validate";

type Props = {
  resume: Resume;
  // The answer being typed: shown in the page before it is sent, marked as live.
  live?: string;
  // Lines being written or just written: marked as fresh.
  fresh?: string[];
  // Shown inside the page when Arabic text waits for its English form.
  translatingLabel: string;
};

/**
 * The CV as it will print: always English and left to right, in the owner's reference layout
 * (centred name, one contact line, ruled headings, dates at the end of each title line). It is
 * also the PDF: printing the page shows this element alone.
 */
export default function CvPreview({ resume, live, fresh = [], translatingLabel }: Props) {
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

      <h3 className="cv-h">Professional Summary</h3>
      {resume.summary ? <p>{mark(resume.summary)}</p> : <p className="cv-empty">…</p>}

      {resume.experience.length > 0 && (
        <>
          <h3 className="cv-h">Experience</h3>
          {resume.experience.map((job, index) => (
            <div key={index}>
              <TitleRow title={mark([job.title, job.company].filter(Boolean).join(", "))} dates={dates(job.start, job.end)} />
              {job.role_line && <p className="cv-role">{mark(job.role_line)}</p>}
              <Bullets lines={job.bullets} mark={mark} />
            </div>
          ))}
        </>
      )}

      <h3 className="cv-h">Education</h3>
      {resume.education.length ? (
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

      <h3 className="cv-h">Projects</h3>
      {resume.projects.length ? (
        resume.projects.map((project, index) => (
          <div key={index}>
            <TitleRow title={mark(project.name)} link={bare(project.url)} dates={dates(project.start, project.end)} />
            {project.role_line && <p className="cv-role">{mark(project.role_line)}</p>}
            <Bullets lines={project.bullets} mark={mark} />
          </div>
        ))
      ) : (
        <p className="cv-empty">…</p>
      )}

      <h3 className="cv-h">Technical Skills</h3>
      {skills.length ? (
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
          <h3 className="cv-h">Certifications</h3>
          {resume.certifications.map((cert, index) => (
            <p key={index}>{mark(cert.name)}</p>
          ))}
        </>
      )}
      {resume.languages.length > 0 && (
        <>
          <h3 className="cv-h">Languages</h3>
          <p>{mark(resume.languages.join(", "))}</p>
        </>
      )}
      {resume.volunteering.length > 0 && (
        <>
          <h3 className="cv-h">Volunteering</h3>
          <Bullets lines={resume.volunteering} mark={mark} />
        </>
      )}
      {resume.awards.length > 0 && (
        <>
          <h3 className="cv-h">Awards</h3>
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
