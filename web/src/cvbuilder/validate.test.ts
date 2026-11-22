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
