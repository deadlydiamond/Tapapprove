# Security

An approval from the watch makes a command run on your computer, so the design assumes the relay in the middle can be hacked. No software can promise it will never be broken into. This page says what is protected, what is not, and how to report a problem.

## If the relay is fully compromised

Someone who controls the relay, or the network around it, **cannot**:

- **Read your requests.** The computer seals each request with a key only it and your watch hold. The relay stores and forwards text it cannot open.
- **Approve anything by itself.** Every answer carries a proof made with a key only the watch and computer hold. The hook checks it, and an answer without a valid proof is ignored, so Claude Code's own dialog decides.
- **Trick a Yes out of a notification.** The relay writes every push, so it could put any text on your wrist and point it at a real waiting request. A Yes only counts when the notification shows exactly what the computer sealed for that request, word for word, with the same buttons. If it does not, nothing is sent and the watch says so.
- **Show a fake request inside the app.** Text that does not open with the shared key, or that was moved from another request, is never shown.
- **Add a permission rule.** The rules behind "for this session" answers stay on your computer. The watch only sends a number, and that number is covered by the proof.
- **Write on the pairing screen.** The only thing it supplies there is the first 4 characters of the code, and the watch refuses anything but 4 letters and digits from the code's alphabet.

It **can**:

- See when requests happen, how many there are, roughly how big each one is (sizes come in steps), and whether each was answered yes, no or with a session answer.
- See your watch's push token.
- Delay or drop anything, so a request may never arrive. That only means you answer on the computer instead. A failure is never an approval.
- Put a fake notification on your wrist. A Yes on it sends nothing. A No on it can deny the real request it points at, which is no more than dropping that request would do.
- Make the watch ask you to pair again. A new pairing is as safe as the first, and it cannot learn the code.

## Pairing

The watch shows a 20 character code. The first 4 go to the relay to find the pairing. The other 16, 80 bits, never leave your devices.

The two devices exchange X25519 public keys through the relay, and each proves it knows the secret part with an HMAC keyed through PBKDF2-SHA256 (100,000 rounds). A hacked relay gets to see one of those proofs, and could test guesses against it for as long as it likes, so the secret is long enough that guessing is out of reach. Once paired, learning the code later does not reveal the keys, because they also depend on the X25519 exchange.

Treat the code like a password while it is on screen: anyone who sees it and reaches the relay first could try to pair in your place. You would notice, because your own `pair` would then fail.

Pair on a command you read: it should be `npx tapapprove pair` and the code, nothing more.

## Encryption

- Requests and instructions: AES-256-GCM, each tied to one request ID, and padded so that their length gives away less.
- Answers: HMAC-SHA256 over the request ID, the answer, the chosen option and any sealed message. Both sides refuse any of those fields that does not have its exact expected shape, because they are joined into one text.
- Three separate keys come from HKDF-SHA256 over the X25519 secret.
- Keys live in the watch's Keychain and in `~/.tapapprove/config.json` (mode 600) on the computer.

`cli/lib/e2e.mjs` and `watch/Tapapprove/ChannelCrypto.swift` hold the cryptography. `watch/Tapapprove/NotificationAnswer.swift` decides what a tap on a notification may do. `watch/TapapproveTests` and `cli/test` play a hacked relay against all of it, and `scripts/forge-requests.mjs` does the same in the end-to-end test.

## What you read is what runs

Claude Code runs the original request, so the watch shows the original:

- Nothing is masked. A password in a command shows on your wrist too. Masking used to hide secrets, but any text it hides can also be something that runs, and the text now opens only on your own watch.
- Characters that reorder or hide text, blank look-alikes of a space, and terminal control codes are written out as `<U+202E>` instead of taking effect. So are non-ASCII letters inside an address, where a look-alike could pass for a site you trust.
- A notification offers Yes only for a short request with no long runs of blank space, and only once it has been on screen for a moment, so a notification replaced under your finger gets refused. Anything longer opens the app, where the answers come after the end of the text.

Two things are left as they are, because other languages need them: look-alike letters outside an address, such as a file name, and right-to-left text, which can change the order parts of a line appear in.

## What this does not protect against

- **A compromised computer or watch.** Whoever controls either device has the keys, and on the computer can run commands anyway. That includes a Claude session allowed to read `~/.tapapprove/config.json`. On its own that gets nowhere, because the relay refuses answers made with the computer's token, but a hacked relay together with those keys defeats everything on this page.
- **Approving something you did not read.** A short request can be approved from its notification, and a long one needs a scroll past the text, but nothing can make you read it.
- **Double Tap.** On watches that have it, the gesture may act as the first button on a notification, which is Yes. This has not been tested.
- **Prompts injected into Claude.** This tool shows you what Claude wants to do. It does not judge whether that is a good idea.
- **Apple's push service and Cloudflare seeing metadata**, such as your watch's push token and when requests happen.

## Reviews

In October 2026 an AI agent that took no part in writing this code attacked it twice, as a hacked relay and as a prompt-injected Claude, with working proofs where it could. The first round broke the design: a Yes on a fake notification approved a real request, and a tap on No could become an approval. Those and the rest of its findings are fixed, and its second round could not get a hacked relay past the current code. It could not test real push delivery or how a watch renders a notification. This is not a professional audit, and finding no more holes does not mean there are none.

## Reporting a problem

Please report security problems privately through [GitHub security advisories](https://github.com/deadlydiamond/Tapapprove/security/advisories/new), not in a public issue.
