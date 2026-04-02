<script lang="ts">
    import { saveAs } from '$lib/utils';

    import { toast } from 'svelte-sonner';

    import { selectedFolder } from '$lib/stores';
    import type { FolderData, FolderMeta, Folder as FolderRecord } from '@backend/routes/types';

    import { deleteFolderById, getFolderById, updateFolderById } from '$lib/apis/folders';
    import { getChatsByFolderId } from '$lib/apis/chats';

    import FolderModal from '$lib/components/sidebar/Folders/FolderModal.svelte';

    import Folder from '$lib/components/icons/Folder.svelte';
    import FolderMenu from '$lib/components/sidebar/Folders/FolderMenu.svelte';
    import EllipsisHorizontal from '$lib/components/icons/EllipsisHorizontal.svelte';
    import DeleteConfirmDialog from '$lib/components/common/ConfirmDialog.svelte';

    export let folder: FolderRecord;

    export let onUpdate: Function = () => {};
    export let onDelete: Function = () => {};

    let showFolderModal = false;
    let showDeleteConfirm = false;
    let deleteFolderContents = true;

    type Update = {
        name: string;
        meta: FolderMeta;
        data: FolderData;
    };

    const updateHandler = async ({ name, meta, data }: Update) => {
        if (name === '') {
            toast.error('Folder name cannot be empty.');
            return;
        }

        const currentName = folder.name;

        name = name.trim();
        folder.name = name;

        const res = await updateFolderById(localStorage.token, folder.id, {
            name,
            ...(meta ? { meta } : {}),
            ...(data ? { data } : {})
        }).catch((error) => {
            toast.error(`${error}`);

            folder.name = currentName;
            return null;
        });

        if (res) {
            folder.name = name;
            if (data) {
                folder.data = data;
            }

            toast.success('Folder updated successfully');

            const _folder = await getFolderById(localStorage.token, folder.id).catch((error) => {
                toast.error(`${error}`);
                return null;
            });

            await selectedFolder.set(_folder);
            onUpdate();
        }
    };

    const deleteHandler = async () => {
        const res = await deleteFolderById(
            localStorage.token,
            folder.id,
            deleteFolderContents
        ).catch((error) => {
            toast.error(`${error}`);
            return null;
        });

        if (res) {
            toast.success('Folder deleted successfully');
            onDelete();
        }
    };

    const exportHandler = async () => {
        const chats = await getChatsByFolderId(localStorage.token, folder.id).catch((error) => {
            toast.error(`${error}`);
            return null;
        });
        if (!chats) {
            return;
        }

        const blob = new Blob([JSON.stringify(chats)], {
            type: 'application/json'
        });

        saveAs(blob, `folder-${folder.name}-export-${Date.now()}.json`);
    };
</script>

<FolderModal
    bind:show={showFolderModal}
    edit={true}
    folderId={folder.id}
    onSubmit={updateHandler}
/>

<DeleteConfirmDialog
    bind:show={showDeleteConfirm}
    title="Delete folder?"
    on:confirm={() => {
        deleteHandler();
    }}
>
    <div class=" text-sm text-gray-700 dark:text-gray-300 flex-1 line-clamp-3 mb-2">
        {`Are you sure you want to delete "${folder.name}"?`}
    </div>

    <div class="flex items-center gap-1.5">
        <input type="checkbox" bind:checked={deleteFolderContents} />

        <div class="text-xs text-gray-500">
            {'Delete all contents inside this folder'}
        </div>
    </div>
</DeleteConfirmDialog>

<div class="mb-3 px-6 @md:max-w-3xl justify-between w-full flex relative group items-center">
    <div class="text-center flex gap-3.5 items-center">
        <Folder className="size-5.5" strokeWidth="2" />

        <div class="text-3xl line-clamp-1">
            {folder.name}
        </div>
    </div>

    <div class="flex items-center translate-x-2.5">
        <FolderMenu
            align="end"
            onEdit={() => {
                showFolderModal = true;
            }}
            onDelete={() => {
                showDeleteConfirm = true;
            }}
            onExport={() => {
                exportHandler();
            }}
        >
            <button
                class="p-1.5 dark:hover:bg-gray-850 rounded-full touch-auto"
                on:click={(e) => {}}
            >
                <EllipsisHorizontal className="size-4" strokeWidth="2.5" />
            </button>
        </FolderMenu>
    </div>
</div>
