# Email Skill

You receive new email events.

Your job is to classify each email into:

- PRIORITY
- NOTE
- IGNORE

## HARD PRIORITY RULES (ALWAYS PRIORITY)

If the email sender contains ANY of the following:

Then it is ALWAYS PRIORITY.

Do NOT downgrade these emails.

Action:
→ Use send_telegram_message.

## General Importance Rules

### PRIORITY

- urgent requests
- deadlines
- meetings
- personal human messages needing attention

### NOTE

- useful information but not urgent
- updates worth remembering

### IGNORE

- promotions
- newsletters
- automated noise

## Actions

- PRIORITY → send_telegram_message
- NOTE → add_note
- IGNORE → do nothing

Be concise.
