# AI-agent memory: source filtering and displayed provenance

This contained experiment runs unchanged query bodies from a pinned Claude-Mem revision against invented SQLite records. It tests **which rows are returned**, not whether an agent follows them.

With the source predicate unset, the main query returns **11 of 15 observation fixtures**. With the source set to `claude`, it returns **4 of the same 15**. Both retain the own-source benign record. The broad query labels two records with missing source information as `claude`; the source-specific query excludes those same records because their raw source is not `claude`.

**No model, real memory database, startup hook, renderer, hosted service, compression or external action runs.** Records are inert strings in a new in-memory database for every configuration. This is a source-component assay, not a discovered cross-agent injection or a complete Claude-Mem reproduction.

## Hypothesis and threat model

A source predicate can narrow which stored observations reach a context-building pipeline. A displayed fallback source label can differ from the underlying source value used for that predicate.

Assume another harness has already stored a record in the same project. The experiment supplies that record directly; it does not demonstrate attacker insertion, model persuasion or privilege escalation. The database, source metadata, query code and driver remain trusted. A source name is metadata, not authenticated proof of authorship or instruction safety.

- **All sources (control):** Run the original query with the source predicate unset, retaining the project constraint.
- **Source filter (intervention):** Run the same query with the source parameter `claude` and the same project, limits and database rows.

The oracle is exact returned IDs, marker bytes and displayed source labels. Expected IDs are literal fixture expectations in `test.ts`, not another implementation of the SQL predicate. The own-source row is the benign twin. Other projects, unknown/missing provenance, source and project casing, invalid concept JSON, merged aliases and limits are explicit counterfactuals.

## Setup and reproduce

Requires Node.js **22.22.2 or a compatible version** with built-in `node:sqlite` and TypeScript type stripping. No npm packages, credentials, service installation or network requests are needed. Tested on Node22.22.2. Node prints experimental-feature warnings for SQLite/type stripping.

```sh
node --experimental-strip-types experiment.ts
node --experimental-strip-types test.ts
```

The first command regenerates [run.json](artifacts/run.json) and [exact evidence](artifacts/evidence.md). The second regenerates [checks.json](artifacts/checks.json). It checks 11 assertions/groups and two deliberate functional faults. All fixture counts describe designed cases, not attack rates or model trials.

## Technical walkthrough

The [upstream README](https://github.com/thedotmack/claude-mem/blob/75fc021a40655cbdd258f0e070f55a03ea9c8642/README.md) documents an include-all-sources startup setting whose default is false. Multi-agent support does not imply every agent automatically receives every record. **This experiment does not run that setting or the startup path.** It supplies the corresponding query-level source parameter directly.

The [pinned query source](https://github.com/thedotmack/claude-mem/blob/75fc021a40655cbdd258f0e070f55a03ea9c8642/src/services/context/ObservationCompiler.ts) contains two different operations:

```sql
-- Source admission uses the stored value:
(? IS NULL OR s.platform_source = ?)

-- The returned source label supplies a fallback:
COALESCE(s.platform_source, 'claude') as platform_source
```

An unset parameter disables source filtering. When the parameter is `claude`, a raw SQL NULL does not equal it. Separately, the SELECT expression presents a NULL as `claude`. The query is not claiming that NULL is authenticated Claude provenance. The distinction is between a returned display value and an admission predicate.

### Paired witness

Project is `alpha` in both methods. The same harmless observation text, `INERT-NOTE`, is used throughout. Other filters remain unchanged.

| Fixture | Stored source | All sources | Source filter `claude` |
|---|---|---|---|
|101 own-source twin|`claude`|Returned, label `claude`|Returned, label `claude`|
|102 other harness|`codex`|Returned, label `codex`|Not returned|
|103 unknown provenance|SQL NULL|Returned, fallback label `claude`|Not returned|
|104 missing joined session|No session row|Returned, fallback label `claude`|Not returned|

Rows103/104 are still present in the database. Filtering neither rewrites nor deletes them. The all-source view and the source-specific view are not interchangeable ways to count records apparently labeled `claude`.

The complete [evidence table](artifacts/evidence.md) accounts for all15 observation fixtures and6 summary fixtures. In the main broad query,11 observations and5 summaries return. The `claude` query returns4 observations and2 summaries. Other-project observations, wrong types, invalid concept JSON and wrong concepts are omitted for separately identified reasons. Summary queries use the upstream `SUMMARY_LOOKAHEAD=1`, so their limit is observation limit plus1; do not compare them as equal-count budgets.

### Boundary cases

- Explicit `codex` selects its two observations and one summary.
- SQL NULL and a missing joined session get the fallback label only in the broad result. An empty source string remains empty.
- Source matching is case sensitive in this fixture schema: `Claude` differs from `claude`. Project matching explicitly uses `COLLATE NOCASE`, so `ALPHA` matches `alpha`.
- A merged project alias is included once even when multiple matching project keys are supplied.
- With observation limit1, the broad query returns newest other-source ID115; the `claude` query returns newest own-source ID114. Source filtering occurs before the final limit for these cases.
- Invalid observation-concepts JSON is skipped rather than crashing the query. It is not a prompt-injection classification.

## Source extraction and runtime adaptation

[source.json](artifacts/source.json) records the pinned commit, original Git blob/full SHA256, retained original line ranges, snippet hashes, dependency constants, license blob and extracted-file hash. [vendor/queries.ts](vendor/queries.ts) retains original statements from `ObservationCompiler.ts`: select constants, project-key batching helpers, `queryObservationsNewest` and `querySummariesMulti`. `SUMMARY_LOOKAHEAD=1` is copied from that revision's `types.ts`.

Bun is not used. The harness runs these TypeScript bodies with Node's type stripping and real `node:sqlite` SQL execution. A small adapter exposes `prepare().all()` and a no-op `finalize()` because Node manages statement cleanup; the database closes after each case. Erased type aliases are supplied locally. Subagent-filtering dependency is a throwing guard on an untested path, with `excludeSubagents=false`. Ranking/reinforcement, large batching beyond250project keys, real schema migrations, automatic project resolution, renderer, provider writes and server-side storage are not reproduced.

Copied query code is Apache-2.0; [vendor/LICENSE](vendor/LICENSE) preserves the upstream license. Original harness code is MIT. No claim of upstream endorsement.

## Validation and actual results

Eleven focused test groups pass. Exact expected observation and summary IDs are checked across9configurations, yielding18query result sets. Both deliberate faults produce assertion failures with no runtime errors:

| Functional fault | Failed test groups | What it exposes |
|---|---:|---|
|Drop the source parameter|8|Other-source/missing-source rows incorrectly join scoped results|
|Apply display COALESCE inside source WHERE|4|Missing raw provenance is treated as explicit `claude`|

The second fault is a diagnostic alteration, not a recommended fix. Faults change the adapter/input used during tests, not the vendored source file or recorded normal experiment. Hash verification also detects source-file changes. A fresh technical-only copy reproduces the machine-readable artifacts byte-for-byte.

## Limits and supported engineering check

This does not establish a current vulnerability, default cross-agent sharing, classifier effectiveness, instruction following, data exfiltration or adoption. A correctly scoped query can still return unsafe text from the allowed source. A mislabeled stored record can pass; provenance authentication is outside scope. An unfiltered query can be an intentionally authorized configuration. Missing-source exclusion can affect completeness; it is not intrinsically an exploit or protection claim.

Test the actual returned IDs when enabling cross-harness memory, with an own-source twin and an other-source record in the same project. Preserve missing provenance explicitly in diagnostic evidence, and test the raw predicate separately from display fallback labels before relying on those labels to explain selection.
