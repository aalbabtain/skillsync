Read this CV (Arabic or English) and copy its parts into JSON. Copy, do not write: every value
must be text that appears in the CV, in the CV's own spelling. Leave a field empty or a list
empty when the CV does not say it. Never guess.

- name: the person's full name, in Latin letters if the CV has it that way
- field: their specialisation or current title
- school, degree, grad (graduation date as written), gpa (as written)
- skills: the tools, languages and technologies the CV names
- projects: each project's name, and its lines as written in the CV
- certs: certificate names; langs: spoken languages with their level

Return JSON only, with the keys name, field, school, degree, grad, gpa, skills, projects
(each {"name", "lines"}), certs and langs.
