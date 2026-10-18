import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root=new URL('../../',import.meta.url);

test('HTML adapter safety suite runs in same-commit deployment with an exact parser dependency',async()=>{
 const pkg=JSON.parse(await fs.readFile(new URL('package.json',root),'utf8'));
 assert.equal(pkg.dependencies.parse5,'7.3.0');
 assert.equal(pkg.scripts['test:about-html'],'playwright test --config tests/about_html/html.config.ts');
 const lock=JSON.parse(await fs.readFile(new URL('package-lock.json',root),'utf8'));
 assert.equal(lock.packages[''].dependencies.parse5,'7.3.0');
 const workflow=await fs.readFile(new URL('.github/workflows/deploy.yml',root),'utf8');
 const gate=workflow.indexOf('npm run test:about-html');
 assert.ok(gate>=0&&gate<workflow.indexOf('run: npm run build'));
 assert.match(workflow,/contents: read/);
 assert.doesNotMatch(workflow,/contents: write|git push|git commit|pull_request_target/);
});
test('HTML is an editor representation, never an executable public rendering channel',async()=>{
 const page=await fs.readFile(new URL('src/app/about/page.tsx',root),'utf8');
 const editor=await fs.readFile(new URL('src/components/admin/AboutEditor.tsx',root),'utf8');
 assert.match(editor,/aboutContentToHtml/);
 assert.match(editor,/aboutHtmlToContent/);
 assert.doesNotMatch(page,/aboutHtml|dangerouslySetInnerHTML|srcDoc/);
 assert.doesNotMatch(editor,/dangerouslySetInnerHTML|srcDoc|new DOMParser|\.innerHTML\s*=/);
 assert.match(page,/getAboutContent/);
 assert.match(editor,/ABOUT_CONTENT_FILENAME/);
});
