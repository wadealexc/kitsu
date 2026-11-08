<script lang="ts" context="module">
    import Bolt from '../icons/Bolt.svelte';
    import Database from '../icons/Database.svelte';
    import Document from '../icons/Document.svelte';
    import Folder from '../icons/Folder.svelte';
    import GlobeAlt from '../icons/GlobeAlt.svelte';
    import Link from '../icons/Link.svelte';
    import Search from '../icons/Search.svelte';
    import Terminal from '../icons/Terminal.svelte';
    import Wrench from '../icons/Wrench.svelte';

    const ICONS = {
        wrench: Wrench,
        globe: GlobeAlt,
        search: Search,
        terminal: Terminal,
        database: Database,
        document: Document,
        folder: Folder,
        link: Link,
        bolt: Bolt
    } as const;

    /** The icons an admin can pick for a tool server. The backend accepts the same names. */
    export const TOOL_SERVER_ICONS = Object.keys(ICONS);
</script>

<script lang="ts">
    export let icon: string;
</script>

<svelte:component this={ICONS[icon as keyof typeof ICONS] ?? Wrench} className="size-4.5" strokeWidth="1.5" />
