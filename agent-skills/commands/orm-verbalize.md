---
description: Turn a model into FORML sentences for a domain expert, an agent, or a review
argument-hint: [path to .orm.json] [for-expert | for-agent | for-review]
---

Verbalize: **$ARGUMENTS**

Use the `factum-orm` skill; `references/forml.md` documents every sentence form.

Run `factum verbalize <model> --population` if it is available and quote the real
output. If it is not, produce the sentences yourself from the reference, and say
plainly that they are derived by hand rather than emitted by the tool.

Then shape the output for its audience:

**For a domain expert.** Group the sentences by the thing they are about, drop the
reference-scheme boilerplate, and put the sentences most likely to be *wrong* first —
the optional roles, the enumerated value sets, the exclusions. End with a short list
of direct questions: *"Is it true that not every academic has a room?"* A rule stated
badly gets corrected faster than a rule requested politely, so state them.

**For an agent.** Keep `--mode forml`, keep the necessity prefixes, keep the
population. Write it to a file the agent can load whole and tell me where to point at
it. If the verbalization is too long to fit a prompt, say so and propose a split by
subdomain rather than retrieval.

**For a review.** Show it beside the previous version — `factum diff <before> <after>
--format markdown` — so the reviewer reads what changed as sentences rather than as
JSON.

If no audience was named, ask which one before formatting.
