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
  assert.match(workflow, /actions\/configure-pages@v5/);
  assert.match(workflow, /actions\/upload-pages-artifact@v3/);
  assert.match(workflow, /path:\s*\.\/web/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
});
