---
name: ponytail-audit
description: >
  Whole-repo audit for over-engineering and efficiency. Like ponytail-review, but scans the
  entire codebase instead of a diff: a ranked list of what to delete, simplify,
  or replace with stdlib/native equivalents, plus identifying third-party libraries
  where they save substantial bespoke bloat.
---

# Ponytail Audit

Scan the whole tree instead of a diff. Rank findings biggest cut first.

## Tags

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library / JS built-in ships. Name the function.
- `native:` dependency or code doing what the browser/platform already does. Name the feature.
- `third-party:` where writing custom bespoke code is bloated, bug-prone, or re-inventing the wheel, recommend battle-tested third-party packages.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.
