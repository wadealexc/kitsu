import { DEFAULT_APP_NAME } from '$lib/constants';
import { type Writable, writable } from 'svelte/store';
import type {
    ModelResponse,
    SessionUserResponse,
    FolderNameIdResponse,
    Folder
} from '@backend/routes/types';
import type { ChatListItem } from '$lib/apis/chats';
import type { ToolServer } from '$lib/apis/mcp';
export type SessionUser = SessionUserResponse;
export type Model = ModelResponse;

// Backend
export const APP_NAME = writable(DEFAULT_APP_NAME);

export const user: Writable<SessionUser | undefined> = writable(undefined);

// Frontend

export const mobile = writable(false);

/** An on-screen keyboard is covering part of the screen (set by the app layout) */
export const virtualKeyboardOpen = writable(false);

export const chatId = writable('');
export const chatTitle = writable('');

export const chats: Writable<ChatListItem[] | null> = writable(null);
export const folders: Writable<FolderNameIdResponse[]> = writable([]);

export const selectedFolder: Writable<Folder | null> = writable(null);

export const models: Writable<Model[]> = writable([]);

/** MCP servers whose tools chats can use */
export const toolServers: Writable<ToolServer[]> = writable([]);

export const selectedModel: Writable<Model | null> = writable(null);

export type Config = {
    name: string;
    enableSignup: boolean;
    defaultUserRole: string;
    jwtExpiresIn: string;
};

const DEFAULT_CONFIG: Config = {
    name: 'kitsu',
    enableSignup: true,
    defaultUserRole: 'user',
    jwtExpiresIn: '7d',
};

export type Settings = {
    pinnedModels: string[];
    textScale: number;
    userLocation: boolean;
    userLocationString: string | undefined;
    /** @deprecated replaced by disabledToolServers */
    webSearch?: boolean;
    /** MCP servers turned off in new chats */
    disabledToolServers: string[];
    scrollOnBranchChange: boolean;
    model: string;
    ctrlEnterToSend: boolean;
    temporaryChatByDefault: boolean;
    regenerateMenu: boolean;
};

const DEFAULT_SETTINGS: Settings = {
    pinnedModels: [],
    textScale: 1,
    userLocation: false,
    userLocationString: undefined,
    disabledToolServers: [],
    scrollOnBranchChange: true,
    model: '',
    ctrlEnterToSend: false,
    temporaryChatByDefault: false,
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

// Scroll position saved by the edit button BEFORE entering edit mode.
// Read by Chat.svelte to restore position when editing ends.
export const editScrollPosition = writable<number | undefined>(undefined);

// Live stream context info (context usage + TPS), updated during active generation
export type StreamContext = {
    used: number;
    total: number;
    tps: number;
    promptProcessing?: { processed: number; total: number };
} | null;

export const streamContext: Writable<StreamContext> = writable(null);
