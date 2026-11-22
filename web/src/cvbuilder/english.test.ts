import { test } from "node:test";
import assert from "node:assert/strict";

import { applyEnglish, arabicTexts } from "./english.ts";
import { toResume, start } from "./engine.ts";

const resume = toResume({
  ...start("scratch"),
  answers: { name: "Omar", field: "هندسة", skills: "Python, ج", langs: "عربي وانجليزي", certs: "شهادة AWS" },
});

test("every Arabic text left in the CV is found, once", () => {
  assert.deepEqual(arabicTexts(resume).sort(), ["ج", "شهادة AWS", "عربي وانجليزي", "هندسة"].sort());
});

test("English replaces them everywhere, and the rest is untouched", () => {
  const english = applyEnglish(resume, { "هندسة": "Engineering", "ج": "C", "عربي وانجليزي": "Arabic and English", "شهادة AWS": "AWS certificate" });
  assert.equal(english.personal.field, "Engineering");
  assert.equal(english.education.length, 0);
  assert.deepEqual(Object.values(english.skills).flat(), ["Python", "C"]);
  assert.deepEqual(english.languages, ["Arabic and English"]);
  assert.equal(english.certifications[0].name, "AWS certificate");
  assert.equal(english.personal.name, "Omar");
  assert.deepEqual(arabicTexts(english), []);
});

test("the short fields to polish, each with its kind, once", async () => {
  const { polishable } = await import("./english.ts");
  const items = polishable({
    ...resume,
    certifications: [{ name: "CAPM", issuer: "", date: "", url: "" }],
    languages: ["spinsh"],
    awards: ["first place hackathon"],
  });
  assert.deepEqual(items.find((item) => item.text === "CAPM"), { text: "CAPM", kind: "cert" });
  assert.deepEqual(items.find((item) => item.text === "spinsh"), { text: "spinsh", kind: "langs" });
  assert.ok(items.some((item) => item.text === "first place hackathon" && item.kind === "text"));
  assert.ok(!items.some((item) => item.text === "Omar"));
  assert.equal(new Set(items.map((item) => item.text)).size, items.length);
});

test("after the polish, skills are split and sorted, and certificates one per line", async () => {
  const { regroup } = await import("./english.ts");
  const polished = applyEnglish(
    { ...resume, skills: { "Other skills": ["python teamwork"] }, certifications: [{ name: "capm ecba", issuer: "", date: "", url: "" }] },
    {
      "python teamwork": "Python, Teamwork",
      "capm ecba": "Certified Associate in Project Management (CAPM), PMI | Entry Certificate in Business Analysis (ECBA), IIBA",
    },
  );
  const done = regroup(polished, (skill) => ({ name: skill, category: skill === "Python" ? "Programming languages" : "Soft skills" }));
  assert.deepEqual(done.skills, { "Programming languages": ["Python"], "Soft skills": ["Teamwork"] });
  assert.deepEqual(done.certifications.map((cert) => cert.name), [
    "Certified Associate in Project Management (CAPM), PMI",
    "Entry Certificate in Business Analysis (ECBA), IIBA",
  ]);
});

test("regroup files each skill by the catalog, then by the writer's categories, and drops headings", async () => {
  const { regroup } = await import("./english.ts");
  const typed = { ...resume, skills: { "Other skills": ["Problem-Solving, Technical Skills, Document Preparation, Python, Skills"] } };
  const done = regroup(typed, (skill) => ({ Python: { name: "Python", category: "Programming languages" }, "Problem-Solving": { name: "Problem Solving", category: "Soft skills" } })[skill] ?? null, { "Document Preparation": "Tools" });
  assert.deepEqual(done.skills, { "Soft skills": ["Problem Solving"], Tools: ["Document Preparation"], "Programming languages": ["Python"] });
});
