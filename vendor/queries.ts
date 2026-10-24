// Extracted unchanged query bodies from Claude-Mem. See artifacts/source.json.
// Harness-only erased types and unused-path guard follow.
type LocalObservation = any;
type LocalSessionSummary = any;
type ContextConfig = any;
type DatabaseOwner = { db: any };
export const SUMMARY_LOOKAHEAD = 1;
function mainAgentRowSql(_alias: string): never { throw new Error("Subagent filtering is outside this assay"); }

const OBSERVATION_SELECT = `
      o.id,
      o.memory_session_id,
      s.content_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      o.type,
      o.title,
      o.subtitle,
      o.narrative,
      o.facts,
      o.concepts,
      o.files_read,
      o.files_modified,
      o.discovery_tokens,
      o.created_at,
      o.created_at_epoch,
      o.project
`;

// Each project key can match on `project` or `merged_into_project`. One
// `(project IN … OR merged_into_project IN …) ORDER BY … LIMIT n` makes SQLite
// fetch every matching row and sort them all. Instead take the newest `limit`
// rows per (column, key) from the v63 (key COLLATE NOCASE, created_at_epoch DESC)
// indexes, and keep the newest `limit` ids of the union.
const PROJECT_KEY_COLUMNS = ['project', 'merged_into_project'] as const;

// SQLite accepts at most 500 terms in a compound SELECT. Each key contributes
// one term per project column, so bound batches before applying the global cap.
const PROJECT_KEYS_PER_QUERY = 250;

function newestUniqueRows<T extends { id: number; created_at_epoch: number }>(batches: T[][], limit: number): T[] {
  const rows = new Map<number, T>();
  for (const batch of batches) for (const row of batch) rows.set(row.id, row);
  return [...rows.values()].sort((a, b) => b.created_at_epoch - a.created_at_epoch).slice(0, limit);
}

function newestIdsPerProjectKeySql(
  alias: string,
  projectCount: number,
  perKeySql: (keyPredicate: string) => string,
): string {
  const parts: string[] = [];
  for (const column of PROJECT_KEY_COLUMNS) {
    for (let i = 0; i < projectCount; i++) {
      parts.push(`SELECT * FROM (${perKeySql(`${alias}.${column} COLLATE NOCASE = ?`)})`);
    }
  }
  return `
    SELECT id FROM (${parts.join(' UNION ')})
    ORDER BY created_at_epoch DESC
    LIMIT ?`;
}

export function queryObservationsNewest(
  db: DatabaseOwner,
  config: ContextConfig,
  options: {
    limit: number;
    platformSource?: string;
    projects?: string[];
    includeManualSaves?: boolean;
    excludeSubagents?: boolean;
    /** Also select the reinforcement history (only needed while ranking is on). */
    withReinforcementDates?: boolean;
  }
): LocalObservation[] {
  const typeArray = Array.from(config.observationTypes);
  const typePlaceholders = typeArray.map(() => '?').join(',');
  const conceptArray = Array.from(config.observationConcepts);
  const conceptPlaceholders = conceptArray.map(() => '?').join(',');
  const projects = (options.projects ?? []).filter(project => project.trim().length > 0);
  if (projects.length > PROJECT_KEYS_PER_QUERY) {
    const batches: LocalObservation[][] = [];
    for (let offset = 0; offset < projects.length; offset += PROJECT_KEYS_PER_QUERY) {
      batches.push(queryObservationsNewest(db, config, { ...options, projects: projects.slice(offset, offset + PROJECT_KEYS_PER_QUERY) }));
    }
    return newestUniqueRows(batches, options.limit);
  }

  const manualClause = options.includeManualSaves
    ? `substr(o.memory_session_id, 1, 7) = 'manual-' OR`
    : '';

  // #3274: SessionStart injection opts in. The seat INDEX passes `projects`
  // too, and must keep agent-tagged rows. A subagent row carries BOTH agent_id
  // and agent_type: transcript-watch rows (Grok Bot seats) carry agent_id alone
  // and must stay injected, or `session_start_context` returns nothing for them.
  const agentFilter = options.excludeSubagents ? `AND ${mainAgentRowSql('o')}` : '';

  const reinforcementColumn = options.withReinforcementDates ? ',\n      o.reinforcement_dates' : '';

  // json_each throws on a non-JSON concepts value, which would fail the whole
  // query and drop all context. Such a row cannot match a concept, so skip it.
  const filterSql = `(? IS NULL OR s.platform_source = ?)
      ${agentFilter}
      AND (${manualClause} (
        type IN (${typePlaceholders})
        AND EXISTS (
          SELECT 1 FROM json_each(CASE WHEN json_valid(o.concepts) THEN o.concepts ELSE '[]' END)
          WHERE value IN (${conceptPlaceholders})
        )
      ))`;
  const filterParams = [
    options.platformSource ?? null,
    options.platformSource ?? null,
    ...typeArray,
    ...conceptArray,
  ];

  if (projects.length === 0) {
    const statement = db.db.prepare(`
      SELECT
        ${OBSERVATION_SELECT}${reinforcementColumn}
      FROM observations o
      LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      WHERE ${filterSql}
      ORDER BY o.created_at_epoch DESC
      LIMIT ?
    `);
    try {
      return statement.all(...filterParams, options.limit) as LocalObservation[];
    } finally {
      statement.finalize();
    }
  }

  const winnersSql = newestIdsPerProjectKeySql('o', projects.length, keyPredicate => `
      SELECT o.id, o.created_at_epoch
      FROM observations o
      LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      WHERE ${keyPredicate} AND ${filterSql}
      ORDER BY o.created_at_epoch DESC
      LIMIT ?`);
  const perKeyParams = PROJECT_KEY_COLUMNS.flatMap(() =>
    projects.flatMap(project => [project, ...filterParams, options.limit]));

  const statement = db.db.prepare(`
    SELECT
      ${OBSERVATION_SELECT}${reinforcementColumn}
    FROM (${winnersSql}) w
    JOIN observations o ON o.id = w.id
    LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
    ORDER BY o.created_at_epoch DESC
  `);
  try {
    return statement.all(...perKeyParams, options.limit) as LocalObservation[];
  } finally {
    statement.finalize();
  }
}

export function querySummariesMulti(
  db: DatabaseOwner,
  projects: string[],
  config: ContextConfig,
  platformSource?: string
): LocalSessionSummary[] {
  if (projects.length === 0) return [];
  const limit = config.sessionCount + SUMMARY_LOOKAHEAD;
  if (projects.length > PROJECT_KEYS_PER_QUERY) {
    const batches: LocalSessionSummary[][] = [];
    for (let offset = 0; offset < projects.length; offset += PROJECT_KEYS_PER_QUERY) {
      batches.push(querySummariesMulti(db, projects.slice(offset, offset + PROJECT_KEYS_PER_QUERY), config, platformSource));
    }
    return newestUniqueRows(batches, limit);
  }
  const platformParams = [platformSource ?? null, platformSource ?? null];

  const winnersSql = newestIdsPerProjectKeySql('ss', projects.length, keyPredicate => `
      SELECT ss.id, ss.created_at_epoch
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
      WHERE ${keyPredicate} AND (? IS NULL OR s.platform_source = ?)
      ORDER BY ss.created_at_epoch DESC
      LIMIT ?`);
  const perKeyParams = PROJECT_KEY_COLUMNS.flatMap(() =>
    projects.flatMap(project => [project, ...platformParams, limit]));

  const statement = db.db.prepare(`
    SELECT
      ss.id,
      ss.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      ss.request,
      ss.investigated,
      ss.learned,
      ss.completed,
      ss.next_steps,
      ss.notes,
      ss.created_at,
      ss.created_at_epoch,
      ss.project
    FROM (${winnersSql}) w
    JOIN session_summaries ss ON ss.id = w.id
    LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
    ORDER BY ss.created_at_epoch DESC
  `);
  try {
    return statement.all(...perKeyParams, limit) as LocalSessionSummary[];
  } finally {
    statement.finalize();
  }
}

