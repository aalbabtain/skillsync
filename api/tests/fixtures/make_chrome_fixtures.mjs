// Regenerates the CV fixtures that are printed by Chrome, the same engine behind
// "Save as PDF" in the browser and Google Docs exports. Dev-only; the PDFs are committed.
//
//   node api/tests/fixtures/make_chrome_fixtures.mjs
//
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
// Every name, employer and detail below is fictional.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const CASES = join(dirname(fileURLToPath(import.meta.url)), "cases");

const style = `
  body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 12pt; line-height: 1.5; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  h2 { font-size: 12pt; margin: 14pt 0 4pt; text-transform: uppercase; letter-spacing: 1pt; }
  p, li { margin: 2pt 0; }
  ul { padding-inline-start: 18pt; margin: 0; }
  .page-break { break-before: page; }
`;

const cv = (dir, body) =>
  `<!doctype html><html dir="${dir}" lang="${dir === "rtl" ? "ar" : "en"}"><head>
   <meta charset="utf-8"><style>${style}</style></head><body>${body}</body></html>`;

const CVS = {
  data_analyst_en: cv(
    "ltr",
    `<h1>Layla Alzahrani</h1>
     <p>Data Analyst, Jeddah</p>
     <h2>Summary</h2>
     <p>Data analyst with three years of experience turning sales data into weekly dashboards.</p>
     <h2>Experience</h2>
     <p>Data Analyst, retail company (2023 - present)</p>
     <ul>
       <li>Built weekly sales dashboards in Power BI for the regional managers.</li>
       <li>Cleaned and joined order data with SQL and Python (Pandas).</li>
       <li>Automated a monthly forecast report in Excel.</li>
     </ul>
     <h2>Projects</h2>
     <ul><li>Customer churn model with scikit-learn, shared with the analytics team.</li></ul>
     <h2>Skills</h2>
     <p>Python, SQL, Pandas, NumPy, Power BI, Excel, Git</p>`,
  ),

  career_changer_en: cv(
    "ltr",
    `<h1>Faisal Alotaibi</h1>
     <p>Accountant moving into data analysis</p>
     <h2>Experience</h2>
     <p>Senior Accountant, logistics company (2019 - present)</p>
     <ul>
       <li>Prepared monthly financial statements and reconciliations in Excel.</li>
       <li>Led a team of four accountants during the year-end close.</li>
       <li>Walked the finance director through budget variance reports every month.</li>
     </ul>
     <h2>Learning</h2>
     <ul><li>Completed an online course in SQL and wrote practice queries on sample sales data.</li></ul>
     <h2>Skills</h2>
     <p>Excel, SQL, Leadership, Communication, Time Management</p>`,
  ),

  traps_en: cv(
    "ltr",
    `<h1>Yousef Alghamdi</h1>
     <p>Junior Web Developer</p>
     <h2>Experience</h2>
     <ul>
       <li>Built a booking website in PHP and MySQL for a local clinic.</li>
       <li>Wrote unit tests and fixed bugs reported by the clinic staff.</li>
     </ul>
     <h2>Goals</h2>
     <ul>
       <li>I want to learn Kubernetes and Docker next year.</li>
       <li>My team lead uses AWS, but I have not worked with it yet.</li>
     </ul>
     <h2>Skills</h2>
     <p>PHP, MySQL, HTML, CSS, Git</p>`,
  ),

  frontend_mixed: cv(
    "rtl",
    `<h1>نورة الشهري</h1>
     <p>مطورة واجهات أمامية - Frontend Developer</p>
     <h2>المهارات</h2>
     <p>React, TypeScript, Next.js, Tailwind CSS</p>
     <h2>المشاريع</h2>
     <ul>
       <li>بنيت لوحة تحكم لمتجر إلكتروني باستخدام React و TypeScript</li>
       <li>صممت الواجهات في Figma وتابعت المهام في Jira</li>
     </ul>
     <h2>الأدوات</h2>
     <p>Git, Figma, Jira</p>
     <p>العمل الجماعي مع فريق التصميم</p>`,
  ),

  senior_arabic: cv(
    "rtl",
    `<h1>خالد الدوسري</h1>
     <p>مهندس برمجيات أول - الرياض</p>
     <h2>الخبرات</h2>
     <ul>
       <li>قائد فريق الخدمات الخلفية في شركة تقنية مالية منذ 2020</li>
       <li>بنيت واجهات برمجية باستخدام Java و Spring Boot</li>
       <li>نقلت الخدمات إلى Docker و Kubernetes على AWS</li>
     </ul>
     <div class="page-break"></div>
     <h2>المهارات</h2>
     <p>Java, Spring Boot, PostgreSQL, Redis, Kafka</p>
     <p>القيادة</p>
     <h2>التعليم</h2>
     <p>بكالوريوس هندسة البرمجيات</p>`,
  ),
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, html] of Object.entries(CVS)) {
  await page.setContent(html);
  await page.pdf({
    path: join(CASES, `${name}.pdf`),
    format: "A4",
    margin: { top: "18mm", bottom: "18mm", left: "18mm", right: "18mm" },
  });
  console.log("wrote", `${name}.pdf`);
}
await browser.close();
