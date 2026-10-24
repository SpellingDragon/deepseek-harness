---
kind: upgrade-guide
description: Subagent model-selection settings now apply to running and restored Sessions, and affected logs contain a policy-change event that older harness versions cannot read.
---

# Live subagent model authorization

English | [中文](guide.zh.md)

## Change

Saving the Subagent model-selection setting now updates every running Session, including child Sessions, and Sessions restored afterwards. Previously only Sessions created after the save used the new authorization. A Session log can now contain `subagent/model-selection-policy-change` events.

Older harness versions do not recognize that required event and refuse to open a Session containing it. Downgrade support is not provided.

## Migration

1. Upgrade every harness process that shares the Session store before changing model selection.
2. Keep running or restore the existing Session; no new conversation is required. Its next `list_subagent_models` or `subagent` call uses the current authorization.
3. Confirm the change through the next discovery result or by finding `subagent/model-selection-policy-change` in the Session log.
4. To revert, keep a backup of the Session log from before the setting changed or continue with the newer harness. An older harness cannot resume a log that contains the new event.
