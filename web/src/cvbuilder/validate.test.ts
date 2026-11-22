import { test } from "node:test";
import assert from "node:assert/strict";

import { isSkipWord, validate } from "./validate.ts";

test("date accepts Jun 2027 and Present, refuses next summer", () => {
  assert.equal(validate("date", "Jun 2027"), "");
  assert.equal(validate("date", "present"), "");
  assert.equal(validate("date", "Jun ٢٠٢٧"), "");
  assert.equal(validate("date", "next summer"), "date");
});

test("gpa accepts 4.6/5 and 3.2, refuses 6/5", () => {
  assert.equal(validate("gpa", "4.6/5"), "");
  assert.equal(validate("gpa", "3.2"), "");
  assert.equal(validate("gpa", "٤.٦ / ٥"), "");
  assert.equal(validate("gpa", "6/5"), "gpa");
});

test("email, phone and https links", () => {
  assert.equal(validate("email", "sara@example.com"), "");
  assert.equal(validate("email", "sara at example"), "email");
  assert.equal(validate("phone", "+966 50 000 0000"), "");
  assert.equal(validate("phone", "call me"), "phone");
  assert.equal(validate("url", "https://linkedin.com/in/sara"), "");
  assert.equal(validate("url", "linkedin.com/in/sara"), "url");
});

test("names in Latin letters only, empty answers refused", () => {
  assert.equal(validate("latin", "Sara Alharbi"), "");
  assert.equal(validate("latin", "سارة"), "latin");
  assert.equal(validate("text", "  "), "empty");
});

test("skip words", () => {
  for (const word of ["skip", "Skip", "تخطي", "تخطى", "-"]) assert.ok(isSkipWord(word), word);
  assert.ok(!isSkipWord("skipped a year"));
});

test("dates are read loosely and stored as Mmm YYYY", async () => {
  const { normalizeDate } = await import("./validate.ts");
  assert.equal(normalizeDate("june 2027"), "Jun 2027");
  assert.equal(normalizeDate("Jun 2027"), "Jun 2027");
  assert.equal(normalizeDate("06/2027"), "Jun 2027");
  assert.equal(normalizeDate("2027-6"), "Jun 2027");
  assert.equal(normalizeDate("يونيو ٢٠٢٧"), "Jun 2027");
  assert.equal(normalizeDate("سبتمبر 2025"), "Sep 2025");
  assert.equal(normalizeDate("present"), "Present");
  assert.equal(normalizeDate("حتى الآن"), "Present");
  assert.equal(normalizeDate("next summer"), null);
  assert.equal(normalizeDate("13/2027"), null);
  assert.equal(validate("date", "june 2027"), "");
});

test("a range of dates, from and to", async () => {
  const { normalizeRange } = await import("./validate.ts");
  assert.equal(normalizeRange("Mar 2025 - Present"), "Mar 2025 – Present");
  assert.equal(normalizeRange("مارس 2025 إلى أغسطس 2025"), "Mar 2025 – Aug 2025");
  assert.equal(normalizeRange("03/2025 to 08/2025"), "Mar 2025 – Aug 2025");
  assert.equal(normalizeRange("Aug 2025 - Mar 2025"), null);
  assert.equal(normalizeRange("Mar 2025"), null);
});
