/**
 * Markdown-to-text converter for CLI output.
 *
 * Strips or converts markdown formatting into clean, terminal-friendly
 * plain text. Does not depend on any external libraries.
 */

/**
 * Convert a markdown string to plain text suitable for terminal display.
 */
export function mdToText(md: string): string {
    let text = md;

    // Remove code block fences (```lang ... ```) but keep the content
    text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, "$1");

    // Inline code: `code` → code
    text = text.replace(/`([^`]+)`/g, "$1");

    // Images: ![alt](url) → alt
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

    // Links: [text](url) → text (url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

    // Headers: ### Heading → ── Heading ──
    text = text.replace(/^#{1,6}\s+(.+)$/gm, (_match, heading: string) => {
        return `── ${heading.trim()} ──`;
    });

    // Bold + italic: ***text*** or ___text___
    text = text.replace(/\*{3}(.+?)\*{3}/g, "$1");
    text = text.replace(/_{3}(.+?)_{3}/g, "$1");

    // Bold: **text** or __text__
    text = text.replace(/\*{2}(.+?)\*{2}/g, "$1");
    text = text.replace(/_{2}(.+?)_{2}/g, "$1");

    // Italic: *text* or _text_
    text = text.replace(/\*(.+?)\*/g, "$1");
    text = text.replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1");

    // Strikethrough: ~~text~~
    text = text.replace(/~~(.+?)~~/g, "$1");

    // Blockquotes: > text → │ text
    text = text.replace(/^>\s?(.*)$/gm, "│ $1");

    // Horizontal rules: --- or *** or ___
    text = text.replace(/^[-*_]{3,}\s*$/gm, "─".repeat(40));

    // Unordered lists: - item or * item → • item
    text = text.replace(/^(\s*)[-*]\s+/gm, "$1• ");

    // Ordered lists: 1. item → 1. item (keep as-is, already readable)

    // HTML tags (basic): <br>, <b>, </b>, etc.
    text = text.replace(/<br\s*\/?>/gi, "\n");
    text = text.replace(/<\/?[^>]+>/g, "");

    // Collapse 3+ consecutive blank lines into 2
    text = text.replace(/\n{3,}/g, "\n\n");

    return text.trim();
}
