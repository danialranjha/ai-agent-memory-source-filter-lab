import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runExperiment } from './experiment.ts';

const expectedObs:any={
  all_sources:[115,114,113,109,107,106,105,104,103,102,101],
  claude_only:[114,113,109,101],codex_only:[115,102],unknown_only:[106],no_match:[],
  all_limit_one:[115],claude_limit_one:[114],alias_union:[114,113,109,101],source_case:[107]};
const expectedSummary:any={
  all_sources:[206,204,203,202,201],claude_only:[206,201],codex_only:[202],unknown_only:[],no_match:[],
  all_limit_one:[206,204],claude_limit_one:[206,201],alias_union:[206,201],source_case:[]};

function checks(fault='') {
  const runs=runExperiment(fault).runs;const byName=Object.fromEntries(runs.map(r=>[r.name,r]));
  const tests:[string,()=>void][]=[];
  tests.push(['exact observation IDs across nine configurations',()=>{for(const r of runs)assert.deepEqual(r.observations.map(x=>x.id),expectedObs[r.name]);}]);
  tests.push(['exact summary IDs across nine configurations',()=>{for(const r of runs)assert.deepEqual(r.summaries.map(x=>x.id),expectedSummary[r.name]);}]);
  tests.push(['own-source benign twin retained and other-source removed',()=>{assert(byName.claude_only.observations.some(x=>x.id===101));assert(!byName.claude_only.observations.some(x=>x.id===102));}]);
  tests.push(['NULL and absent join display fallback is not raw source identity',()=>{for(const id of [103,104]){assert.equal(byName.all_sources.observations.find(x=>x.id===id)?.displayed_source,'claude');assert(!byName.claude_only.observations.some(x=>x.id===id));}}]);
  tests.push(['empty source does not get NULL fallback',()=>{assert.equal(byName.all_sources.observations.find(x=>x.id===105)?.displayed_source,'');assert(!byName.claude_only.observations.some(x=>x.id===105));}]);
  tests.push(['project isolation and type/concept validity preserved',()=>{for(const r of runs)for(const x of r.observations)assert(![108,110,111,112].includes(x.id));}]);
  tests.push(['project casing matches while source casing remains distinct',()=>{assert(byName.claude_only.observations.some(x=>x.id===109));assert.deepEqual(byName.source_case.observations.map(x=>x.id),[107]);}]);
  tests.push(['filter occurs before result limit',()=>{assert.deepEqual(byName.all_limit_one.observations.map(x=>x.id),[115]);assert.deepEqual(byName.claude_limit_one.observations.map(x=>x.id),[114]);}]);
  tests.push(['merged aliases do not duplicate rows',()=>{assert.deepEqual(byName.alias_union.observations.map(x=>x.id),[114,113,109,101]);}]);
  tests.push(['markers remain exact inert bytes',()=>{for(const r of runs){for(const x of r.observations)assert.equal(x.marker,'INERT-NOTE');for(const x of r.summaries)assert.equal(x.marker,'INERT-SUMMARY');}}]);
  tests.push(['source extraction bytes preserved',()=>{const source=JSON.parse(readFileSync(new URL('artifacts/source.json',import.meta.url),'utf8'));assert.equal(createHash('sha256').update(readFileSync(new URL('vendor/queries.ts',import.meta.url))).digest('hex'),source.vendor_sha256);}]);
  const results=tests.map(([name,test])=>{try{test();return{name,passed:true};}catch(e){if(!(e instanceof assert.AssertionError))throw e;return{name,passed:false};}});
  return {fault:fault||'none',passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,errors:0,results};
}
const baseline=checks();assert.equal(baseline.failed,0,'baseline failed');
const faults=['drop_filter','coalesce_filter'].map(checks);
for(const fault of faults)assert(fault.failed>0,`undetected fault ${fault.fault}`);
writeFileSync(new URL('artifacts/checks.json',import.meta.url),JSON.stringify({baseline,faults,method:'Functional query faults tested on the same SQLite fixtures; no mutation of vendored source files'},null,2)+'\n');
console.log(JSON.stringify({baseline:{passed:baseline.passed,failed:baseline.failed},faults:faults.map(x=>({fault:x.fault,failed:x.failed,errors:x.errors}))}));
