/**
 * Bringing a chat back to where you were after iOS discards the home-screen app.
 *
 * iOS throws a backgrounded web app away quickly (seconds to minutes); coming back
 * reloads it from scratch, which lands at the bottom of the chat. So when the app
 * is hidden, we note which message is at the top of the screen and how far into
 * it; if the app then starts on the same chat soon after, we scroll back there.
 * A message, not a pixel offset, because the chat's height shifts while it renders.
 */

const KEY = 'kitsu-resume-position';
/** Only a recent departure counts as "coming back": otherwise open at the bottom as usual. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

type Position = { path: string; messageId: string | null; offset: number; scrollTop: number; at: number };

/** Notes where the chat is scrolled. Call when the app is hidden. */
export function saveResumePosition(container: HTMLElement): void {
    const top = container.getBoundingClientRect().top;
    const first = [...container.querySelectorAll<HTMLElement>('[id^="message-"]')].find(
        (el) => el.getBoundingClientRect().bottom > top
    );
    const position: Position = {
        path: location.pathname,
        messageId: first ? first.id.slice('message-'.length) : null,
        offset: first ? first.getBoundingClientRect().top - top : 0,
        scrollTop: container.scrollTop,
        at: Date.now()
    };
    try {
        localStorage.setItem(KEY, JSON.stringify(position));
    } catch {
        /* storage full or blocked: just open at the bottom next time */
    }
}

/** The saved position for this page, if the app was hidden here recently. Used once. */
export function takeResumePosition(path: string = location.pathname): Position | null {
    try {
        const raw = localStorage.getItem(KEY);
        localStorage.removeItem(KEY);
        if (!raw) return null;
        const position = JSON.parse(raw) as Position;
        if (position.path !== path || Date.now() - position.at > MAX_AGE_MS) return null;
        return position;
    } catch {
        return null;
    }
}

/** Scrolls so the saved message sits where it was. */
export function applyResumePosition(container: HTMLElement, position: Position): void {
    const el = position.messageId ? document.getElementById(`message-${position.messageId}`) : null;
    if (!el) {
        container.scrollTop = position.scrollTop;
        return;
    }
    const top = container.getBoundingClientRect().top;
    container.scrollTop += el.getBoundingClientRect().top - top - position.offset;
}
