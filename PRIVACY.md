# Tapapprove Privacy Policy

Last updated: 31 October 2026

Tapapprove lets you answer Claude Code permission prompts from your Apple Watch. It has no accounts, no ads and no analytics.

If you run your own relay, this data goes to your own Cloudflare account and you decide who can read it.

## What is sent

When Claude Code asks for permission, the Tapapprove command-line tool on your computer sends a short summary to the Tapapprove relay so your watch can show it:

- the tool name, such as "Bash"
- a summary of the request, such as the command to run or the file to change
- the name of the project folder

Before sending, the tool removes text that looks like a secret, such as tokens and passwords. This is pattern matching and cannot catch everything, so an unusual secret could be included. Do not approve from the watch in projects where this matters.

The relay also stores:

- the names you give your computer and your watch
- your watch's push notification token
- scrambled (hashed) versions of the access tokens that link your devices
- when your watch last checked in

## How long it is kept

- **Request text** is deleted as soon as you answer. Unanswered requests are deleted within about 30 minutes.
- **Pairing data** is kept until you unpair, by running `tapapprove unpair` or using Unpair on the watch.
- **Unused pairing codes** are deleted when they expire, after 10 minutes.

## Who handles it

- **Cloudflare** hosts the relay.
- **Apple** delivers push notifications. A notification includes the request title, the project name and the start of the request text.

Data is encrypted in transit, but it is not end-to-end encrypted: the relay can read the summaries while they are stored. We do not sell this data or use it for anything except delivering your approvals.

On your computer, a log at `~/.tapapprove/hook.log` records tool names and outcomes. It never includes command text and stays on your computer.

## Your choices

Unpairing deletes your pairing data from the relay. You can also delete the app and remove the hook at any time.

## Contact

Questions: open an issue at https://github.com/deadlydiamond/Tapapprove/issues
