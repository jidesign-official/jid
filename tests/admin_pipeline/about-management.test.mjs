import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=new URL('../../',import.meta.url);

async function publicationFixture(t) {
 const directory=await fs.mkdtemp(path.join(process.env.TMPDIR||os.tmpdir(),'about-publication-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 for(const name of ['package.json','tsconfig.json','src/lib','src/data/about.ts','tests/about_content']) {
  const target=path.join(directory,name);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.cp(new URL(name,root),target,{recursive:true});
 }
 await fs.symlink(fileURLToPath(new URL('node_modules',root)),path.join(directory,'node_modules'),'dir');
 return directory;
}
function publicationGate(directory) {
 return spawnSync('npm',['run','test:about-content','--','--reporter=json'],{
  cwd:directory,encoding:'utf8',timeout:60000,
  env:{...process.env,PLAYWRIGHT_JSON_OUTPUT_NAME:path.join(directory,'gate-report.json')},
 });
}
const gateOutput=result=>`${result.error||''}\n${result.stdout}\n${result.stderr}`;

test('About publication gate accepts legitimate nondefault text and structured order',{timeout:90000},async t=>{
 const directory=await publicationFixture(t);
 // Deliberately changed test input, never a replacement for the real browser export proof.
 const content={schemaVersion:1,headings:{eyebrow:'Studio profile',philosophy:'Our approach',history:'Milestones',services:'Capabilities'},introduction:{title:'Edited studio introduction',subtitle:'수정한 소개',paragraph:'변경한 회사 소개 본문입니다.'},philosophy:[{id:'new-approach',title:'New approach',subtitle:'새로운 방향',paragraph:'수정한 철학 문구입니다.'}],history:[{year:'2027',events:['새로운 연혁']},{year:'2020',events:['보존할 이전 연혁']}],services:[{name:'New service',description:'수정한 서비스 설명'}],links:{portfolioLabel:'Our work',contactLabel:'Contact the studio'}};
 const filename=path.join(directory,'about-content.json');
 const source=JSON.stringify(content,null,2)+'\n';
 await fs.writeFile(filename,source);
 const result=publicationGate(directory);
 assert.equal(result.status,0,gateOutput(result));
 const report=JSON.parse(await fs.readFile(path.join(directory,'gate-report.json'),'utf8'));
 assert.ok(report.stats.expected>0,'the real About Node suite executed');
 assert.equal(report.stats.unexpected,0);
 assert.equal(report.stats.skipped,0);
 assert.equal(report.stats.flaky,0);
 assert.deepEqual(report.errors,[]);
 assert.equal(await fs.readFile(filename,'utf8'),source);
});

test('About publication gate rejects an invalid present settings file',{timeout:90000},async t=>{
 const directory=await publicationFixture(t);
 await fs.writeFile(path.join(directory,'about-content.json'),'{"schemaVersion":1,"unexpected":"not content"}');
 const result=publicationGate(directory);
 assert.equal(result.status,1,gateOutput(result));
 const report=JSON.parse(await fs.readFile(path.join(directory,'gate-report.json'),'utf8'));
 assert.ok(report.stats.unexpected>0);
 assert.equal(report.stats.skipped,0);
 assert.deepEqual(report.errors,[]);
});

test('About editor receives published server content without changing search exclusion',async()=>{
 const page=await fs.readFile(new URL('src/app/vhxmvhffldhdjqfhemrkdlem/page.tsx',root),'utf8');
 assert.match(page,/getAboutContent/);
 assert.match(page,/initialAboutContent=\{\w+\}/);
 assert.match(page,/index: false/);
 assert.match(page,/follow: false/);
});
test('About tab retains its draft and participates in the combined unsaved boundary',async()=>{
 const source=await fs.readFile(new URL('src/components/admin/AdminWorkspace.tsx',root),'utf8');
 assert.match(source,/import AboutEditor from "\.\/AboutEditor"/);
 assert.match(source,/\["about", "About Us 편집",/);
 assert.match(source,/hidden=\{tab !== "about"\}/);
 assert.match(source,/initialContent=\{initialAboutContent\}/);
 assert.match(source,/onDirtyChange=\{setAboutDirty\}/);
 assert.match(source,/dirtyRef\.current = dirty \|\| catalogDirty \|\| aboutDirty/);
});
test('same-commit deployment validates editable About content before building',async()=>{
 const pkg=JSON.parse(await fs.readFile(new URL('package.json',root),'utf8'));
 assert.equal(pkg.scripts['test:about-content'],'playwright test --config tests/about_content/content.config.ts');
 const workflow=await fs.readFile(new URL('.github/workflows/deploy.yml',root),'utf8');
 const position=workflow.indexOf('npm run test:about-content');
 assert.ok(position>=0&&position<workflow.indexOf('run: npm run build'));
 assert.match(workflow,/contents: read/);
 assert.doesNotMatch(workflow,/contents: write|git push|git commit|pull_request_target/);
});
