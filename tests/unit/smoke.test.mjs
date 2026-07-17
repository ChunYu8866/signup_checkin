import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('unit test runner is active', () => assert.equal(1 + 1, 2));

test('GitHub Pages workflow publishes only the web artifact from main', () => {
  const workflow = fs.readFileSync('.github/workflows/pages.yml', 'utf8');
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /actions\/configure-pages@[0-9a-f]{40} # v5/);
  assert.match(workflow, /enablement:\s*true/);
  assert.match(workflow, /actions\/upload-pages-artifact@[0-9a-f]{40} # v3/);
  assert.match(workflow, /path:\s*\.\/web/);
  assert.match(workflow, /actions\/deploy-pages@[0-9a-f]{40} # v4/);
});

test('every workflow action is pinned to a commit SHA and verify runs read-only', () => {
  for (const file of ['.github/workflows/pages.yml', '.github/workflows/verify.yml']) {
    const workflow = fs.readFileSync(file, 'utf8');
    const uses = workflow.match(/uses:\s*\S+/g) ?? [];
    for (const line of uses) {
      assert.match(line, /@[0-9a-f]{40}$/, `${file} 的 ${line} 必須釘選 40 碼 commit SHA（防 tag 被移動）`);
    }
  }
  const verify = fs.readFileSync('.github/workflows/verify.yml', 'utf8');
  assert.match(verify, /permissions:\s*\n\s*contents:\s*read/, 'verify workflow 必須是唯讀權杖');
});

test('index.html ships a strict CSP and no-referrer policy with no third-party resources', () => {
  const html = fs.readFileSync('web/index.html', 'utf8');
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'self' https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.doesNotMatch(html, /preconnect/, '不應保留未使用的第三方 preconnect');
  assert.doesNotMatch(html, /https?:\/\/(?!script\.google\.com|script\.googleusercontent\.com|www\.google\.com\/maps)/,
    'index.html 不應引用其他第三方網域');
});

test('deployed assets are minified and test scripts are stripped before upload', () => {
  const workflow = fs.readFileSync('.github/workflows/pages.yml', 'utf8');
  const minifyIndex = workflow.indexOf('Minify deployed assets');
  const uploadIndex = workflow.indexOf('actions/upload-pages-artifact');
  assert.ok(minifyIndex > -1, 'pages workflow must minify assets');
  assert.ok(minifyIndex < uploadIndex, 'minify must run before the artifact upload');
  assert.match(workflow, /esbuild@\d+\.\d+\.\d+ web\/assets\/js\/\*\.js --minify/);
  assert.match(workflow, /esbuild@\d+\.\d+\.\d+ web\/assets\/css\/app\.css --minify/);
  assert.match(workflow, /rm -f web\/test-checkin\.cjs/);
});
