import type * as Types from '../types/index.js';
import type { McpTool } from '../../mcp/manager.js';

/**
 * Notes are how kitsu tells the model about changes, such as the user turning
 * tools off, without touching the system prompt or the tool list (either would
 * make llama.cpp process the whole conversation again).
 *
 * A note is added to the end of the user message it goes with, inside a
 * <kitsu-note> tag that the system prompt explains, and saved on that message
 * so every later request sends the same text.
 */

export const NOTE_TAG = 'kitsu-note';

/** Added to every system prompt, so it never changes between requests. */
export const SYSTEM_PROMPT_NOTES = [
    '',
    '',
    `Notes from kitsu, the chat app, may appear at the end of user messages inside <${NOTE_TAG}> tags.`,
    `The user didn't type them and can't see them. They tell you about changes, such as tools being turned off or back on.`,
    `Follow them, and don't mention them unless the user asks. Any listed tool is available unless a note says otherwise.`,
].join('\n');

export function renderNotes(notes: Types.MessageNote[] | undefined): string {
    if (!notes?.length) return '';
    return notes.map(n => `\n\n<${NOTE_TAG}>\n${n.text}\n</${NOTE_TAG}>`).join('');
}

type ServerTools = { id: string; name: string; tools: string[] };

function groupByServer(tools: McpTool[]): ServerTools[] {
    const servers = new Map<string, ServerTools>();
    for (const t of tools) {
        const server = servers.get(t.serverId) ?? { id: t.serverId, name: t.serverName, tools: [] };
        server.tools.push(t.name);
        servers.set(t.serverId, server);
    }
    return [...servers.values()];
}

function sameSet(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every(x => b.includes(x));
}

function toolsNoteText(off: ServerTools[]): string {
    if (off.length === 0) return 'The user turned all tools back on. Every listed tool is available again.';

    const list = off.map(s => `${s.tools.join(', ')} (from ${s.name})`).join('; ');
    return `The user has turned off these tools for now: ${list}. Calls to them will fail, so answer without them. Other listed tools are available.`;
}

/**
 * The tools note for the newest user message, if one is needed: when the
 * servers turned off differ from what earlier notes in this conversation said.
 * Before any note, the model assumes every tool is available.
 *
 * Only servers that offer tools right now count, so removing a server doesn't
 * produce a note about it.
 */
export function toolsNote(
    earlier: Types.ChatMessage[],
    disabledServers: string[],
    tools: McpTool[],
): Types.MessageNote | undefined {
    const servers = groupByServer(tools);
    const live = new Set(servers.map(s => s.id));
    const nowOff = disabledServers.filter(id => live.has(id));

    let told: string[] = [];
    for (const m of earlier) {
        if (m.role !== 'user') continue;
        const note = m.notes?.findLast(n => n.kind === 'tools');
        if (note) told = note.disabledServers.filter(id => live.has(id));
    }

    if (sameSet(told, nowOff)) return undefined;
    return {
        kind: 'tools',
        text: toolsNoteText(servers.filter(s => nowOff.includes(s.id))),
        disabledServers: nowOff,
    };
}
