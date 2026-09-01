"""Build Section 5 on its own, as a .docx you can drop into the full report.

It does not hold a second copy of the text. It reads build_report.py, runs that
file's page setup and helper definitions, then runs only its Section 5 block, so
this document and the full report can never disagree.
"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "build_report.py"
OUT = HERE / "Section-5-Evaluation.docx"

src = SOURCE.read_text(encoding="utf-8")

prelude = src[:src.index("# ================================================================ TITLE PAGE")]
section5 = src[src.index("h(1, '5. Evaluation')"):
               src.index("# ================================================================ 6")]

ns = {"__file__": str(SOURCE)}
exec(compile(prelude, str(SOURCE), "exec"), ns)
exec(compile(section5, str(SOURCE), "exec"), ns)

doc, para, figure, h, table = ns["doc"], ns["para"], ns["figure"], ns["h"], ns["table"]
FIG_DIR = ns["FIG_DIR"]

# The evidence Section 5.1 points at, so the extract stands on its own.
doc.add_page_break()
h(1, 'Appendix C — Test evidence')
para('Captured verbatim from the runs; the summary lines are each suite’s own output '
     'rather than retyped text.')
figure(FIG_DIR / 'fig-test-evidence.png', 15.8,
       'Figure C.1 — Console output of the three suites: 461 + 372 + 92 = 925 tests passing, '
       'with the model-sync build gate confirming the bundled coefficients match the artifact')
table(['Property asserted', 'Tests', 'Representative case'],
      [['Cross-account isolation', '19', '`should_not_leak_another_users_nights`'],
       ['Unauthenticated access refused', '17',
        '`should_reject_an_unauthenticated_request_for_the_profile`'],
       ['Login / one-time-code throttling', '5',
        '`should_lock_out_the_correct_password_too_once_throttled`'],
       ['No committed secrets', '46 commits',
        '`git log --all -p` grepped for key and token patterns — no match']],
      caption='Table C.1 — Security assertions counted in §5.2',
      widths=[4.5, 2.4, 7.6])

doc.save(OUT)

# ---------------------------------------------------------------- word count
from docx import Document

d2 = Document(OUT)
WORD = re.compile(r"[\w§±ρ²–—.%/'-]+")
BUDGET = {'5.1': 150, '5.2': 130, '5.3': 130, '5.4': 250, '5.5': 110}
sub, counts, order, appendix = None, {}, [], False
for child in d2.element.body.iterchildren():
    tag = child.tag.split('}')[-1]
    if tag not in ('p', 'tbl'):
        continue
    text = ' '.join(n.text or '' for n in child.iter() if n.tag.endswith('}t'))
    if text.strip().startswith('Appendix C'):
        appendix = True
    if appendix:
        continue
    if tag == 'p' and re.match(r'^5\.\d ', text.strip()):
        sub = text.strip()
        order.append(sub)
    if sub:
        counts[sub] = counts.get(sub, 0) + len(WORD.findall(text))

print('Saved:', OUT)
total = 0
for name in order:
    n = counts[name]
    total += n
    budget = BUDGET[name[:3]]
    print(f'  {name[:42]:44s} {n:4d} / {budget:4d}')
print(f'  {"SECTION 5 TOTAL":44s} {total:4d} /  770   ({total - 770:+d})')
