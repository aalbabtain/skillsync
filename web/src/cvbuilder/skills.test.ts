import { test } from "node:test";
import assert from "node:assert/strict";

import { suggestSkills } from "./skills.ts";

const CATALOG = [
  { name: "Python", aliases: ["python", "بايثون"] },
  { name: "FastAPI", aliases: ["fastapi", "fast api"] },
  { name: "Go", aliases: ["golang"] },
  { name: "React", aliases: ["react", "reactjs"] },
];

test("skills come from the tools named and the catalog skills in the descriptions", () => {
  const found = suggestSkills(["FastAPI, Jira", "built the API in python and fast api", "we go to the office"], CATALOG);
  assert.deepEqual(found, ["FastAPI", "Jira", "Python"]);
});

test("a short skill name counts only when written as a name", () => {
  assert.deepEqual(suggestSkills(["", "wrote services in Go"], CATALOG), ["Go"]);
});

test("skills typed without commas are split when every word is a known skill", async () => {
  const { splitSkills } = await import("./skills.ts");
  const catalog = [...CATALOG, { name: "Teamwork", aliases: ["teamwork", "team work"] }, { name: "Machine Learning", aliases: ["machine learning", "ml"] }, { name: "Public Speaking", aliases: ["public speaking"] }];
  assert.deepEqual(splitSkills("python teamwork", catalog), ["Python", "Teamwork"]);
  assert.deepEqual(splitSkills("machine learning python", catalog), ["Machine Learning", "Python"]);
  assert.deepEqual(splitSkills("Python, team work, public speaking", catalog), ["Python", "team work", "public speaking"]);
  assert.deepEqual(splitSkills("data entry in excel", catalog), ["data entry in excel"]);
});
