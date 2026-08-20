import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const workflowDirectory = '.github/workflows';
const workflowFiles = readdirSync(workflowDirectory)
  .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  .sort();

assert.ok(workflowFiles.length > 0, 'no GitHub Actions workflows found');

const failures = [];
const fullCommitSha = /^[0-9a-f]{40}$/;

for (const file of workflowFiles) {
  const path = `${workflowDirectory}/${file}`;
  const source = readFileSync(path, 'utf8');

  if (!/^permissions:\n  contents: read$/m.test(source)) {
    failures.push(`${path}: must declare top-level read-only contents permission`);
  }
  if (!/timeout-minutes:\s*\d+/.test(source)) {
    failures.push(`${path}: every workflow must have a job timeout`);
  }

  const forbidden = [
    [/\$\{\{\s*secrets\./, 'must not access GitHub secrets'],
    [/\bpull_request_target\s*:/, 'must not use pull_request_target'],
    [/\bself-hosted\b/, 'must not run on a self-hosted machine'],
    [/\bnpm\s+install\b/, 'must use npm ci instead of npm install'],
    [/\bnpx\b/, 'must not download and execute packages through npx'],
    [/permissions:\s*write-all/, 'must not request write-all permission'],
    [
      /\b(?:contents|actions|checks|deployments|id-token|issues|packages|pages|pull-requests|security-events|statuses):\s*write\b/,
      'must not request write permission'
    ],
    [/curl[^\n|]*\|\s*(?:ba)?sh\b/, 'must not pipe downloaded code into a shell'],
    [/wget[^\n|]*\|\s*(?:ba)?sh\b/, 'must not pipe downloaded code into a shell']
  ];

  for (const [pattern, message] of forbidden) {
    if (pattern.test(source)) failures.push(`${path}: ${message}`);
  }

  for (const match of source.matchAll(/^\s*-?\s*uses:\s*([^@\s]+)@([^\s#]+)/gm)) {
    const [, action, reference] = match;
    if (action.startsWith('./')) continue;
    if (!fullCommitSha.test(reference)) {
      failures.push(`${path}: ${action} must be pinned to a full 40-character commit SHA`);
    }
    if (!action.startsWith('actions/')) {
      failures.push(`${path}: only GitHub-owned actions/* actions are allowed (${action})`);
    }
  }
}

assert.deepEqual(failures, [], `unsafe workflow configuration:\n- ${failures.join('\n- ')}`);

console.log(
  JSON.stringify({ ok: true, suite: 'workflow-security', workflows: workflowFiles.length })
);
