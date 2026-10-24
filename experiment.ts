import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { queryObservationsNewest, querySummariesMulti } from './vendor/queries.ts';

const root = new URL('.', import.meta.url);
export const fixtures = JSON.parse(readFileSync(new URL('fixtures.json', root), 'utf8'));
export const configurations = [
  {name:'all_sources', source:undefined, projects:['alpha'], limit:30},
  {name:'claude_only', source:'claude', projects:['alpha'], limit:30},
  {name:'codex_only', source:'codex', projects:['alpha'], limit:30},
  {name:'unknown_only', source:'other', projects:['alpha'], limit:30},
  {name:'no_match', source:'unregistered', projects:['alpha'], limit:30},
  {name:'all_limit_one', source:undefined, projects:['alpha'], limit:1},
  {name:'claude_limit_one', source:'claude', projects:['alpha'], limit:1},
  {name:'alias_union', source:'claude', projects:['alpha','legacy'], limit:30},
  {name:'source_case', source:'Claude', projects:['alpha'], limit:30},
];

// Both faults are diagnostic test switches, never active in recorded results.
export function runCase(config:typeof configurations[number], fault:string='') {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sdk_sessions(memory_session_id TEXT PRIMARY KEY,content_session_id TEXT,platform_source TEXT);
    CREATE TABLE observations(id INTEGER PRIMARY KEY,memory_session_id TEXT,type TEXT,title TEXT,subtitle TEXT,narrative TEXT,facts TEXT,concepts TEXT,files_read TEXT,files_modified TEXT,discovery_tokens INTEGER,created_at TEXT,created_at_epoch INTEGER,project TEXT,merged_into_project TEXT);
    CREATE TABLE session_summaries(id INTEGER PRIMARY KEY,memory_session_id TEXT,request TEXT,investigated TEXT,learned TEXT,completed TEXT,next_steps TEXT,notes TEXT,created_at TEXT,created_at_epoch INTEGER,project TEXT,merged_into_project TEXT);
  `);
  for (const [table, rows] of [['observations',fixtures.observations],['session_summaries',fixtures.summaries]] as const) {
    for (const row of rows) {
      const session = `s${row.id}`;
      if (row.session_present) db.prepare('INSERT INTO sdk_sessions VALUES(?,?,?)').run(session,`c${row.id}`,row.source);
      if (table==='observations') {
        db.prepare('INSERT INTO observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(row.id,session,row.type,row.name,null,row.marker,'[]',row.concepts,'[]','[]',0,'2026-01-01T00:00:00Z',row.timestamp,row.project,row.merged_into_project);
      } else {
        db.prepare('INSERT INTO session_summaries VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(row.id,session,row.marker,null,null,null,null,null,'2026-01-01T00:00:00Z',row.timestamp,row.project,row.merged_into_project);
      }
    }
  }
  const adapter={db:{prepare(sql:string) {
    const changed = fault==='coalesce_filter' ? sql.replaceAll('s.platform_source = ?',"COALESCE(s.platform_source, 'claude') = ?") : sql;
    const statement=db.prepare(changed);
    return {all:(...params:any[])=>statement.all(...params),finalize:()=>{}};
  }}};
  const selectedSource=fault==='drop_filter' ? undefined : config.source;
  const settings={observationTypes:['discovery'],observationConcepts:['security'],sessionCount:config.limit};
  try {
    const observations=queryObservationsNewest(adapter,settings,{projects:config.projects,platformSource:selectedSource,limit:config.limit,excludeSubagents:false});
    const summaries=querySummariesMulti(adapter,config.projects,settings,selectedSource);
    const output=(rows:any[],original:any[],key:string)=>rows.map(row=>{
      const fixture=original.find(x=>x.id===row.id);
      return {id:row.id,name:fixture.name,raw_source:fixture.source,session_present:fixture.session_present,displayed_source:row.platform_source,project:row.project,marker:row[key]};
    });
    return {name:config.name,source:config.source??null,projects:config.projects,observation_limit:config.limit,summary_limit:config.limit+1,
      observations:output(observations,fixtures.observations,'narrative'),summaries:output(summaries,fixtures.summaries,'request')};
  } finally { db.close(); }
}

export function runExperiment(fault:string='') {
  return {scope:'Source query component with synthetic SQLite rows; no model, renderer, startup hook, hosted store or real memory',
    counts:{observation_fixtures:fixtures.observations.length,summary_fixtures:fixtures.summaries.length,configurations:configurations.length,query_results:configurations.length*2},
    runs:configurations.map(c=>runCase(c,fault))};
}

function evidence(result:ReturnType<typeof runExperiment>) {
  const a=result.runs[0],b=result.runs[1];
  const lines=['# Exact query evidence','',result.scope+'.','',
    'Control: source predicate unset. Intervention: source predicate `claude`. Project remains `alpha`; all other settings and input rows are identical.','',
    '| Observation | Raw source | All sources display | Claude-only display |',
    '|---|---|---|---|'];
  for(const f of fixtures.observations){
    const aa=a.observations.find(x=>x.id===f.id),bb=b.observations.find(x=>x.id===f.id);
    const raw=!f.session_present?'missing joined session':JSON.stringify(f.source);
    lines.push(`| ${f.id} ${f.name} | ${raw} | ${aa?JSON.stringify(aa.displayed_source):'not returned'} | ${bb?JSON.stringify(bb.displayed_source):'not returned'} |`);
  }
  lines.push('','| Configuration | Observation IDs (returned order) | Summary IDs |','|---|---|---|');
  for(const r of result.runs)lines.push(`| ${r.name} | ${r.observations.map(x=>x.id).join(', ')||'none'} | ${r.summaries.map(x=>x.id).join(', ')||'none'} |`);
  lines.push('','All returned observation markers are `INERT-NOTE`; summary markers are `INERT-SUMMARY`. Different IDs can contain identical text.',
    '',`The input contains ${result.counts.observation_fixtures} observation fixtures and ${result.counts.summary_fixtures} summary fixtures. Nine configurations produce 18 query result sets. These are selected cases, not model trials, attack rates or a sampled denominator.`,
    '','The all-source view labels NULL or missing-session provenance as `claude` through SELECT COALESCE, but the source-specific WHERE uses raw equality and excludes those records. Empty strings remain empty, not claude. No row or metadata is changed by filtering.',
    '','The source filter is a query parameter, not authenticated provenance. Case-sensitive source matching, case-insensitive project matching, merged aliases and the source summary lookahead of 1 are deliberate observed boundaries. Upstream ranking, subagent policy, actual hooks and server mode are outside this test.','');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=runExperiment();
  writeFileSync(new URL('artifacts/run.json',root),JSON.stringify(result,null,2)+'\n');
  writeFileSync(new URL('artifacts/evidence.md',root),evidence(result));
  console.log(JSON.stringify(result.counts));
}
