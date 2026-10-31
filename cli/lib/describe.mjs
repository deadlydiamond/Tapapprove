// Turns a tool call into the short text shown on the watch. This text leaves the
// machine, so secrets are masked here, before anything is sent to the relay.

export const MAX_DETAIL = 1500;
const MAX_TITLE = 120;

const TITLES = {
  Bash: 'Run command',
  Edit: 'Edit file',
  MultiEdit: 'Edit file',
  Write: 'Write file',
  NotebookEdit: 'Edit notebook',
  WebFetch: 'Fetch URL',
  WebSearch: 'Web search',
  Task: 'Start agent',
  Agent: 'Start agent',
};

const SECRET_WORDS = 'token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential';

// Masking changes what the person reads while Claude Code runs the original, so it must
// never hide anything that executes. A value holding any of this is shown as it is, even
// though that can reveal a secret: a wrong approval costs more than a shown password.
const ACTIVE_TEXT = /[$`;|&<>()\n]/;

const unlessActive = (match, value, masked) => (ACTIVE_TEXT.test(value) ? match : masked);

const SECRET_PATTERNS = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***'],
  [
    new RegExp(`("[A-Za-z0-9_-]*(?:${SECRET_WORDS})[A-Za-z0-9_-]*"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*")`, 'gi'),
    (match, key, value) => unlessActive(match, value, `${key}"***"`),
  ],
  [
    new RegExp(`\\b([A-Za-z0-9_]*(?:${SECRET_WORDS})[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\\S+)`, 'gi'),
    (match, name, value) => unlessActive(match, value, `${name}=***`),
  ],
  [
    new RegExp(`(--[A-Za-z0-9-]*(?:${SECRET_WORDS})[A-Za-z0-9-]*)(=|\\s+)(\\S+)`, 'gi'),
    (match, flag, separator, value) => unlessActive(match, value, `${flag}${separator}***`),
  ],
  [/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, '***'],
  [/(:\/\/[^\s:/@]+:)([^\s/@]+)@/g, (match, prefix, value) => unlessActive(match, value, `${prefix}***@`)],
];

function mask(text) {
  return SECRET_PATTERNS.reduce((masked, [pattern, replacement]) => masked.replace(pattern, replacement), text);
}

function asText(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 1);
}

function titleFor(tool) {
  if (TITLES[tool]) return TITLES[tool];
  const mcp = tool.match(/^mcp__(.+?)__(.+)$/);
  return mcp ? `${mcp[1]}: ${mcp[2]}` : tool;
}

function rawDetail(tool, input) {
  switch (tool) {
    case 'Bash': {
      const command = asText(input.command);
      return input.dangerouslyDisableSandbox ? `Runs outside the sandbox\n\n${command}` : command;
    }
    case 'Edit':
    case 'MultiEdit':
      return `${asText(input.file_path)}\n\n${asText(input.new_string ?? input.edits)}`.trim();
    case 'Write':
      return `${asText(input.file_path)}\n\n${asText(input.content)}`.trim();
    case 'NotebookEdit':
      return `${asText(input.notebook_path)}\n\n${asText(input.new_source)}`.trim();
    case 'WebFetch':
      return asText(input.url);
    case 'WebSearch':
      return asText(input.query);
    case 'Task':
    case 'Agent':
      return `${asText(input.description)}\n\n${asText(input.prompt)}`.trim();
    default:
      return asText(input);
  }
}

export function describeTool(name, input) {
  const tool = String(name ?? 'Unknown');
  const args = input && typeof input === 'object' ? input : {};
  // Mask before cutting, so the cut can never split a secret out of a pattern's reach.
  const detail = mask(rawDetail(tool, args));
  const hidden = detail.length - MAX_DETAIL;
  return {
    title: titleFor(tool).slice(0, MAX_TITLE),
    detail: hidden > 0 ? `${detail.slice(0, MAX_DETAIL)}\n… ${hidden} more characters not shown` : detail,
    truncated: hidden > 0,
  };
}
