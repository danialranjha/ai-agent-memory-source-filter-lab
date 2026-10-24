# Exact query evidence

Source query component with synthetic SQLite rows; no model, renderer, startup hook, hosted store or real memory.

Control: source predicate unset. Intervention: source predicate `claude`. Project remains `alpha`; all other settings and input rows are identical.

| Observation | Raw source | All sources display | Claude-only display |
|---|---|---|---|
| 101 own_source | "claude" | "claude" | "claude" |
| 102 other_source | "codex" | "codex" | not returned |
| 103 null_source | null | "claude" | not returned |
| 104 missing_session | missing joined session | "claude" | not returned |
| 105 empty_source | "" | "" | not returned |
| 106 unknown_source | "other" | "other" | not returned |
| 107 case_source | "Claude" | "Claude" | not returned |
| 108 other_project | "claude" | not returned | not returned |
| 109 case_project | "claude" | "claude" | "claude" |
| 110 wrong_type | "claude" | not returned | not returned |
| 111 invalid_concepts | "claude" | not returned | not returned |
| 112 wrong_concept | "claude" | not returned | not returned |
| 113 merged_alias | "claude" | "claude" | "claude" |
| 114 new_own | "claude" | "claude" | "claude" |
| 115 new_other | "codex" | "codex" | not returned |

| Configuration | Observation IDs (returned order) | Summary IDs |
|---|---|---|
| all_sources | 115, 114, 113, 109, 107, 106, 105, 104, 103, 102, 101 | 206, 204, 203, 202, 201 |
| claude_only | 114, 113, 109, 101 | 206, 201 |
| codex_only | 115, 102 | 202 |
| unknown_only | 106 | none |
| no_match | none | none |
| all_limit_one | 115 | 206, 204 |
| claude_limit_one | 114 | 206, 201 |
| alias_union | 114, 113, 109, 101 | 206, 201 |
| source_case | 107 | none |

All returned observation markers are `INERT-NOTE`; summary markers are `INERT-SUMMARY`. Different IDs can contain identical text.

The input contains 15 observation fixtures and 6 summary fixtures. Nine configurations produce 18 query result sets. These are selected cases, not model trials, attack rates or a sampled denominator.

The all-source view labels NULL or missing-session provenance as `claude` through SELECT COALESCE, but the source-specific WHERE uses raw equality and excludes those records. Empty strings remain empty, not claude. No row or metadata is changed by filtering.

The source filter is a query parameter, not authenticated provenance. Case-sensitive source matching, case-insensitive project matching, merged aliases and the source summary lookahead of 1 are deliberate observed boundaries. Upstream ranking, subagent policy, actual hooks and server mode are outside this test.
