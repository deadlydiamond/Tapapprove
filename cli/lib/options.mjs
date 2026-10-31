// Turns Claude Code's permission_suggestions into the "for this session" answers the watch
// offers. The rules themselves stay on this computer: the watch only picks a number from
// this list, so neither the watch nor the relay can invent a rule.

import { mask, titleFor } from './describe.mjs';

const MAX_OPTIONS = 3;
const MAX_LABEL = 200;

const SESSION_ONLY = { destination: 'session' };

function nameRule({ toolName, ruleContent } = {}) {
  if (ruleContent) return String(ruleContent).replace(/^domain:/, '');
  if (!toolName) return null;
  return String(toolName).startsWith('mcp__') ? titleFor(String(toolName)) : String(toolName);
}

function whatItAllows(suggestion) {
  if (suggestion?.type === 'addRules' && suggestion.behavior === 'allow' && suggestion.rules?.length) {
    const names = suggestion.rules.map(nameRule);
    return names.every(Boolean) ? names.join(', ') : null;
  }
  if (suggestion?.type === 'setMode' && suggestion.mode === 'acceptEdits') return 'all edits';
  if (suggestion?.type === 'addDirectories' && suggestion.directories?.length) {
    return `access to ${suggestion.directories.join(', ')}`;
  }
  return null;
}

export function sessionOptions(tool, suggestions) {
  const options = [];
  for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
    const what = whatItAllows(suggestion);
    if (!what) continue;
    const label = `Yes, allow ${mask(what)} for this session`;
    // A label cut short could hide what the rule allows, so it is not offered at all.
    if (label.length > MAX_LABEL) continue;
    options.push({ label, update: { ...suggestion, ...SESSION_ONLY } });
    if (options.length === MAX_OPTIONS) break;
  }
  // Claude Code builds some dialogs' answers itself and suggests nothing for them.
  if (options.length === 0 && String(tool).startsWith('mcp__')) {
    options.push({
      label: `Yes, allow ${titleFor(String(tool))} for this session`,
      update: { type: 'addRules', rules: [{ toolName: String(tool) }], behavior: 'allow', ...SESSION_ONLY },
    });
  }
  return options;
}
