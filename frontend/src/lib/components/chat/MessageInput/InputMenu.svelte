<script lang="ts">
    import { DropdownMenu } from 'bits-ui';
    import { fly } from 'svelte/transition';
    import { flyAndScale } from '$lib/utils/transitions';

    import Dropdown from '$lib/components/common/Dropdown.svelte';
    import Tooltip from '$lib/components/common/Tooltip.svelte';
    import Camera from '$lib/components/icons/Camera.svelte';
    import DocumentPage from '$lib/components/icons/DocumentPage.svelte';

    export let screenCaptureHandler: () => Promise<void>;
    export let uploadFilesHandler: () => void;
    export let inputFilesHandler: (files: File[]) => Promise<void>;

    export let onClose: () => void;

    let show = false;

    const detectMobile = (): boolean => {
        const userAgent = navigator.userAgent || navigator.vendor;
        return /android|iphone|ipad|ipod|windows phone/i.test(userAgent);
    };

    const handleFileChange = (event: Event): void => {
        const inputFiles = Array.from((event.target as HTMLInputElement)?.files ?? []);
        if (inputFiles && inputFiles.length > 0) {
            console.log(inputFiles);
            inputFilesHandler(inputFiles);
        }
    };
</script>

<!-- Hidden file input used to open the camera on mobile -->
<input
    id="camera-input"
    type="file"
    accept="image/*"
    capture="environment"
    on:change={handleFileChange}
    style="display: none;"
/>

<Dropdown
    bind:show
    on:change={(e) => {
        if (e.detail === false) {
            onClose();
        }
    }}
>
    <Tooltip content="More">
        <slot />
    </Tooltip>

    <div slot="content">
        <DropdownMenu.Content
            class="w-full max-w-70 rounded-2xl px-1 py-1  border border-gray-100  dark:border-gray-800 z-50 bg-white dark:bg-gray-850 dark:text-white shadow-lg max-h-72 overflow-y-auto overflow-x-hidden scrollbar-thin transition"
            sideOffset={4}
            alignOffset={-6}
            side="bottom"
            align="start"
            transition={flyAndScale}
        >
            <div in:fly={{ x: -20, duration: 150 }}>
                <Tooltip content="" className="w-full">
                    <DropdownMenu.Item
                        class="flex gap-2 items-center px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl"
                        on:click={() => {
                            uploadFilesHandler();
                        }}
                    >
                        <DocumentPage />

                        <div class="line-clamp-1">{'Upload Files'}</div>
                    </DropdownMenu.Item>
                </Tooltip>

                <Tooltip content="" className="w-full">
                    <DropdownMenu.Item
                        class="flex gap-2 items-center px-3 py-1.5 text-sm  cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50  rounded-xl"
                        on:click={() => {
                            if (!detectMobile()) {
                                screenCaptureHandler();
                            } else {
                                const cameraInputElement = document.getElementById('camera-input');

                                if (cameraInputElement) {
                                    cameraInputElement.click();
                                }
                            }
                        }}
                    >
                        <Camera />
                        <div class=" line-clamp-1">{'Capture'}</div>
                    </DropdownMenu.Item>
                </Tooltip>
            </div>
        </DropdownMenu.Content>
    </div>
</Dropdown>
