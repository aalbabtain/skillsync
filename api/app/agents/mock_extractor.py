"""Deterministic stand-in for the model, used when no Gemini key is configured.

Matches a fixed skill dictionary against the CV text, so the rest of the pipeline
can run offline. The evidence is the CV line the skill was found in, which keeps the
verification step meaningful.
"""

from app.verification import normalize

MAX_EVIDENCE_CHARS = 300

SKILLS = (
    ("Python", "Programming languages", ("python", "بايثون")),
    ("Java", "Programming languages", ("java", "جافا")),
    ("JavaScript", "Programming languages", ("javascript", "js")),
    ("TypeScript", "Programming languages", ("typescript", "ts", "تايب سكربت")),
    ("C#", "Programming languages", ("c#", "c sharp")),
    ("C++", "Programming languages", ("c++",)),
    ("Go", "Programming languages", ("golang",)),
    ("PHP", "Programming languages", ("php",)),
    ("SQL", "Programming languages", ("sql",)),
    ("Kotlin", "Programming languages", ("kotlin",)),
    ("Swift", "Programming languages", ("swift",)),
    ("Dart", "Programming languages", ("dart",)),
    ("React", "Frameworks", ("react", "reactjs", "ريأكت")),
    ("Next.js", "Frameworks", ("next.js", "nextjs")),
    ("Vue", "Frameworks", ("vue", "vuejs")),
    ("Angular", "Frameworks", ("angular",)),
    ("Flutter", "Frameworks", ("flutter", "فلاتر")),
    ("FastAPI", "Frameworks", ("fastapi", "fast api", "فاست api")),
    ("Django", "Frameworks", ("django",)),
    ("Flask", "Frameworks", ("flask",)),
    ("Spring Boot", "Frameworks", ("spring boot",)),
    ("Node.js", "Frameworks", ("node.js", "nodejs")),
    ("Express", "Frameworks", ("express",)),
    ("Laravel", "Frameworks", ("laravel",)),
    ("Bootstrap", "Frameworks", ("bootstrap",)),
    ("Tailwind CSS", "Frameworks", ("tailwind",)),
    ("HTML/CSS", "Frameworks", ("html", "css", "html css")),
    ("MySQL", "Databases", ("mysql",)),
    ("PostgreSQL", "Databases", ("postgresql", "postgres")),
    ("MongoDB", "Databases", ("mongodb", "mongo")),
    ("SQLite", "Databases", ("sqlite",)),
    ("Firebase", "Databases", ("firebase", "فايربيس")),
    ("Redis", "Databases", ("redis",)),
    ("Oracle", "Databases", ("oracle",)),
    ("AWS", "Cloud & DevOps", ("aws", "amazon web services")),
    ("Azure", "Cloud & DevOps", ("azure",)),
    ("Google Cloud", "Cloud & DevOps", ("google cloud", "gcp")),
    ("Docker", "Cloud & DevOps", ("docker",)),
    ("Kubernetes", "Cloud & DevOps", ("kubernetes", "k8s")),
    ("Terraform", "Cloud & DevOps", ("terraform",)),
    ("GitHub Actions", "Cloud & DevOps", ("github actions",)),
    ("CI/CD", "Cloud & DevOps", ("ci cd",)),
    ("Linux", "Cloud & DevOps", ("linux",)),
    ("Machine Learning", "AI/ML", ("machine learning", "تعلم الآلة")),
    ("TensorFlow", "AI/ML", ("tensorflow",)),
    ("PyTorch", "AI/ML", ("pytorch",)),
    ("scikit-learn", "AI/ML", ("scikit learn", "sklearn")),
    ("OpenCV", "AI/ML", ("opencv",)),
    ("ONNX", "AI/ML", ("onnx",)),
    ("EfficientNet", "AI/ML", ("efficientnet",)),
    ("NLP", "AI/ML", ("nlp", "natural language processing")),
    ("Pandas", "AI/ML", ("pandas",)),
    ("NumPy", "AI/ML", ("numpy",)),
    ("Git", "Tools", ("git",)),
    ("GitHub", "Tools", ("github",)),
    ("Figma", "Tools", ("figma",)),
    ("Jira", "Tools", ("jira",)),
    ("Postman", "Tools", ("postman",)),
    ("VS Code", "Tools", ("vs code", "visual studio code")),
    ("Excel", "Tools", ("excel",)),
    ("Power BI", "Tools", ("power bi",)),
    ("Notion", "Tools", ("notion",)),
    ("Leadership", "Soft skills", ("leadership", "القيادة")),
    ("Communication", "Soft skills", ("communication", "التواصل")),
    ("Teamwork", "Soft skills", ("teamwork", "team work", "العمل الجماعي")),
    ("Problem Solving", "Soft skills", ("problem solving",)),
    ("Time Management", "Soft skills", ("time management",)),
    ("Presentation", "Soft skills", ("presentation", "العروض")),
)


def _mentions(line: str, alias: str) -> bool:
    return f" {alias} " in f" {line} "


def extract(cv_text: str) -> list[dict[str, str]]:
    lines = [line.strip() for line in cv_text.splitlines() if line.strip()]
    folded = [normalize(line) for line in lines]
    found: list[dict[str, str]] = []

    for name, category, aliases in SKILLS:
        needles = [normalize(alias) for alias in aliases]

        for line, folded_line in zip(lines, folded):
            if any(_mentions(folded_line, needle) for needle in needles):
                found.append(
                    {
                        "name": name,
                        "category": category,
                        "evidence": line[:MAX_EVIDENCE_CHARS],
                    }
                )
                break

    return found


PREFERRED_MARKERS = tuple(
    normalize(marker)
    for marker in (
        "preferred",
        "nice to have",
        "plus",
        "bonus",
        "advantage",
        "يفضل",
        "ميزة",
        "مفضل",
    )
)


def extract_requirements(posting_text: str) -> list[dict[str, str]]:
    """Match the skill dictionary against a posting and guess each skill's level."""
    found = []

    for item in extract(posting_text):
        line = normalize(item["evidence"])
        preferred = any(_mentions(line, marker) for marker in PREFERRED_MARKERS)
        found.append({**item, "level": "preferred" if preferred else "required"})

    return found
