import fs from 'fs/promises';
import path from 'path';

const NOTES_FILE = path.join(process.cwd(), 'data', 'notes.md');

// Ensure data directory exists
async function ensureDataDir() {
  const dir = path.dirname(NOTES_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

// Ensure notes file exists
async function ensureNotesFile() {
  await ensureDataDir();
  try {
    await fs.access(NOTES_FILE);
  } catch {
    await fs.writeFile(NOTES_FILE, '# My Notes\n\n', 'utf-8');
  }
}

export const notesTools = [
  {
    name: 'add_note',
    description: 'Add a new note or reminder. Use this when user wants to remember something, save information, or create a reminder.',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The note content to save'
        },
        category: {
          type: 'string',
          description: 'Optional category (e.g., "meeting", "todo", "idea")',
          enum: ['meeting', 'todo', 'idea', 'general']
        }
      },
      required: ['content']
    }
  },
  {
    name: 'search_notes',
    description: 'Search through all notes for specific keywords or topics',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query or keywords'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'list_notes',
    description: 'List all notes or recent notes',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of recent notes to show (default: 10)'
        }
      }
    }
  },
  {
    name: 'clear_all_notes',
    description: 'Delete all notes. USE WITH CAUTION - requires explicit user confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion'
        }
      },
      required: ['confirm']
    }
  }
];

export async function addNote(content: string, category: string = 'general'): Promise<string> {
  await ensureNotesFile();
  
  const timestamp = new Date().toISOString();
  const dateStr = new Date().toLocaleString();
  
  const noteEntry = `\n## [${category.toUpperCase()}] ${dateStr}\n${content}\n`;
  
  await fs.appendFile(NOTES_FILE, noteEntry, 'utf-8');
  
  return `✓ Note saved successfully!\nCategory: ${category}\nTime: ${dateStr}`;
}

export async function searchNotes(query: string): Promise<string> {
  await ensureNotesFile();
  
  const content = await fs.readFile(NOTES_FILE, 'utf-8');
  const lines = content.split('\n');
  
  const results: string[] = [];
  const queryLower = query.toLowerCase();
  
  let currentNote = '';
  let currentHeader = '';
  
  for (const line of lines) {
    if (line.startsWith('## ')) {
      // Save previous note if it matched
      if (currentNote && currentNote.toLowerCase().includes(queryLower)) {
        results.push(`${currentHeader}\n${currentNote}`);
      }
      currentHeader = line;
      currentNote = '';
    } else {
      currentNote += line + '\n';
    }
  }
  
  // Check last note
  if (currentNote && currentNote.toLowerCase().includes(queryLower)) {
    results.push(`${currentHeader}\n${currentNote}`);
  }
  
  if (results.length === 0) {
    return `No notes found matching "${query}"`;
  }
  
  return `Found ${results.length} note(s) matching "${query}":\n\n${results.join('\n---\n')}`;
}

export async function listNotes(limit: number = 10): Promise<string> {
  await ensureNotesFile();
  
  const content = await fs.readFile(NOTES_FILE, 'utf-8');
  
  if (content.trim() === '# My Notes' || content.trim().length === 0) {
    return 'No notes yet. Add your first note!';
  }
  
  const lines = content.split('\n');
  const notes: string[] = [];
  let currentNote = '';
  
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentNote) {
        notes.push(currentNote);
      }
      currentNote = line;
    } else if (currentNote) {
      currentNote += '\n' + line;
    }
  }
  
  if (currentNote) {
    notes.push(currentNote);
  }
  
  const recentNotes = notes.slice(-limit).reverse();
  
  if (recentNotes.length === 0) {
    return 'No notes found.';
  }
  
  return `Your ${recentNotes.length} most recent note(s):\n\n${recentNotes.join('\n---\n')}`;
}

export async function clearAllNotes(confirm: boolean): Promise<string> {
  if (!confirm) {
    return '❌ Deletion cancelled. Set confirm=true to delete all notes.';
  }
  
  await ensureDataDir();
  await fs.writeFile(NOTES_FILE, '# My Notes\n\n', 'utf-8');
  
  return '✅ All notes have been deleted.';
}

// Tool executor
export async function executeNotesTool(toolName: string, params: any): Promise<string> {
  switch (toolName) {
    case 'add_note':
      return await addNote(params.content, params.category);
    
    case 'search_notes':
      return await searchNotes(params.query);
    
    case 'list_notes':
      return await listNotes(params.limit);
    
    case 'clear_all_notes':
      return await clearAllNotes(params.confirm);
    
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}