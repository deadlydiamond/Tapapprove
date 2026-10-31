# tapapprove

Approve Claude Code permission prompts from your Apple Watch.

An independent project, not made by or affiliated with Anthropic or Apple.

```sh
npx tapapprove pair <code>   # the 20-character code shown in the Tapapprove watch app
npx tapapprove test          # send a test request to your watch
npx tapapprove status        # show the pairing, the relay and the hook
npx tapapprove unpair        # remove the pairing and the hook
```

`pair` adds a `PermissionRequest` hook to `~/.claude/settings.json`. Use `--scope project` to add it to the current project only, and `--relay <url>` if you run your own relay.

## What leaves your computer

For each permission prompt, the request goes through the relay to your watch: the tool name, the full command or file change, and the project folder name. It is end-to-end encrypted, with keys only your computer and your watch hold, so the relay can read none of it. Every answer carries a proof from the watch, so the relay cannot approve anything either.

Nothing is masked, because what you read must be what runs, so a password inside a command shows on your watch too.

## When something goes wrong

Only a real answer from your watch produces a decision. If the relay is down or nobody answers, the hook stays silent and Claude Code's own dialog decides. A failure never becomes an approval.
