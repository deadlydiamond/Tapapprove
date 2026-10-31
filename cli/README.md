# tapapprove

Approve Claude Code permission prompts from your Apple Watch.

An independent project, not made by or affiliated with Anthropic or Apple.

```sh
npx tapapprove pair <code>   # the code shown in the Tapapprove watch app
npx tapapprove test          # send a test request to your watch
npx tapapprove status        # show the pairing, the relay and the hook
npx tapapprove unpair        # remove the pairing and the hook
```

`pair` adds a `PermissionRequest` hook to `~/.claude/settings.json`. Use `--scope project` to add it to the current project only.

## What leaves your computer

For each permission prompt, a short summary goes to the relay so your watch can show it: the tool name, the command or file change, and the project folder name. Text that looks like a secret is removed first, unless removing it could hide something that runs. This is pattern matching, so an unusual secret can get through.

## When something goes wrong

Only a real answer from your watch produces a decision. If the relay is down or nobody answers, the hook stays silent and Claude Code's own dialog decides. A failure never becomes an approval.
