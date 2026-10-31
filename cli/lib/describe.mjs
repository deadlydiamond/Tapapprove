// Turns a tool call into the text shown on the watch. Claude Code runs the original, so this
// must say exactly what runs, and nothing is masked: a password in a command shows too. The
// text is sealed before it leaves this computer and opens only on the person's own watch.

import { basename } from 'node:path';

// Approving means reading the end of the text, so anything longer never reaches the watch.
export const MAX_DETAIL = 100_000;
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

// Characters that hide text, reorder it, move the cursor or look like blank space. Tabs and line
// breaks stay, and plain spaces, whose long runs the notification check deals with.
const HIDDEN_TEXT = /[[\p{C}--[\t\n\r]]\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800[\p{Zs}--[ ]]]|\r(?!\n)/gv;
const ADDRESS = /[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>]+/gi;
const NON_ASCII = /[^\x00-\x7F]/gu;
const MAX_PROJECT = 40;

const writtenOut = (char) => `<U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}>`;

/** What the person reads must be what runs, so these are written out instead of taking effect. */
export function showHidden(text) {
  // A look-alike letter in an address could pass for a site the person trusts.
  return text.replace(HIDDEN_TEXT, writtenOut).replace(ADDRESS, (address) => address.replace(NON_ASCII, writtenOut));
}

/** A folder can be named anything, and this sits on one line beside the request. */
export function projectName(path) {
  if (!path) return undefined;
  return showHidden(basename(path).replace(/\s+/g, ' ').trim()).slice(0, MAX_PROJECT);
}

function asText(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 1);
}

export function titleFor(tool) {
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
    case 'Edit': {
      const replace = input.replace_all ? 'Replace every match of' : 'Replace';
      return `${asText(input.file_path)}\n\n${replace}:\n${asText(input.old_string)}\n\nWith:\n${asText(input.new_string)}`.trim();
    }
    case 'MultiEdit':
      return `${asText(input.file_path)}\n\n${asText(input.edits)}`.trim();
    case 'Write':
      return `${asText(input.file_path)}\n\n${asText(input.content)}`.trim();
    case 'NotebookEdit':
      return `${asText(input.notebook_path)}\n\n${asText(input.edit_mode ?? 'replace')} cell ${asText(input.cell_id)}\n\n${asText(input.new_source)}`.trim();
    case 'WebFetch':
      return asText(input.url);
    case 'WebSearch':
      return asText(input.query);
    case 'Task':
    case 'Agent': {
      const { description, prompt, ...others } = input;
      const rest = Object.keys(others).length ? `\n\n${asText(others)}` : '';
      return `${asText(description)}\n\n${asText(prompt)}${rest}`.trim();
    }
    default:
      return asText(input);
  }
}

export function describeTool(name, input) {
  const tool = String(name ?? 'Unknown');
  const args = input && typeof input === 'object' ? input : {};
  const detail = showHidden(rawDetail(tool, args));
  const hidden = detail.length - MAX_DETAIL;
  return {
    title: showHidden(titleFor(tool)).slice(0, MAX_TITLE),
    detail: hidden > 0 ? `${detail.slice(0, MAX_DETAIL)}\n… ${hidden} more characters not shown` : detail,
    truncated: hidden > 0,
  };
}
