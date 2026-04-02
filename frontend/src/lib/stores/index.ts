import { DEFAULT_APP_NAME } from '$lib/constants';
import { type Writable, writable } from 'svelte/store';
import type {
    ModelResponse,
    SessionUserResponse,
    FolderNameIdResponse,
    FolderModel
} from '@backend/routes/types';
import type { ChatListItem } from '$lib/apis/chats';
export type SessionUser = SessionUserResponse;
export type Model = ModelResponse;

// Backend
export const APP_NAME = writable(DEFAULT_APP_NAME);

export const user: Writable<SessionUser | undefined> = writable(undefined);

// Frontend

export const mobile = writable(false);

export const chatId = writable('');
export const chatTitle = writable('');

export const chats: Writable<ChatListItem[] | null> = writable(null);
export const folders: Writable<FolderNameIdResponse[]> = writable([]);

export const selectedFolder: Writable<FolderModel | null> = writable(null);

export const models: Writable<Model[]> = writable([]);

export const selectedModel: Writable<Model | null> = writable(null);

export type Config = {
    name: string;
    features: {
        auth: boolean;
        enableSignup: boolean;
    };
};

const DEFAULT_CONFIG: Config = {
    name: 'kitsu',
    features: {
        auth: true,
        enableSignup: true
    }
};

export type Settings = {
    pinnedModels: string[];
    textScale: number;
    userLocation: boolean;
    webSearch: boolean;
    scrollOnBranchChange: boolean;
    model: string;
    ctrlEnterToSend: boolean;
    temporaryChatByDefault: boolean;
    chatFadeStreamingText: boolean;
    regenerateMenu: boolean;
};

const DEFAULT_SETTINGS: Settings = {
    pinnedModels: [],
    textScale: 1,
    userLocation: false,
    webSearch: false,
    scrollOnBranchChange: true,
    model: '',
    ctrlEnterToSend: false,
    temporaryChatByDefault: false,
    chatFadeStreamingText: true,
    regenerateMenu: true
};

export function applySettingsDefaults(saved: Record<string, unknown> = {}): Settings {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(saved)) {
        if (value != null) cleaned[key] = value;
    }
    return { ...DEFAULT_SETTINGS, ...cleaned } as Settings;
}

export const settings: Writable<Settings> = writable({ ...DEFAULT_SETTINGS });
export const config: Writable<Config> = writable(DEFAULT_CONFIG);
export const configLoaded = writable(false);

export const sidebarWidth = writable(260);

export const showSidebar = writable(false);
export const showSearch = writable(false);
export const showSettings = writable(false);

export const temporaryChatEnabled = writable<boolean | null>(false);
export const scrollPaginationEnabled = writable(false);
export const currentChatPage = writable(1);

export const isLastActiveTab = writable(true);

// True when a message in the history is being edited (MessageEditor is active).
// Used to hide MessageInput on mobile so the editor has more viewport space.
export const isEditingMessage = writable(false);

// Live stream context info (context usage + TPS), updated during active generation
export type StreamContext = {
    used: number;
    total: number;
    tps: number;
    promptProcessing?: { processed: number; total: number };
} | null;

export const streamContext: Writable<StreamContext> = writable(null);
