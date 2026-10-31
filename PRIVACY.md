# Tapapprove Privacy Policy

Last updated: 31 October 2026

Tapapprove lets you answer Claude Code permission prompts from your Apple Watch. It has no accounts, no ads and no analytics.

If you run your own relay, this data goes to your own Cloudflare account instead.

## What is sent

When Claude Code asks for permission, the Tapapprove command-line tool on your computer seals the request and sends it to the Tapapprove relay, which passes it to your watch. A request holds:

- the tool name, such as "Bash"
- the full text of the request, up to 100,000 characters, such as the command to run, or the path and new content of a file being changed
- the name of the project folder

**The relay cannot read any of this.** It is end-to-end encrypted with keys that only your computer and your watch hold, and those keys never reach the relay. The same goes for anything you tell Claude to do instead. Nothing is removed from the text first, so a password inside a command reaches your watch too, because what you read must be what runs.

The relay can see and stores:

- your watch's push notification token
- scrambled (hashed) versions of the access tokens that link your devices
- when your watch last checked in
- when each request was made, roughly how big it was, and whether it was answered yes or no

## How long it is kept

- **Sealed requests** are deleted as soon as you answer. Unanswered requests are deleted within about 30 minutes.
- **The yes or no, and anything sealed you told Claude to do instead,** are deleted within about 30 minutes.
- **Pairing data** is kept until you unpair, by running `tapapprove unpair` or using Unpair on the watch.
- **Unused pairing codes** are deleted when they expire, after 10 minutes.

## Who handles it

- **Cloudflare** hosts the relay.
- **Apple** delivers push notifications. A notification travels with generic text and a sealed preview, and your watch opens the preview itself.

We do not sell this data or use it for anything except delivering your approvals.

On your computer, a log at `~/.tapapprove/hook.log` records tool names and outcomes. It never includes command text and stays on your computer.

## Your choices

Unpairing deletes your pairing data from the relay. You can also delete the app and remove the hook at any time.

## Contact

Questions: open an issue at https://github.com/deadlydiamond/Tapapprove/issues
