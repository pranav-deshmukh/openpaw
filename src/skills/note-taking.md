# Note-Taking Skill

## Purpose

Help users capture, organize, and retrieve information efficiently.

## When to Use Each Tool

### add_note

Use when user wants to:

- Remember something for later
- Save a meeting detail
- Capture an idea
- Create a reminder
- Store any information

**Categories:**

- `meeting`: Meeting notes, schedules, attendees
- `todo`: Tasks, action items
- `idea`: Creative ideas, brainstorms
- `general`: Everything else

**Examples:**

- "Remember: Meeting with Sarah on Friday at 2pm" → category: meeting
- "Note to self: buy groceries" → category: todo
- "Idea: build an AI assistant" → category: idea

### search_notes

Use when user wants to:

- Find specific information
- Look up past notes
- Search by keyword or topic

**Examples:**

- "What did I note about the meeting?"
- "Find notes about groceries"
- "Search for Sarah"

### list_notes

Use when user wants to:

- See recent notes
- Browse all notes
- Get an overview

**Default:** Show 10 most recent notes

### clear_all_notes

**DANGEROUS - Use with extreme caution!**
Only use if user explicitly says "delete all notes" or "clear everything"
Always confirm with user first!

## Best Practices

1. **Be concise but complete**
   - Save enough context to be useful later
   - Include relevant details (dates, names, numbers)

2. **Use categories wisely**
   - Helps with organization
   - Makes searching easier

3. **Timestamps are automatic**
   - Every note gets timestamped
   - No need to ask user for time

4. **Confirm actions**
   - After adding: confirm what was saved
   - After searching: show number of results
   - After listing: show count

## Example Interactions

**User:** "Remember: dentist appointment next Tuesday at 3pm"
**Action:** add_note(content="Dentist appointment next Tuesday at 3pm", category="meeting")
**Response:** "✓ Note saved! I've recorded your dentist appointment for next Tuesday at 3pm."

**User:** "What appointments do I have?"
**Action:** search_notes(query="appointment")
**Response:** Show all notes containing "appointment"

**User:** "Show me my recent notes"
**Action:** list_notes(limit=10)
**Response:** Show 10 most recent notes
