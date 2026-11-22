Read this CV (Arabic or English) and copy its parts into JSON, so the person can update it.
Copy, do not write: every value must be text that appears in the CV, in the CV's own spelling.
Leave a field or list empty when the CV does not say it. Never guess, never shorten a name.

- name: the person's full name, in Latin letters if the CV has it that way
- title: the headline under the name ("Software Engineer"), if there is one
- location: the city (and country) in the contact line
- summary: the whole professional summary or profile paragraph, as written
- field: the person's specialisation or major ("Software Engineering")
- school, degree (as written, "B.Sc. in Software Engineering"), grad (the graduation or
  expected date, as written), gpa (as written, "4.67/5")
- skills: every skill, tool, language and technology in the skills section, one per item,
  without the section's own headings ("Programming Languages:" is not a skill)
- skill_groups: the skills section as the CV groups it: each heading as written ("Frameworks &
  Libraries") with its items as written, one per item ("Firebase (Auth, Firestore, Storage)"
  is one item). Empty when the CV does not group its skills.
- projects: every project, in the CV's order, none left out. For each:
  - name: the project's title as written, without its link or dates
  - url: its link, if any ("nakhlahsa.com")
  - start, end: its dates as written ("Jan 2025", "Present")
  - role: the person's role on it ("Full-Stack Developer"), from the line under the title
  - tools: the tools on that same line ("Flutter, React, Firebase")
  - lines: its bullet points only, each without the bullet mark. The link, the role and the
    tools are not bullet points.
- jobs: every job or internship, the same way: company, title, start, end, lines
- certs: each certificate's name as written
- langs: each spoken language with its level as written
- activities: each activity, membership or club, as one line with its role, organisation and
  dates ("Member, Artificial Intelligence Club – King Saud University, Mar 2026 – Present")

Return JSON only, with exactly these keys.
