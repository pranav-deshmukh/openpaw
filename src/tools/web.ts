import { BaseTool, ToolParametersSchema } from "./base-tool";

/**
 * WebSearchTool — search the web via the Brave Search API.
 * Requires `BRAVE_SEARCH_API_KEY` in environment.
 * @see https://api.search.brave.com/res/v1/web/search
 */

const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY || "";
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

interface BraveWebResult {
    title: string;
    url: string;
    description: string;
}

interface BraveSearchResponse {
    web?: {
        results: BraveWebResult[];
    };
}

export class WebSearchTool extends BaseTool {
    readonly name = "web_search";

    readonly description =
        "Search the web using Brave Search. Returns titles, URLs, and snippets for the top results. Use this when the user asks to look something up, find information, or search online.";

    readonly parameters: ToolParametersSchema = {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "The search query",
            },
            count: {
                type: "number",
                description:
                    "Number of results to return (1-20, default 5)",
            },
        },
        required: ["query"],
    };

    async execute(args: Record<string, unknown>): Promise<string> {
        const query = args.query as string;
        const count = Math.min(Math.max(Number(args.count) || 5, 1), 20);

        if (!BRAVE_API_KEY) {
            return "❌ BRAVE_SEARCH_API_KEY is not set. Add it to your .env file.";
        }

        const url = new URL(BRAVE_SEARCH_URL);
        url.searchParams.set("q", query);
        url.searchParams.set("count", String(count));

        const response = await fetch(url.toString(), {
            headers: {
                Accept: "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": BRAVE_API_KEY,
            },
        });

        if (!response.ok) {
            return `❌ Brave Search error: ${response.status} ${response.statusText}`;
        }

        const data = (await response.json()) as BraveSearchResponse;
        const results = data.web?.results ?? [];

        if (results.length === 0) {
            return `No results found for "${query}".`;
        }

        const formatted = results
            .map(
                (r, i) =>
                    `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description || "No description"}`,
            )
            .join("\n\n");

        return `🔍 Search results for "${query}":\n\n${formatted}`;
    }
}

/**
 * DuckDuckGoSearchTool — search the web via DuckDuckGo HTML.
 * No API key required. Parses results from the HTML response.
 * @see https://html.duckduckgo.com/html/
 */

interface DuckDuckGoResult {
    title: string;
    url: string;
    snippet: string;
}

export class DuckDuckGoSearchTool extends BaseTool {
    readonly name = "ddg_search";

    readonly description =
        "Search the web using DuckDuckGo. No API key required. Returns titles, URLs, and snippets. Use this as a fallback or alternative to web_search.";

    readonly parameters: ToolParametersSchema = {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "The search query",
            },
            count: {
                type: "number",
                description: "Number of results to return (1-10, default 5)",
            },
        },
        required: ["query"],
    };

    async execute(args: Record<string, unknown>): Promise<string> {
        const query = args.query as string;
        const count = Math.min(Math.max(Number(args.count) || 5, 1), 10);

        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    Accept: "text/html",
                },
                signal: AbortSignal.timeout(10_000),
            });

            if (!response.ok) {
                return `❌ DuckDuckGo error: ${response.status} ${response.statusText}`;
            }

            const html = await response.text();
            const results = this.parseResults(html, count);

            if (results.length === 0) {
                return `No results found for "${query}".`;
            }

            const formatted = results
                .map(
                    (r, i) =>
                        `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet || "No description"}`,
                )
                .join("\n\n");

            return `🦆 DuckDuckGo results for "${query}":\n\n${formatted}`;
        } catch (err: any) {
            return `❌ DuckDuckGo search failed: ${err.message}`;
        }
    }

    /** Parse result entries from DuckDuckGo HTML response. */
    private parseResults(html: string, max: number): DuckDuckGoResult[] {
        const results: DuckDuckGoResult[] = [];

        // DuckDuckGo HTML wraps each result in a <div class="result ...">
        // Title is in <a class="result__a"> and snippet in <a class="result__snippet">
        const resultBlocks = html.split(/class="result\s/g).slice(1);

        for (const block of resultBlocks) {
            if (results.length >= max) break;

            // Extract title
            const titleMatch = block.match(
                /class="result__a"[^>]*>([^<]+)<\/a>/,
            );
            // Extract URL from href (DuckDuckGo redirects through uddg param)
            const hrefMatch = block.match(
                /class="result__a"\s+href="([^"]+)"/,
            );
            // Extract snippet
            const snippetMatch = block.match(
                /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/,
            );

            if (titleMatch && hrefMatch) {
                let resultUrl = hrefMatch[1];

                // DuckDuckGo wraps URLs in a redirect — extract the actual URL
                const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
                if (uddgMatch) {
                    resultUrl = decodeURIComponent(uddgMatch[1]);
                }

                const snippet = snippetMatch
                    ? snippetMatch[1].replace(/<[^>]+>/g, "").trim()
                    : "";

                results.push({
                    title: titleMatch[1].trim(),
                    url: resultUrl,
                    snippet,
                });
            }
        }

        return results;
    }
}

/**
 * WebFetchTool — fetch a URL and extract clean text content.
 * Strips HTML tags, scripts, styles, and collapses whitespace.
 */

export class WebFetchTool extends BaseTool {
    readonly name = "web_fetch";

    readonly description =
        "Fetch a web page by URL and return its text content (HTML stripped). Use this when the user asks to read, summarize, or get the contents of a specific web page.";

    readonly parameters: ToolParametersSchema = {
        type: "object",
        properties: {
            url: {
                type: "string",
                description: "The URL to fetch",
            },
            max_length: {
                type: "number",
                description:
                    "Maximum characters to return (default 5000). Reduce for faster, smaller responses.",
            },
        },
        required: ["url"],
    };

    async execute(args: Record<string, unknown>): Promise<string> {
        const url = args.url as string;
        const maxLength = Number(args.max_length) || 5000;

        try {
            const response = await fetch(url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (compatible; OpenPawBot/1.0; +https://github.com/openpaw)",
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
                signal: AbortSignal.timeout(15_000),
            });

            if (!response.ok) {
                return `❌ Fetch error: ${response.status} ${response.statusText}`;
            }

            const html = await response.text();
            const text = this.extractText(html);
            const trimmed =
                text.length > maxLength
                    ? text.slice(0, maxLength) + "\n\n… (truncated)"
                    : text;

            return `📄 Content from ${url}:\n\n${trimmed}`;
        } catch (err: any) {
            return `❌ Failed to fetch ${url}: ${err.message}`;
        }
    }

    /** Strip HTML tags, scripts, styles, and collapse whitespace. */
    private extractText(html: string): string {
        return html
            // Remove script and style blocks entirely
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            // Remove HTML comments
            .replace(/<!--[\s\S]*?-->/g, "")
            // Replace block-level tags with newlines
            .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, "\n")
            .replace(/<br\s*\/?>/gi, "\n")
            // Strip remaining tags
            .replace(/<[^>]+>/g, "")
            // Decode common HTML entities
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ")
            // Collapse whitespace
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }
}
