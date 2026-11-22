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
