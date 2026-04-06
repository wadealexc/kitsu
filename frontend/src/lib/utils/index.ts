import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';
import localizedFormat from 'dayjs/plugin/localizedFormat';

dayjs.extend(relativeTime);
dayjs.extend(isToday);
dayjs.extend(isYesterday);
dayjs.extend(localizedFormat);

import { getAndUpdateUserLocation } from '$lib/apis/users';

export const sanitizeResponseContent = (content: string): string => {
    return content
        .replace(/<\|[a-z]*$/, '')
        .replace(/<\|[a-z]+\|$/, '')
        .replace(/<$/, '')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll(/<\|[a-z]+\|>/g, ' ')
        .trim();
};

export function unescapeHtml(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.documentElement.textContent;
}

export const formatDate = (inputDate: string | number | Date): string => {
    const date = dayjs(inputDate);
    const time = date.format('LT');

    if (date.isToday()) {
        return `Today at ${time}`;
    } else if (date.isYesterday()) {
        return `Yesterday at ${time}`;
    } else {
        return `${date.format('L')} at ${time}`;
    }
};

export const copyToClipboard = async (text: string): Promise<boolean> => {
    let result = false;
    if (!navigator.clipboard) {
        const textArea = document.createElement('textarea');
        textArea.value = text;

        // Avoid scrolling to bottom
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.position = 'fixed';

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            const successful = document.execCommand('copy');
            const msg = successful ? 'successful' : 'unsuccessful';
            console.log('Fallback: Copying text command was ' + msg);
            result = true;
        } catch (err) {
            console.error('Fallback: Oops, unable to copy', err);
        }

        document.body.removeChild(textArea);
        return result;
    }

    result = await navigator.clipboard
        .writeText(text)
        .then(() => {
            console.log('Async: Copying to clipboard was successful!');
            return true;
        })
        .catch((error) => {
            console.error('Async: Could not copy text: ', error);
            return false;
        });

    return result;
};

export const getImportOrigin = (_chats: any[]): string => {
    // Check what external service chat imports are from
    if ('mapping' in _chats[0]) {
        return 'openai';
    }
    return 'webui';
};

export const getUserPosition = async (
    raw = false
): Promise<string | { latitude: number; longitude: number }> => {
    // Get the user's location using the Geolocation API
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject);
    }).catch((error) => {
        console.error('Error getting user location:', error);
        throw error;
    });

    if (!position) {
        return 'Location not available';
    }

    // Extract the latitude and longitude from the position
    const { latitude, longitude } = position.coords;

    if (raw) {
        return { latitude, longitude };
    } else {
        return `${latitude.toFixed(3)}, ${longitude.toFixed(3)} (lat, long)`;
    }
};

const convertOpenAIMessages = (convo: any) => {
    // Parse OpenAI chat messages and create chat dictionary for creating new chats
    const mapping = convo['mapping'];
    const messages = [];
    let currentId = '';
    let lastId = null;

    for (const message_id in mapping) {
        const message = mapping[message_id];
        currentId = message_id;
        try {
            if (
                messages.length == 0 &&
                (message['message'] == null ||
                    (message['message']['content']['parts']?.[0] == '' &&
                        message['message']['content']['text'] == null))
            ) {
                // Skip chat messages with no content
                continue;
            } else {
                const new_chat = {
                    id: message_id,
                    parentId: lastId,
                    childrenIds: message['children'] || [],
                    role:
                        message['message']?.['author']?.['role'] !== 'user' ? 'assistant' : 'user',
                    content:
                        message['message']?.['content']?.['parts']?.[0] ||
                        message['message']?.['content']?.['text'] ||
                        '',
                    model: 'gpt-3.5-turbo',
                    done: true,
                    context: null
                };
                messages.push(new_chat);
                lastId = currentId;
            }
        } catch (error) {
            console.log('Error with', message, '\nError:', error);
        }
    }

    const history: Record<PropertyKey, (typeof messages)[number]> = {};
    messages.forEach((obj) => (history[obj.id] = obj));

    const chat = {
        history: {
            currentId: currentId,
            messages: history // Need to convert this to not a list and instead a json object
        },
        models: ['gpt-3.5-turbo'],
        messages: messages,
        options: {},
        timestamp: convo['create_time'],
        title: convo['title'] ?? 'New Chat'
    };
    return chat;
};

const validateChat = (chat: {
    messages: Array<{ childrenIds: any[]; parentId: any; content: any }>;
}): boolean => {
    // Because ChatGPT sometimes has features we can't use like DALL-E or might have corrupted messages, need to validate
    const messages = chat.messages;

    // Check if messages array is empty
    if (messages.length === 0) {
        return false;
    }

    // Last message's children should be an empty array
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.childrenIds.length !== 0) {
        return false;
    }

    // First message's parent should be null
    const firstMessage = messages[0];
    if (firstMessage.parentId !== null) {
        return false;
    }

    // Every message's content should be a string
    for (const message of messages) {
        if (typeof message.content !== 'string') {
            return false;
        }
    }

    return true;
};

export const convertOpenAIChats = (_chats: any[]): any[] => {
    // Create a list of dictionaries with each conversation from import
    const chats = [];
    let failed = 0;
    for (const convo of _chats) {
        const chat = convertOpenAIMessages(convo);

        if (validateChat(chat)) {
            chats.push({
                id: convo['id'],
                userId: '',
                title: convo['title'],
                chat: chat,
                timestamp: convo['create_time']
            });
        } else {
            failed++;
        }
    }
    console.log(failed, 'Conversations could not be imported');
    return chats;
};

export const applyPromptVariables = (
    prompt: string,
    variables: Record<string, unknown>
): string => {
    let result = prompt;
    for (const [key, value] of Object.entries(variables)) {
        if (value !== undefined && value !== null) {
            const str = typeof value === 'string' ? value : JSON.stringify(value);
            result = result.replaceAll(key, str);
        }
    }
    return result;
};

type LocationResult = string | { latitude: number, longitude: number };

export const getPromptVariables = async (
    username: string,
    getLocation: boolean,
): Promise<Record<string, LocationResult | undefined>> => {
    // Get user location if needed
    let userLocation: LocationResult | undefined = getLocation 
        ? await getAndUpdateUserLocation(localStorage.token) 
        : undefined;

    return {
        '{{USER_NAME}}': username,
        '{{USER_LOCATION}}': userLocation || 'Unknown',
        '{{CURRENT_DATETIME}}': getCurrentDateTime(),
        '{{CURRENT_DATE}}': getFormattedDate(),
        '{{CURRENT_TIME}}': getFormattedTime(),
        '{{CURRENT_WEEKDAY}}': getWeekday(),
        '{{CURRENT_TIMEZONE}}': getUserTimezone(),
        '{{USER_LANGUAGE}}': localStorage.getItem('locale') || 'en-US'
    };
};

export const getTimeRange = (timestamp: number): string => {
    const now = new Date();
    const date = new Date(timestamp * 1000); // Convert Unix timestamp to milliseconds

    // Calculate the difference in milliseconds
    const diffTime = now.getTime() - date.getTime();
    const diffDays = diffTime / (1000 * 3600 * 24);

    const nowDate = now.getDate();
    const nowMonth = now.getMonth();
    const nowYear = now.getFullYear();

    const dateDate = date.getDate();
    const dateMonth = date.getMonth();
    const dateYear = date.getFullYear();

    if (nowYear === dateYear && nowMonth === dateMonth && nowDate === dateDate) {
        return 'Today';
    } else if (nowYear === dateYear && nowMonth === dateMonth && nowDate - dateDate === 1) {
        return 'Yesterday';
    } else if (diffDays <= 7) {
        return 'Previous 7 days';
    } else if (diffDays <= 30) {
        return 'Previous 30 days';
    } else if (nowYear === dateYear) {
        return date.toLocaleString('default', { month: 'long' });
    } else {
        return date.getFullYear().toString();
    }
};

// Get the date in the format YYYY-MM-DD
const getFormattedDate = (): string => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// Get the time in the format HH:MM:SS
const getFormattedTime = (): string => {
    const date = new Date();
    return date.toTimeString().split(' ')[0];
};

// Get the current date and time in the format YYYY-MM-DD HH:MM:SS
const getCurrentDateTime = (): string => {
    return `${getFormattedDate()} ${getFormattedTime()}`;
};

// Get the user's timezone
export const getUserTimezone = (): string => {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

// Get the weekday
const getWeekday = (): string => {
    const date = new Date();
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return weekdays[date.getDay()];
};

export const formatFileSize = (size: number | null | undefined): string => {
    if (size == null) return 'Unknown size';
    if (typeof size !== 'number' || size < 0) return 'Invalid size';
    if (size === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
};

export const getLineCount = (text: string): number => {
    return text ? text.split('\n').length : 0;
};

export const convertHeicToJpeg = async (file: File): Promise<Blob | Blob[] | File> => {
    const { default: heic2any } = await import('heic2any');
    try {
        return await heic2any({ blob: file, toType: 'image/jpeg' });
    } catch (err: any) {
        if (err?.message?.includes('already browser readable')) {
            return file;
        }
        throw err;
    }
};

export const decodeString = (str: string): string => {
    try {
        return decodeURIComponent(str);
    } catch (e) {
        return str;
    }
};

export function decodeHtmlEntities(text: string): string {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
}

export function saveAs(data: Blob | string, filename: string): void {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Re-export message utils
export {
    appendMessage,
    createMessagesList,
    expandMessageBlocks,
    navigateToLeaf,
    getRootMessageIds,
    getSiblingIds
} from './messages';
