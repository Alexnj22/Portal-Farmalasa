---
name: Always git push after changes
description: User wants git commit + push after every code change, not just commit
type: feedback
originSessionId: d1fcdcd2-a635-4515-a7d0-ea0068aba41d
---
Always run `git add`, `git commit`, and `git push` after making any code changes.

**Why:** User explicitly instructed "siempre que hagas cambio has git push" — they want changes pushed immediately, not just committed locally.

**How to apply:** After every file edit session, stage the relevant files, commit with a descriptive message, and push to remote without waiting for user to ask.
