import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "en" | "ar";

const en = {
  lang_menu_label: "Language",
  home_label: "SkillSync, back to the home page",
  demo_title: "Demo mode.",
  demo_body:
    "No Gemini key is configured, so skills are matched from a built-in list instead of the model.",
  nav_how: "How it works",
  nav_who: "Who it's for",
  nav_faq: "Questions",
  preview_h: "What you'll see",
  faq_h: "Common questions",
  q1: "Is SkillSync free?",
  a1: "Yes. It is a university course project and free to use.",
  q2: "Do you keep my CV?",
  a2: "No. The file is read in memory, and its text is never saved or logged. When the AI model is on, the text is sent to Google Gemini for analysis. Visits are counted anonymously with GoatCounter, without cookies.",
  q3: "Which files can I upload?",
  a3: "PDF or Word (.docx), up to 5 MB, in Arabic, English or both. Scanned CVs saved as pictures cannot be read yet.",
  q4: "Where do the job postings come from?",
  a4: "You paste them: up to 10 postings you are interested in, from any job site. The more postings you add, the clearer it gets which skills the market asks for most.",
  q5: "Why was a skill from my CV left out?",
  a5: "SkillSync keeps a skill only when a line in your CV clearly shows it. If one was left out, add it by hand on the skills step. It will show as needing proof until your CV shows it.",
  foot_vision: "Aligned with the Human Capability Development Program, Saudi Vision 2030",
  foot_ksu: "King Saud University · 2026",

  eyebrow: "Skills, checked against the market",
  hero: "Know your skills.",
  hero_accent: "See what's missing.",
  lead:
    "Upload your CV and paste the job postings you are aiming for. SkillSync keeps only the skills your CV proves, finds what the postings ask for that you don't have yet, and builds a learning plan for the gap.",
  start: "Start with your CV",
  see_how: "See how it works",
  motion_pause: "Pause motion",
  motion_play: "Play motion",
  particles_cv: "Your CV",
  stat_checked: "CVs checked so far",
  stat_checked_one: "CV checked so far",
  how_label: "It starts with your CV",
  how_title: "Five steps from a CV to a plan.",
  how_note: "Every skill on your list comes with the line from your CV that proves it.",
  preview_label: "Where you meet the market",
  preview_note: "Your skills and the postings' skills overlap. What sits outside the overlap is the gap.",
  preview_example: "Example result from three postings",
  who_label: "For anyone with a CV",
  who_note: "Whatever stage you are at, the gap shows what to learn next.",
  faq_label: "Before you start",
  q0: "How do you know a skill is real?",
  a0: "Each skill needs a line from your CV that proves it. The AI suggests skills; plain code then checks every quote against your text and drops what it cannot find.",
  verified: "Verified",
  step_n: "Step {n}",
  s0: "Upload it as PDF or Word, in Arabic, English or both.",
  s1: "Every skill needs a quote from your CV, or it is dropped.",
  s2: "Pulls the skills each posting asks for and counts them.",
  s3: "Compares what you have with what is required.",
  s4: "Orders the gap by demand. The plan is final only when you approve it.",
  who_h: "Who it's for",
  w1_h: "Students and graduates",
  w1: "Find out what the market asks for before you apply.",
  w2_h: "Career changers",
  w2: "See how far your current skills take you in a new role.",
  w3_h: "Working professionals",
  w3: "Check what the next role up asks for that you haven't proven yet.",

  stepper_label: "Progress",
  st_cv: "Your CV",
  st_skills: "Your skills",
  st_postings: "Job postings",
  st_gap: "The gap",
  st_plan: "Your plan",
  st_soon: "Coming soon",

  upload_h: "Start with your CV",
  drop: "Drop your CV here",
  drop_hint: "PDF or Word (.docx), up to 5 MB and 10 pages.",
  privacy_gemini:
    "Your CV and the postings you paste are sent to Google Gemini for analysis. SkillSync does not store them or write them to its logs.",
  choose: "Choose a file",
  extracting_text: "Extracting text…",
  upload_meta: "Pages: {pages} · Characters: {chars}",
  extract_skills: "Extract skills",
  start_over: "Start over",
  retry: "Retry",
  stage_read: "Read your CV",
  stage_find: "Finding the skills it shows",
  stage_check: "Checking each quote against your CV",
  found_so_far: "Verified so far: {n}",

  skills_h: "Your verified skills",
  skills_count: "Verified: {verified} · Added by you: {self}",
  back: "Back",
  skills_dropped: "Skills removed for lack of evidence in your CV: {n}",
  skills_empty: "No skills left. Add one below, or go back and upload a different CV.",
  self_badge: "Added by you",
  remove_skill: "Remove {name}",
  add_label: "Add a missing skill",
  add_placeholder: "Search skills, e.g. Docker",
  add_hint: "Type a few letters, then pick the skill from the list.",
  add_no_match: "No skill in the list matches that. Try another name for it.",
  add_already: "{name} is already on your list.",
  add_catalog_loading: "Loading the skill list…",
  add_catalog_error: "The skill list could not be loaded.",
  picker_options: "Matching skills",
  suggest_h: "Suggested for you",
  suggest_lead: "Often asked for alongside the skills on your list.",
  suggest_add: "Add {name}",
  add_english_only: "Use the skill's English name, for example Docker or Project Management.",
  confirm_skills: "Confirm skills",

  postings_eyebrow: "Agent 2 · Requirements Extractor",
  postings_h: "Job postings",
  postings_lead:
    "Confirmed skills: {n}. Paste the postings you want to apply for, up to 10.",
  posting_n: "Posting {n}",
  remove_posting: "Remove posting {n}",
  title_label: "Title (optional)",
  title_ph: "e.g. Backend Developer at a Riyadh fintech",
  text_label: "Posting text",
  text_ph: "Paste the full posting: responsibilities, requirements, nice to have…",
  short_hint: "At least 80 characters. Paste the whole posting.",
  add_posting: "+ Add another posting",
  extract_req: "Extract requirements",
  extracting_req: "Extracting…",
  req_live_label: "Progress by posting",
  req_live_posting: "Posting {n}",
  req_live_found: "Skills found: {n}",
  req_h: "Requirements · Postings analyzed: {n}",
  req_dropped: "Skills removed for lack of a supporting quote in the posting: {n}",
  req_empty: "No skills found in these postings.",
  col_skill: "Skill",
  col_category: "Category",
  col_asked: "Asked in",
  col_level: "Level",
  asked: "{n} of {total}",
  level_required: "Required",
  level_preferred: "Preferred",
  show_evidence: "Show evidence",
  next_gap: "Find the gap",
  gap_eyebrow: "Agent 3 · Gap Evaluator",
  gap_h: "The gap",
  gap_lead: "Each skill the postings ask for, compared with the skills you confirmed.",
  gap_required: "Required skills you have proven",
  gap_preferred: "Preferred skills you have proven",
  gap_loading: "Comparing…",
  grp_missing_h: "Missing",
  grp_missing_d: "The postings ask for these, and they are not in your skills.",
  grp_proof_h: "Needs proof",
  grp_proof_d:
    "You added these yourself, but your CV does not show them. Add a project or a line to your CV that proves each one.",
  grp_have_h: "You have it",
  grp_have_d: "Proven by your CV and asked for by the postings.",
  grp_empty: "None.",
  cv_quote: "From your CV",
  claim_btn: "I have this skill",
  claim_btn_for: "I have {name}",
  claim_remove: "Remove",
  gap_added_note: "Skills you add show up in the gap only when a posting asks for them.",
  build_plan: "Build my plan",
  err_GAP_NO_REQUIREMENTS: "Extract requirements from the postings first.",
  err_GAP_INVALID: "The skills or requirements could not be read. Go back and extract them again.",

  cat_programming: "Programming languages",
  cat_frameworks: "Frameworks",
  cat_databases: "Databases",
  cat_cloud: "Cloud & DevOps",
  cat_ai: "AI/ML",
  cat_tools: "Tools",
  cat_soft: "Soft skills",
  cat_other: "Other",

  err_network: "Could not reach the server.",
  err_EMPTY_UPLOAD: "The file is empty.",
  err_UNSUPPORTED_FILE: "Only PDF and Word (.docx) files are accepted.",
  err_WORD_LEGACY_OR_PROTECTED:
    "This looks like an old Word file (.doc) or a password-protected document. Save it as .docx without a password, or as PDF, and try again.",
  err_FILE_TOO_LARGE: "The file is larger than 5 MB.",
  err_DOCX_CORRUPTED: "The Word document could not be read. It may be damaged.",
  err_DOCX_NO_TEXT:
    "The Word document has almost no text. Check that the CV is typed, not pasted in as a picture.",
  err_PDF_ENCRYPTED: "The PDF is password-protected. Remove the password and try again.",
  err_PDF_CORRUPTED: "The PDF could not be read. It may be damaged.",
  err_PDF_TOO_MANY_PAGES: "The PDF has more than 10 pages.",
  err_PDF_NO_TEXT_LAYER:
    "This PDF has no text and looks like a scanned image. Export your CV as a text PDF and try again.",
  err_TEXT_TOO_SHORT: "The CV text is too short to extract skills.",
  err_TEXT_TOO_LONG: "The CV text is too long to extract skills.",
  err_SKILLS_MALFORMED: "The model returned an unusable answer. Try again.",
  err_SKILLS_UNAVAILABLE: "The skills service is not available right now.",
  err_SKILLS_BUSY: "The AI model is busy right now. Try again in a minute.",
  err_REQUIREMENTS_BUSY: "The AI model is busy right now. Try again in a minute.",
  err_SKILLS_QUOTA_EXCEEDED: "The Gemini request limit is used up. Try again later.",
  err_POSTINGS_EMPTY: "Paste at least one job posting.",
  err_POSTINGS_TOO_MANY: "Paste at most 10 job postings.",
  err_POSTING_TOO_SHORT: "One of the postings is too short. Paste the full posting text.",
  err_POSTING_TOO_LONG: "One of the postings is longer than 20,000 characters.",
  err_POSTING_TITLE_TOO_LONG: "A posting title is longer than 120 characters.",
  err_REQUIREMENTS_MALFORMED: "The model returned an unusable answer. Try again.",
  err_REQUIREMENTS_UNAVAILABLE: "The requirements service is not available right now.",
  err_REQUIREMENTS_QUOTA_EXCEEDED: "The Gemini request limit is used up. Try again later.",
  err_RATE_LIMITED:
    "You have reached the hourly limit for extractions from your network. Try again in a little while.",
};

export type MessageKey = keyof typeof en;

const ar: Record<MessageKey, string> = {
  lang_menu_label: "اللغة",
  home_label: "SkillSync، العودة إلى الصفحة الرئيسية",
  demo_title: "الوضع التجريبي.",
  demo_body: "لم يُضبط مفتاح Gemini، لذلك تُطابَق المهارات من قائمة مدمجة بدلًا من النموذج.",
  nav_how: "كيف يعمل",
  nav_who: "لمن صُمّم",
  nav_faq: "الأسئلة",
  preview_h: "ما الذي ستراه",
  faq_h: "أسئلة شائعة",
  q1: "هل SkillSync مجاني؟",
  a1: "نعم. هو مشروع جامعي، واستخدامه مجاني.",
  q2: "هل تحتفظون بسيرتي الذاتية؟",
  a2: "لا. يُقرأ الملف في الذاكرة، ولا يُحفظ نصه ولا يُسجَّل. وعند تشغيل نموذج الذكاء الاصطناعي، يُرسَل النص إلى Google Gemini لتحليله. ونحسب الزيارات دون تحديد هويتك عبر GoatCounter، ومن غير ملفات تعريف الارتباط.",
  q3: "ما الملفات التي يمكنني رفعها؟",
  a3: "ملف PDF أو Word بصيغة docx، بحد أقصى 5 ميجابايت، بالعربية أو الإنجليزية أو بهما معًا. لا يمكن حاليًا قراءة السير الذاتية الممسوحة ضوئيًا والمحفوظة كصور.",
  q4: "من أين تأتي إعلانات الوظائف؟",
  a4: "أنت تلصقها: حتى 10 إعلانات تهمك من أي موقع توظيف. وكلما أضفت إعلانات أكثر، اتضح أكثر ما يطلبه السوق من مهارات.",
  q5: "لماذا استُبعدت مهارة موجودة في سيرتي؟",
  a5: "يحتفظ SkillSync بالمهارة فقط إذا أظهرها سطر في سيرتك بوضوح. إذا استُبعدت مهارة، أضفها يدويًا في خطوة المهارات، وستظهر على أنها تحتاج إلى إثبات حتى تُظهرها سيرتك.",
  foot_vision: "يتوافق مع برنامج تنمية القدرات البشرية ضمن رؤية السعودية 2030",
  foot_ksu: "جامعة الملك سعود · 2026",

  eyebrow: "مهاراتك في ميزان سوق العمل",
  hero: "اعرف مهاراتك.",
  hero_accent: "واعرف ما ينقصك.",
  lead:
    "ارفع سيرتك الذاتية والصق إعلانات الوظائف التي تستهدفها. يحتفظ SkillSync بالمهارات التي تثبتها سيرتك فقط، ويحدد ما تطلبه الإعلانات ولا تملكه بعد، ثم يبني لك خطة تعلّم لسد هذه الفجوة.",
  start: "ابدأ بسيرتك الذاتية",
  see_how: "تعرّف على طريقة العمل",
  motion_pause: "إيقاف الحركة",
  motion_play: "تشغيل الحركة",
  particles_cv: "سيرتك",
  stat_checked: "السير الذاتية المفحوصة حتى الآن",
  stat_checked_one: "السير الذاتية المفحوصة حتى الآن",
  how_label: "البداية من سيرتك الذاتية",
  how_title: "خمس خطوات من سيرتك الذاتية إلى خطة.",
  how_note: "كل مهارة في قائمتك يرافقها السطر الذي يثبتها من سيرتك الذاتية.",
  preview_label: "حيث تلتقي بسوق العمل",
  preview_note: "تتقاطع مهاراتك مع المهارات التي تطلبها الإعلانات، وما يقع خارج التقاطع هو الفجوة.",
  preview_example: "مثال لنتيجة من ثلاثة إعلانات",
  who_label: "لكل من لديه سيرة ذاتية",
  who_note: "أيًّا كانت مرحلتك، تُظهر لك الفجوة ما تتعلمه بعد ذلك.",
  faq_label: "قبل أن تبدأ",
  q0: "كيف تتأكدون أن المهارة حقيقية؟",
  a0: "تحتاج كل مهارة إلى سطر من سيرتك الذاتية يثبتها. يقترح الذكاء الاصطناعي المهارات، ثم يطابق الكود كل اقتباس مع نصك ويستبعد ما لا يجده.",
  verified: "مثبتة",
  step_n: "الخطوة {n}",
  s0: "ارفعها بصيغة PDF أو Word، بالعربية أو الإنجليزية أو بهما معًا.",
  s1: "تحتاج كل مهارة إلى اقتباس من سيرتك الذاتية، وإلا تُستبعد.",
  s2: "يستخرج المهارات التي يطلبها كل إعلان ويحسب تكرارها.",
  s3: "يقارن ما لديك بما هو مطلوب.",
  s4: "يرتّب الفجوة حسب الطلب، ولا تُعتمد الخطة إلا بموافقتك.",
  who_h: "لمن صُمّم SkillSync",
  w1_h: "الطلاب والخريجون",
  w1: "اعرف ما يطلبه السوق قبل أن تتقدّم.",
  w2_h: "الراغبون في تغيير مسارهم",
  w2: "اعرف إلى أي مدى تؤهلك مهاراتك الحالية لدور جديد.",
  w3_h: "الموظفون",
  w3: "اعرف ما يتطلبه المنصب الأعلى مما لم تثبته بعد.",

  stepper_label: "مراحل التقدم",
  st_cv: "سيرتك الذاتية",
  st_skills: "مهاراتك",
  st_postings: "إعلانات الوظائف",
  st_gap: "الفجوة",
  st_plan: "خطتك",
  st_soon: "قريبًا",

  upload_h: "ابدأ بسيرتك الذاتية",
  drop: "اسحب سيرتك الذاتية وأفلتها هنا",
  drop_hint: "ملف PDF أو Word بصيغة docx، بحد أقصى 5 ميجابايت و10 صفحات.",
  privacy_gemini:
    "تُرسَل سيرتك الذاتية والإعلانات التي تلصقها إلى Google Gemini لتحليلها. لا يحفظها SkillSync ولا يسجّلها.",
  choose: "اختر ملفًا",
  extracting_text: "جارٍ استخراج النص…",
  upload_meta: "عدد الصفحات: {pages} · عدد الأحرف: {chars}",
  extract_skills: "استخراج المهارات",
  start_over: "البدء من جديد",
  retry: "إعادة المحاولة",
  stage_read: "قراءة سيرتك الذاتية",
  stage_find: "استخراج المهارات التي تُظهرها",
  stage_check: "مطابقة كل اقتباس مع سيرتك الذاتية",
  found_so_far: "المهارات المُثبتة حتى الآن: {n}",

  skills_h: "مهاراتك المثبتة",
  skills_count: "المثبتة: {verified} · المضافة يدويًا: {self}",
  back: "رجوع",
  skills_dropped: "مهارات استُبعدت لعدم وجود دليل عليها في سيرتك الذاتية: {n}",
  skills_empty: "لم تتبقَّ أي مهارة. أضف مهارة أدناه، أو ارجع وارفع سيرة ذاتية أخرى.",
  self_badge: "مضافة يدويًا",
  remove_skill: "إزالة {name}",
  add_label: "أضف مهارة ناقصة",
  add_placeholder: "Docker, Project Management",
  add_hint: "اكتب بضعة أحرف، ثم اختر المهارة من القائمة.",
  add_no_match: "لا توجد مهارة في القائمة بهذا الاسم. جرّب اسمًا آخر لها.",
  add_already: "{name} موجودة في قائمتك بالفعل.",
  add_catalog_loading: "جارٍ تحميل قائمة المهارات…",
  add_catalog_error: "تعذّر تحميل قائمة المهارات.",
  picker_options: "المهارات المطابقة",
  suggest_h: "مقترحة لك",
  suggest_lead: "مهارات تُطلب غالبًا مع المهارات الموجودة في قائمتك.",
  suggest_add: "إضافة {name}",
  add_english_only: "اكتب اسم المهارة بالإنجليزية، مثل Docker أو Project Management.",
  confirm_skills: "تأكيد المهارات",

  postings_eyebrow: "الوكيل 2 · مستخرج المتطلبات",
  postings_h: "إعلانات الوظائف",
  postings_lead:
    "المهارات المؤكدة: {n}. الصق إعلانات الوظائف التي تريد التقدم إليها، بحد أقصى 10 إعلانات.",
  posting_n: "الإعلان {n}",
  remove_posting: "إزالة الإعلان {n}",
  title_label: "العنوان (اختياري)",
  title_ph: "مثال: مطور واجهات خلفية في شركة تقنية مالية بالرياض",
  text_label: "نص الإعلان",
  text_ph: "الصق نص الإعلان كاملًا: المهام، والمتطلبات، والمهارات المفضّلة…",
  short_hint: "80 حرفًا على الأقل. الصق الإعلان كاملًا.",
  add_posting: "+ إضافة إعلان آخر",
  extract_req: "استخراج المتطلبات",
  extracting_req: "جارٍ الاستخراج…",
  req_live_label: "التقدّم في كل إعلان",
  req_live_posting: "الإعلان {n}",
  req_live_found: "المهارات المستخرجة: {n}",
  req_h: "المتطلبات · الإعلانات المحلَّلة: {n}",
  req_dropped: "مهارات استُبعدت لعدم وجود اقتباس يدعمها في الإعلان: {n}",
  req_empty: "لم يُعثر على مهارات في هذه الإعلانات.",
  col_skill: "المهارة",
  col_category: "الفئة",
  col_asked: "مطلوبة في",
  col_level: "المستوى",
  asked: "{n} من {total}",
  level_required: "أساسية",
  level_preferred: "مفضّلة",
  show_evidence: "عرض الدليل",
  next_gap: "تحديد الفجوة",
  gap_eyebrow: "الوكيل 3 · مقيّم الفجوة",
  gap_h: "الفجوة",
  gap_lead: "كل مهارة تطلبها الإعلانات، مقارنةً بالمهارات التي أكّدتها.",
  gap_required: "المهارات الأساسية التي أثبتّها",
  gap_preferred: "المهارات المفضّلة التي أثبتّها",
  gap_loading: "جارٍ المقارنة…",
  grp_missing_h: "مهارات تنقصك",
  grp_missing_d: "تطلبها الإعلانات، وليست ضمن مهاراتك.",
  grp_proof_h: "تحتاج إلى إثبات",
  grp_proof_d:
    "أضفتها بنفسك، لكن سيرتك الذاتية لا تثبتها. أضف إلى سيرتك مشروعًا أو سطرًا يثبت كل واحدة منها.",
  grp_have_h: "مهارات تملكها",
  grp_have_d: "أثبتتها سيرتك الذاتية، وتطلبها الإعلانات.",
  grp_empty: "لا يوجد.",
  cv_quote: "من سيرتك الذاتية",
  claim_btn: "لديّ هذه المهارة",
  claim_btn_for: "لديّ مهارة {name}",
  claim_remove: "إزالة",
  gap_added_note: "تظهر المهارات التي تضيفها في الفجوة فقط إذا طلبها أحد الإعلانات.",
  build_plan: "ابنِ خطتي",
  err_GAP_NO_REQUIREMENTS: "استخرج المتطلبات من الإعلانات أولًا.",
  err_GAP_INVALID: "تعذّرت قراءة المهارات أو المتطلبات. ارجع واستخرجها مرة أخرى.",

  cat_programming: "لغات البرمجة",
  cat_frameworks: "أطر العمل",
  cat_databases: "قواعد البيانات",
  cat_cloud: "الحوسبة السحابية و DevOps",
  cat_ai: "الذكاء الاصطناعي وتعلّم الآلة",
  cat_tools: "الأدوات",
  cat_soft: "المهارات الشخصية",
  cat_other: "أخرى",

  err_network: "تعذّر الاتصال بالخادم.",
  err_EMPTY_UPLOAD: "الملف فارغ.",
  err_UNSUPPORTED_FILE: "يُقبل ملف PDF أو Word بصيغة docx فقط.",
  err_WORD_LEGACY_OR_PROTECTED:
    "يبدو أن الملف بصيغة Word القديمة doc أو محمي بكلمة مرور. احفظه بصيغة docx دون كلمة مرور، أو بصيغة PDF، ثم حاول مرة أخرى.",
  err_FILE_TOO_LARGE: "حجم الملف أكبر من 5 ميجابايت.",
  err_DOCX_CORRUPTED: "تعذّرت قراءة مستند Word، وقد يكون تالفًا.",
  err_DOCX_NO_TEXT: "لا يحتوي مستند Word على نص تقريبًا. تأكد أن السيرة مكتوبة نصًا وليست صورة ملصقة.",
  err_PDF_ENCRYPTED: "الملف محمي بكلمة مرور. أزل كلمة المرور ثم حاول مرة أخرى.",
  err_PDF_CORRUPTED: "تعذّرت قراءة الملف، وقد يكون تالفًا.",
  err_PDF_TOO_MANY_PAGES: "يتجاوز الملف 10 صفحات.",
  err_PDF_NO_TEXT_LAYER:
    "لا يحتوي الملف على نص، ويبدو أنه صورة ممسوحة ضوئيًا. صدّر سيرتك الذاتية بصيغة PDF نصية ثم حاول مرة أخرى.",
  err_TEXT_TOO_SHORT: "نص السيرة الذاتية أقصر من أن تُستخرج منه المهارات.",
  err_TEXT_TOO_LONG: "نص السيرة الذاتية أطول من الحد المسموح به.",
  err_SKILLS_MALFORMED: "أعاد النموذج إجابة غير صالحة. حاول مرة أخرى.",
  err_SKILLS_UNAVAILABLE: "خدمة استخراج المهارات غير متاحة حاليًا.",
  err_SKILLS_BUSY: "نموذج الذكاء الاصطناعي مشغول حاليًا. حاول مرة أخرى بعد دقيقة.",
  err_REQUIREMENTS_BUSY: "نموذج الذكاء الاصطناعي مشغول حاليًا. حاول مرة أخرى بعد دقيقة.",
  err_SKILLS_QUOTA_EXCEEDED: "استُنفد حد طلبات Gemini. حاول مرة أخرى لاحقًا.",
  err_POSTINGS_EMPTY: "الصق إعلان وظيفة واحدًا على الأقل.",
  err_POSTINGS_TOO_MANY: "الحد الأقصى 10 إعلانات وظائف.",
  err_POSTING_TOO_SHORT: "أحد الإعلانات قصير جدًا. الصق نص الإعلان كاملًا.",
  err_POSTING_TOO_LONG: "أحد الإعلانات يتجاوز 20,000 حرف.",
  err_POSTING_TITLE_TOO_LONG: "عنوان أحد الإعلانات يتجاوز 120 حرفًا.",
  err_REQUIREMENTS_MALFORMED: "أعاد النموذج إجابة غير صالحة. حاول مرة أخرى.",
  err_REQUIREMENTS_UNAVAILABLE: "خدمة استخراج المتطلبات غير متاحة حاليًا.",
  err_REQUIREMENTS_QUOTA_EXCEEDED: "استُنفد حد طلبات Gemini. حاول مرة أخرى لاحقًا.",
  err_RATE_LIMITED: "وصلت إلى الحد المسموح به من عمليات الاستخراج في الساعة. حاول مرة أخرى بعد قليل.",
};

const messages: Record<Lang, Record<MessageKey, string>> = { en, ar };

const CATEGORY_KEYS: Record<string, MessageKey> = {
  "Programming languages": "cat_programming",
  Frameworks: "cat_frameworks",
  Databases: "cat_databases",
  "Cloud & DevOps": "cat_cloud",
  "AI/ML": "cat_ai",
  Tools: "cat_tools",
  "Soft skills": "cat_soft",
  Other: "cat_other",
};

const STORAGE_KEY = "skillsync-lang";

type Vars = Record<string, string | number>;

type I18n = {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  category: (name: string) => string;
  errorMessage: (code: string, fallback: string) => string;
};

const I18nContext = createContext<I18n | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ar") return saved;
  } catch {
    // Storage can be blocked; fall back to the browser language.
  }
  return navigator.language?.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const dir = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies for this visit.
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const table = messages[lang];
    const t = (key: MessageKey, vars?: Vars) =>
      table[key].replace(/\{(\w+)\}/g, (match, name: string) =>
        vars && name in vars ? String(vars[name]) : match,
      );

    return {
      lang,
      dir,
      setLang,
      t,
      category: (name) => (CATEGORY_KEYS[name] ? t(CATEGORY_KEYS[name]) : name),
      errorMessage: (code, fallback) => {
        const key = `err_${code}`;
        return key in table ? table[key as MessageKey] : fallback;
      },
    };
  }, [lang, dir, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside LanguageProvider");
  return value;
}
