// Builds what the relay carries for a request and reads the answer that comes back. The relay
// sees sealed text and a yes or no, and every answer must prove it came from the watch.

import { randomUUID } from 'node:crypto';
import { open, seal, verifyDecision } from './e2e.mjs';

// What a watch notification can show without cutting.
const MAX_BODY = 178;
const MAX_LINES = 8;
// Blank lines or spaces like these could push the rest of a short request out of sight.
const SPREAD_OUT = /(?:[ \t]*\n){3,}|[ \t]{8,}/;
// The relay sees how long sealed text is, so sizes come in steps. JSON ignores the padding spaces.
const REQUEST_STEP = 4096;
const PREVIEW_STEP = 1024;
const ENDED_STATUSES = new Set(['pending', 'expired', 'cancelled', 'timeout']);
// Base64, the only shape sealed text has.
const SEALED_TEXT = /^[A-Za-z0-9+/]+={0,2}$/;

const padded = (text, step) => text + ' '.repeat((step - (Buffer.byteLength(text) % step)) % step);

const showsWhole = (detail) => !SPREAD_OUT.test(detail) && detail.split('\n').length <= MAX_LINES;

/** Yes appears on a notification only when it can show the whole request. */
export function notificationPreview({ title, detail, project, options = [] }) {
  const option = options[0];
  const whole = option ? `${detail}\n\n${option}` : detail;
  const fits = whole.length <= MAX_BODY && showsWhole(detail);
  return {
    title,
    subtitle: project,
    body: fits ? whole || 'Tap to review' : `${detail.slice(0, MAX_BODY)}…`,
    category: !fits ? 'TAPAPPROVE_REVIEW' : option ? 'TAPAPPROVE_QUICK_SESSION' : 'TAPAPPROVE_QUICK',
  };
}

export function sealRequest(keys, { tool, title, detail, project, options = [], ttlSeconds }) {
  const id = randomUUID();
  return {
    id,
    sealed: seal(keys.requestKey, padded(JSON.stringify({ tool, title, detail, project, options }), REQUEST_STEP), `req:${id}`),
    preview: seal(
      keys.requestKey,
      padded(JSON.stringify(notificationPreview({ title, detail, project, options })), PREVIEW_STEP),
      `preview:${id}`,
    ),
    ttlSeconds,
  };
}

/**
 * The fields of a proof are joined into one text, so anything else here, such as an option
 * holding a line break, could make a proof for one answer read as a proof for another.
 */
function hasTheShapeOfAnAnswer({ status, option, sealedMessage }) {
  const noOption = option === undefined || option === null;
  const noMessage = sealedMessage === undefined || sealedMessage === null;
  if (status === 'allow') return noMessage && (noOption || (Number.isInteger(option) && option >= 0));
  return noOption && (noMessage || (typeof sealedMessage === 'string' && SEALED_TEXT.test(sealedMessage)));
}

/** Anything claiming to be an answer without the watch's proof becomes `forged`, never a decision. */
export function openAnswer(keys, id, answer) {
  const { status, option, proof, sealedMessage } = answer;
  // A status is printed later, so one the relay made up never gets that far.
  if (status !== 'allow' && status !== 'deny') return { status: ENDED_STATUSES.has(status) ? status : 'unknown' };
  if (!hasTheShapeOfAnAnswer(answer)) return { status: 'forged' };
  if (!verifyDecision(keys.proofKey, { id, decision: status, option, sealedMessage, proof })) return { status: 'forged' };
  if (!sealedMessage) return { status, option };
  try {
    return { status, option, message: open(keys.answerKey, sealedMessage, `msg:${id}`).trimEnd() };
  } catch {
    return { status: 'forged' };
  }
}
