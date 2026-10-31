import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionOptions } from '../lib/options.mjs';

const rule = (toolName, ruleContent, extra = {}) => ({
  type: 'addRules',
  rules: [{ toolName, ruleContent }],
  behavior: 'allow',
  destination: 'localSettings',
  ...extra,
});

test('a command rule names what it allows', () => {
  const [option] = sessionOptions('Bash', [rule('Bash', 'npm run *')]);
  assert.equal(option.label, 'Yes, allow npm run * for this session');
  assert.deepEqual(option.update.rules, [{ toolName: 'Bash', ruleContent: 'npm run *' }]);
});

test('a tap on the wrist lasts this session, even when Claude suggested saving the rule', () => {
  const [option] = sessionOptions('Bash', [rule('Bash', 'npm run *')]);
  assert.equal(option.update.destination, 'session');
});

test('a web rule names the domain', () => {
  const [option] = sessionOptions('WebFetch', [rule('WebFetch', 'domain:example.com')]);
  assert.equal(option.label, 'Yes, allow example.com for this session');
});

test('accepting edits says so', () => {
  const [option] = sessionOptions('Write', [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]);
  assert.equal(option.label, 'Yes, allow all edits for this session');
  assert.equal(option.update.mode, 'acceptEdits');
});

test('a directory names the folders', () => {
  const [option] = sessionOptions('Bash', [{ type: 'addDirectories', directories: ['/tmp'], destination: 'session' }]);
  assert.equal(option.label, 'Yes, allow access to /tmp for this session');
});

test('keeps Claude order and offers at most three', () => {
  const suggestions = ['a *', 'b *', 'c *', 'd *'].map((content) => rule('Bash', content));
  assert.deepEqual(
    sessionOptions('Bash', suggestions).map((option) => option.update.rules[0].ruleContent),
    ['a *', 'b *', 'c *'],
  );
});

test('offers nothing that widens access beyond allowing this kind of request', () => {
  const suggestions = [
    { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
    rule('Bash', 'rm *', { behavior: 'deny' }),
    { type: 'removeRules', rules: [{ toolName: 'Bash' }], behavior: 'deny', destination: 'session' },
  ];
  assert.deepEqual(sessionOptions('Bash', suggestions), []);
});

test('a rule too long to read in full is not offered', () => {
  assert.deepEqual(sessionOptions('Bash', [rule('Bash', 'a'.repeat(300))]), []);
});

test('an MCP tool without suggestions can be allowed by name, as Claude does for its own dialog', () => {
  const [option] = sessionOptions('mcp__claude-in-chrome__computer', []);
  assert.equal(option.label, 'Yes, allow claude-in-chrome: computer for this session');
  assert.deepEqual(option.update, {
    type: 'addRules',
    rules: [{ toolName: 'mcp__claude-in-chrome__computer' }],
    behavior: 'allow',
    destination: 'session',
  });
});

test('a command with no suggestions gets no session answer, so an ask rule keeps asking', () => {
  assert.deepEqual(sessionOptions('Bash', []), []);
});

test('odd input never throws', () => {
  assert.deepEqual(sessionOptions('Bash', undefined), []);
  assert.deepEqual(sessionOptions('Bash', 'nope'), []);
  assert.deepEqual(sessionOptions('Bash', [null, {}, { type: 'addRules' }, { type: 'addDirectories' }]), []);
});

test('a rule name holding hidden characters is shown as what it is', () => {
  const [option] = sessionOptions('Bash', [rule('Bash', 'npm\u202E run *')]);
  assert.match(option.label, /U\+202E/);
  assert.ok(!option.label.includes('\u202E'));
});

test('a rule says everything it allows, secrets and all, since that is what runs', () => {
  const [option] = sessionOptions('Bash', [rule('Bash', 'API_KEY=hunter2 npm run *')]);
  assert.equal(option.label, 'Yes, allow API_KEY=hunter2 npm run * for this session');
});

test('a rule that means little alone names its tool', () => {
  const [option] = sessionOptions('Edit', [rule('Edit', '/**')]);
  assert.equal(option.label, 'Yes, allow Edit file: /** for this session');
});
