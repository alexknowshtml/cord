---
name: cord
description: Send messages, embeds, files, and interactive buttons to Discord via the Cord CLI. Use for notifications, reports, interactive choices, and dynamic Discord interactions.
triggers:
  - "send to discord"
  - "post to discord"
  - "discord message"
  - "notify discord"
---

# Cord - Discord Bridge Skill

Interact with Discord through Cord's CLI commands. This skill teaches Claude Code how to send messages, embeds, files, and interactive buttons.

**GitHub:** https://github.com/alexknowshtml/cord

## Setup

Ensure Cord is running:
```bash
cord start
```

Verify it's connected:
```bash
curl -s http://localhost:2643/health
# {"status":"ok","connected":true,"user":"MyBot#1234"}
```

---

## CLI Commands

### send

Send a text message to a channel or thread.

```bash
cord send <channel> "message"
```

**Example:**
```bash
cord send 123456789 "Hello world!"
```

---

### embed

Send a formatted embed card with optional styling.

```bash
cord embed <channel> "description" [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--title "..."` | Embed title |
| `--url "..."` | Title link URL |
| `--color <name\|hex>` | red, green, blue, yellow, purple, orange, or 0xHEX |
| `--author "..."` | Author name |
| `--author-url "..."` | Author link |
| `--author-icon "..."` | Author icon URL |
| `--thumbnail "..."` | Small image (top right) |
| `--image "..."` | Large image (bottom) |
| `--footer "..."` | Footer text |
| `--footer-icon "..."` | Footer icon URL |
| `--timestamp` | Add current timestamp |
| `--field "Name:Value"` | Add field (append `:inline` for inline) |

**Examples:**

Simple embed:
```bash
cord embed 123456789 "Daily status update" --title "Status Report" --color green
```

Embed with fields:
```bash
cord embed 123456789 "Build completed successfully" \
  --title "CI/CD Pipeline" \
  --color green \
  --field "Branch:main:inline" \
  --field "Duration:2m 34s:inline" \
  --field "Tests:142 passed" \
  --footer "Deployed by Cord" \
  --timestamp
```

---

### file

Send a file attachment.

```bash
cord file <channel> <filepath> ["message"]
```

**Examples:**
```bash
cord file 123456789 ./report.md "Here's the weekly report"
cord file 123456789 ./logs.txt
```

---

### buttons

Send interactive buttons with optional handlers.

```bash
cord buttons <channel> "prompt" --button label="..." id="..." [options]
```

**Button options:**
| Option | Description |
|--------|-------------|
| `label="..."` | Button text (required) |
| `id="..."` | Custom ID for tracking (required) |
| `style="..."` | primary, secondary, success, danger |
| `reply="..."` | Ephemeral reply when clicked |
| `webhook="..."` | URL to POST click data to |

**Examples:**

Simple confirmation:
```bash
cord buttons 123456789 "Deploy to production?" \
  --button label="Deploy" id="deploy-prod" style="success" \
  --button label="Cancel" id="cancel-deploy" style="secondary"
```

With inline responses:
```bash
cord buttons 123456789 "Approve this PR?" \
  --button label="Approve" id="approve" style="success" reply="Approved! Merging now." \
  --button label="Reject" id="reject" style="danger" reply="Rejected. Please revise."
```

With webhook callback:
```bash
cord buttons 123456789 "Start backup?" \
  --button label="Start Backup" id="backup-start" style="primary" webhook="http://localhost:8080/backup"
```

---

### typing

Show typing indicator (useful before slow operations).

```bash
cord typing <channel>
```

---

### edit

Edit an existing message.

```bash
cord edit <channel> <messageId> "new content"
```

---

### delete

Delete a message.

```bash
cord delete <channel> <messageId>
```

---

### rename

Rename a thread.

```bash
cord rename <threadId> "new name"
```

---

### reply

Reply to a specific message (shows reply preview).

```bash
cord reply <channel> <messageId> "message"
```

---

### thread

Create a thread from a message.

```bash
cord thread <channel> <messageId> "thread name"
```

---

### react

Add a reaction to a message.

```bash
cord react <channel> <messageId> "emoji"
```

**Example:**
```bash
cord react 123456789 987654321 "👍"
```

---

### state

Update a message with a status indicator. Use this to show work progress on a thread starter or status message.

```bash
cord state <channel> <messageId> <state>
```

**Preset states:**
| State | Display |
|-------|---------|
| `processing` | 🤖 Processing... |
| `thinking` | 🧠 Thinking... |
| `searching` | 🔍 Searching... |
| `writing` | ✍️ Writing... |
| `done` | ✅ Done |
| `error` | ❌ Something went wrong |
| `waiting` | ⏳ Waiting for input... |

**Examples:**

Using presets:
```bash
cord state 123456789 987654321 processing
cord state 123456789 987654321 done
```

Custom status:
```bash
cord state 123456789 987654321 "🔄 Syncing database..."
```

---

## Choosing the Right Command

| Use Case | Command |
|----------|---------|
| Simple notification | `cord send` |
| Formatted status update | `cord embed` |
| Long content (logs, reports) | `cord file` |
| User needs to make a choice | `cord buttons` |
| Indicate processing (typing bubble) | `cord typing` |
| Update thread/message status | `cord state` |
| Update previous message | `cord edit` |
| Start a focused discussion | `cord thread` |
| Quick acknowledgment | `cord react` |

---

## Assembly Patterns

### Notification with follow-up options

```bash
# Send the notification
cord embed 123456789 "Build failed on main branch" \
  --title "CI Alert" \
  --color red \
  --field "Error:Test suite timeout" \
  --field "Commit:abc1234:inline"

# Offer actions
cord buttons 123456789 "What would you like to do?" \
  --button label="View Logs" id="view-logs" style="primary" reply="Fetching logs..." \
  --button label="Retry Build" id="retry" style="success" webhook="http://ci/retry" \
  --button label="Ignore" id="ignore" style="secondary" reply="Acknowledged"
```

### Progress updates

```bash
# Start with typing indicator
cord typing 123456789

# Send initial status message
MSGID=$(cord send 123456789 "🤖 Processing..." | grep -o '[0-9]*$')

# Update state as work progresses
cord state 123456789 $MSGID searching
cord state 123456789 $MSGID writing
cord state 123456789 $MSGID done
```

Or with custom progress:
```bash
cord state 123456789 $MSGID "🔄 Step 1/3: Fetching data..."
cord state 123456789 $MSGID "🔄 Step 2/3: Processing..."
cord state 123456789 $MSGID "🔄 Step 3/3: Generating report..."
cord state 123456789 $MSGID done
```

### Report delivery

```bash
# Send summary embed
cord embed 123456789 "Weekly metrics compiled" \
  --title "Weekly Report Ready" \
  --color blue \
  --field "Period:Jan 15-21:inline" \
  --field "Pages:12:inline"

# Attach the full report
cord file 123456789 ./weekly-report.pdf "Full report attached"
```

### Confirmation flow

```bash
# Ask for confirmation
cord buttons 123456789 "Delete all archived items older than 30 days?" \
  --button label="Yes, Delete" id="confirm-delete" style="danger" reply="Deleting..." \
  --button label="Cancel" id="cancel-delete" style="secondary" reply="Cancelled"
```

---

## HTTP API

For advanced use cases (webhooks, external scripts), see [HTTP-API.md](./HTTP-API.md).
