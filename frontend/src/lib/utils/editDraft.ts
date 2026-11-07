/**
 * Keeping a message edit open across iOS discarding the app (see resumePosition.ts).
 * While a message is being edited, hiding the app saves which message and the
 * edited text; when the chat loads again soon after, that message reopens its
 * editor with the text.
 */

const KEY = 'kitsu-edit-draft';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

type EditDraft = { path: string; messageId: string; content: string; at: number };

export function saveEditDraft(messageId: string, content: string): void {
    try {
        localStorage.setItem(KEY, JSON.stringify({ path: location.pathname, messageId, content, at: Date.now() } satisfies EditDraft));
    } catch {
        /* storage full or blocked */
    }
}

/** Forget the saved edit (it was saved, cancelled, or belongs to this message). */
export function clearEditDraft(messageId?: string): void {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return;
        if (!messageId || (JSON.parse(raw) as EditDraft).messageId === messageId) localStorage.removeItem(KEY);
    } catch {
        localStorage.removeItem(KEY);
    }
}

/** The edited text for this message if its editor was open when the app was hidden. Used once. */
export function takeEditDraft(messageId: string): string | null {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const draft = JSON.parse(raw) as EditDraft;
        if (draft.messageId !== messageId) return null;
        localStorage.removeItem(KEY);
        if (draft.path !== location.pathname || Date.now() - draft.at > MAX_AGE_MS) return null;
        return draft.content;
    } catch {
        return null;
    }
}
