<script lang="ts">
    import Switch from '$lib/components/common/Switch.svelte';
    import Tooltip from '$lib/components/common/Tooltip.svelte';
    import Plus from '$lib/components/icons/Plus.svelte';
    import type { ModelParams } from '@backend/routes/types';

    export let onChange: (params: any) => void = () => {};

    const defaultParams: ModelParams = {};

    export let params = defaultParams;
    $: if (params) {
        onChange(params);
    }
</script>

<div class=" space-y-1 text-xs pb-safe-bottom">
    <div>
        <Tooltip
            content="When enabled, the model will respond to each chat message in real-time, generating a response as soon as the user sends a message. This mode is useful for live chat applications, but may impact performance on slower hardware."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class=" py-0.5 flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'Stream Chat Response'}
                </div>
                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition"
                    on:click={() => {
                        params.stream_response =
                            (params.stream_response ?? undefined) === undefined
                                ? true
                                : params.stream_response
                                  ? false
                                  : undefined;
                    }}
                    type="button"
                >
                    {#if params.stream_response === true}
                        <span class="ml-2 self-center">{'On'}</span>
                    {:else if params.stream_response === false}
                        <span class="ml-2 self-center">{'Off'}</span>
                    {:else}
                        <span class="ml-2 self-center">{'Default'}</span>
                    {/if}
                </button>
            </div>
        </Tooltip>
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Sets the random number seed to use for generation. Setting this to a specific number will make the model generate the same text for the same prompt."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'Seed'}
                </div>

                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.seed = (params.seed ?? undefined) === undefined ? 0 : undefined;
                    }}
                >
                    {#if (params.seed ?? undefined) === undefined}
                        <span class="ml-2 self-center"> {'Default'} </span>
                    {:else}
                        <span class="ml-2 self-center"> {'Custom'} </span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.seed ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        class="text-sm w-full bg-transparent outline-hidden outline-none"
                        type="number"
                        placeholder="Enter Seed"
                        bind:value={params.seed}
                        autocomplete="off"
                        min="0"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Sets the stop sequences to use. When this pattern is encountered, the LLM will stop generating text and return. Multiple stop patterns may be set by specifying multiple separate stop parameters in a modelfile."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'Stop Sequence'}
                </div>

                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.stop = (params.stop ?? undefined) === undefined ? '' : undefined;
                    }}
                >
                    {#if (params.stop ?? undefined) === undefined}
                        <span class="ml-2 self-center"> {'Default'} </span>
                    {:else}
                        <span class="ml-2 self-center"> {'Custom'} </span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.stop ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        class="text-sm w-full bg-transparent outline-hidden outline-none"
                        type="text"
                        placeholder="Enter stop sequence"
                        bind:value={params.stop}
                        autocomplete="off"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="The temperature of the model. Increasing the temperature will make the model answer more creatively."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'Temperature'}
                </div>
                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.temperature =
                            (params.temperature ?? undefined) === undefined ? 0.8 : undefined;
                    }}
                >
                    {#if (params.temperature ?? undefined) === undefined}
                        <span class="ml-2 self-center"> {'Default'} </span>
                    {:else}
                        <span class="ml-2 self-center"> {'Custom'} </span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.temperature ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        id="steps-range"
                        type="range"
                        min="0"
                        max="2"
                        step="0.05"
                        bind:value={params.temperature}
                        class="w-full h-2 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                </div>
                <div>
                    <input
                        bind:value={params.temperature}
                        type="number"
                        class=" bg-transparent text-center w-14"
                        min="0"
                        max="2"
                        step="any"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Constrains effort on reasoning for reasoning models. Only applicable to reasoning models from specific providers that support reasoning effort."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'Reasoning Effort'}
                </div>
                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.reasoning_effort =
                            (params.reasoning_effort ?? undefined) === undefined
                                ? 'medium'
                                : undefined;
                    }}
                >
                    {#if (params.reasoning_effort ?? undefined) === undefined}
                        <span class="ml-2 self-center"> {'Default'} </span>
                    {:else}
                        <span class="ml-2 self-center"> {'Custom'} </span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.reasoning_effort ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        class="text-sm w-full bg-transparent outline-hidden outline-none"
                        type="text"
                        placeholder="Enter reasoning effort"
                        bind:value={params.reasoning_effort}
                        autocomplete="off"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Boosting or penalizing specific tokens for constrained responses. Bias values will be clamped between -100 and 100 (inclusive). (Default: none)"
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'logit_bias'}
                </div>
                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.logit_bias =
                            (params.logit_bias ?? undefined) === undefined ? {} : undefined;
                    }}
                >
                    {#if (params.logit_bias ?? undefined) === undefined}
                        <span class="ml-2 self-center"> {'Default'} </span>
                    {:else}
                        <span class="ml-2 self-center"> {'Custom'} </span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.logit_bias ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        class="text-sm w-full bg-transparent outline-hidden outline-none"
                        type="text"
                        placeholder="Enter comma-separated 'token:bias_value' pairs (example: 5432:100, 413:-100)"
                        bind:value={params.logit_bias}
                        autocomplete="off"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="This option sets the maximum number of tokens the model can generate in its response. Increasing this limit allows the model to provide longer answers, but it may also increase the likelihood of unhelpful or irrelevant content being generated."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'max_tokens'}
                </div>

                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.max_tokens =
                            (params.max_tokens ?? undefined) === undefined ? 128 : undefined;
                    }}
                >
                    {#if (params.max_tokens ?? undefined) === undefined}
                        <span class="ml-2 self-center">{'Default'}</span>
                    {:else}
                        <span class="ml-2 self-center">{'Custom'}</span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.max_tokens ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        id="steps-range"
                        type="range"
                        min="-2"
                        max="131072"
                        step="1"
                        bind:value={params.max_tokens}
                        class="w-full h-2 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                </div>
                <div>
                    <input
                        bind:value={params.max_tokens}
                        type="number"
                        class=" bg-transparent text-center w-14"
                        min="-2"
                        step="1"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Reduces the probability of generating nonsense. A higher value (e.g. 100) will give more diverse answers, while a lower value (e.g. 10) will be more conservative."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'top_k'}
                </div>
                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.top_k = (params.top_k ?? undefined) === undefined ? 40 : undefined;
                    }}
                >
                    {#if (params.top_k ?? undefined) === undefined}
                        <span class="ml-2 self-center">{'Default'}</span>
                    {:else}
                        <span class="ml-2 self-center">{'Custom'}</span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.top_k ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        id="steps-range"
                        type="range"
                        min="0"
                        max="1000"
                        step="0.5"
                        bind:value={params.top_k}
                        class="w-full h-2 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                </div>
                <div>
                    <input
                        bind:value={params.top_k}
                        type="number"
                        class=" bg-transparent text-center w-14"
                        min="0"
                        max="100"
                        step="any"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Works together with top-k. A higher value (e.g., 0.95) will lead to more diverse text, while a lower value (e.g., 0.5) will generate more focused and conservative text."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'top_p'}
                </div>

                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.top_p = (params.top_p ?? undefined) === undefined ? 0.9 : undefined;
                    }}
                >
                    {#if (params.top_p ?? undefined) === undefined}
                        <span class="ml-2 self-center">{'Default'}</span>
                    {:else}
                        <span class="ml-2 self-center">{'Custom'}</span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.top_p ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        id="steps-range"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        bind:value={params.top_p}
                        class="w-full h-2 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                </div>
                <div>
                    <input
                        bind:value={params.top_p}
                        type="number"
                        class=" bg-transparent text-center w-14"
                        min="0"
                        max="1"
                        step="any"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Alternative to the top_p, and aims to ensure a balance of quality and variety. The parameter p represents the minimum probability for a token to be considered, relative to the probability of the most likely token. For example, with p=0.05 and the most likely token having a probability of 0.9, logits with a value less than 0.045 are filtered out."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'min_p'}
                </div>
                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.min_p = (params.min_p ?? undefined) === undefined ? 0.0 : undefined;
                    }}
                >
                    {#if (params.min_p ?? undefined) === undefined}
                        <span class="ml-2 self-center">{'Default'}</span>
                    {:else}
                        <span class="ml-2 self-center">{'Custom'}</span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.min_p ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        id="steps-range"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        bind:value={params.min_p}
                        class="w-full h-2 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                </div>
                <div>
                    <input
                        bind:value={params.min_p}
                        type="number"
                        class=" bg-transparent text-center w-14"
                        min="0"
                        max="1"
                        step="any"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Sets a scaling bias against tokens to penalize repetitions, based on how many times they have appeared. A higher value (e.g., 1.5) will penalize repetitions more strongly, while a lower value (e.g., 0.9) will be more lenient. At 0, it is disabled."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'frequency_penalty'}
                </div>

                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.frequency_penalty =
                            (params.frequency_penalty ?? undefined) === undefined ? 1.1 : undefined;
                    }}
                >
                    {#if (params.frequency_penalty ?? undefined) === undefined}
                        <span class="ml-2 self-center">{'Default'}</span>
                    {:else}
                        <span class="ml-2 self-center">{'Custom'}</span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.frequency_penalty ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        id="steps-range"
                        type="range"
                        min="-2"
                        max="2"
                        step="0.05"
                        bind:value={params.frequency_penalty}
                        class="w-full h-2 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                </div>
                <div>
                    <input
                        bind:value={params.frequency_penalty}
                        type="number"
                        class=" bg-transparent text-center w-14"
                        min="-2"
                        max="2"
                        step="any"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Sets a flat bias against tokens that have appeared at least once. A higher value (e.g., 1.5) will penalize repetitions more strongly, while a lower value (e.g., 0.9) will be more lenient. At 0, it is disabled."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'presence_penalty'}
                </div>

                <button
                    class="p-1 px-3 text-xs flex rounded transition flex-shrink-0 outline-none"
                    type="button"
                    on:click={() => {
                        params.presence_penalty =
                            (params.presence_penalty ?? undefined) === undefined ? 0.0 : undefined;
                    }}
                >
                    {#if (params.presence_penalty ?? undefined) === undefined}
                        <span class="ml-2 self-center">{'Default'}</span>
                    {:else}
                        <span class="ml-2 self-center">{'Custom'}</span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.presence_penalty ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        id="steps-range"
                        type="range"
                        min="-2"
                        max="2"
                        step="0.05"
                        bind:value={params.presence_penalty}
                        class="w-full h-2 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                </div>
                <div>
                    <input
                        bind:value={params.presence_penalty}
                        type="number"
                        class=" bg-transparent text-center w-14"
                        min="-2"
                        max="2"
                        step="any"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Enable Mirostat sampling for controlling perplexity."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'mirostat'}
                </div>
                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.mirostat =
                            (params.mirostat ?? undefined) === undefined ? 0 : undefined;
                    }}
                >
                    {#if (params.mirostat ?? undefined) === undefined}
                        <span class="ml-2 self-center">{'Default'}</span>
                    {:else}
                        <span class="ml-2 self-center">{'Custom'}</span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.mirostat ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        id="steps-range"
                        type="range"
                        min="0"
                        max="2"
                        step="1"
                        bind:value={params.mirostat}
                        class="w-full h-2 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                </div>
                <div>
                    <input
                        bind:value={params.mirostat}
                        type="number"
                        class=" bg-transparent text-center w-14"
                        min="0"
                        max="2"
                        step="1"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Influences how quickly the algorithm responds to feedback from the generated text. A lower learning rate will result in slower adjustments, while a higher learning rate will make the algorithm more responsive."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'mirostat_eta'}
                </div>
                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.mirostat_eta =
                            (params.mirostat_eta ?? undefined) === undefined ? 0.1 : undefined;
                    }}
                >
                    {#if (params.mirostat_eta ?? undefined) === undefined}
                        <span class="ml-2 self-center">{'Default'}</span>
                    {:else}
                        <span class="ml-2 self-center">{'Custom'}</span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.mirostat_eta ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        id="steps-range"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        bind:value={params.mirostat_eta}
                        class="w-full h-2 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                </div>
                <div>
                    <input
                        bind:value={params.mirostat_eta}
                        type="number"
                        class=" bg-transparent text-center w-14"
                        min="0"
                        max="1"
                        step="any"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Controls the balance between coherence and diversity of the output. A lower value will result in more focused and coherent text."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'mirostat_tau'}
                </div>

                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.mirostat_tau =
                            (params.mirostat_tau ?? undefined) === undefined ? 5.0 : undefined;
                    }}
                >
                    {#if (params.mirostat_tau ?? undefined) === undefined}
                        <span class="ml-2 self-center">{'Default'}</span>
                    {:else}
                        <span class="ml-2 self-center">{'Custom'}</span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.mirostat_tau ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        id="steps-range"
                        type="range"
                        min="0"
                        max="10"
                        step="0.5"
                        bind:value={params.mirostat_tau}
                        class="w-full h-2 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                </div>
                <div>
                    <input
                        bind:value={params.mirostat_tau}
                        type="number"
                        class=" bg-transparent text-center w-14"
                        min="0"
                        max="10"
                        step="any"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Sets how far back for the model to look back to prevent repetition."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'repeat_last_n'}
                </div>

                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.repeat_last_n =
                            (params.repeat_last_n ?? undefined) === undefined ? 64 : undefined;
                    }}
                >
                    {#if (params.repeat_last_n ?? undefined) === undefined}
                        <span class="ml-2 self-center">{'Default'}</span>
                    {:else}
                        <span class="ml-2 self-center">{'Custom'}</span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.repeat_last_n ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        id="steps-range"
                        type="range"
                        min="-1"
                        max="128"
                        step="1"
                        bind:value={params.repeat_last_n}
                        class="w-full h-2 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                </div>
                <div>
                    <input
                        bind:value={params.repeat_last_n}
                        type="number"
                        class=" bg-transparent text-center w-14"
                        min="-1"
                        max="128"
                        step="1"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Tail free sampling is used to reduce the impact of less probable tokens from the output. A higher value (e.g., 2.0) will reduce the impact more, while a value of 1.0 disables this setting."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'tfs_z'}
                </div>

                <button
                    class="p-1 px-3 text-xs flex rounded-sm transition shrink-0 outline-hidden"
                    type="button"
                    on:click={() => {
                        params.tfs_z = (params.tfs_z ?? undefined) === undefined ? 1 : undefined;
                    }}
                >
                    {#if (params.tfs_z ?? undefined) === undefined}
                        <span class="ml-2 self-center">{'Default'}</span>
                    {:else}
                        <span class="ml-2 self-center">{'Custom'}</span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.tfs_z ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        id="steps-range"
                        type="range"
                        min="0"
                        max="2"
                        step="0.05"
                        bind:value={params.tfs_z}
                        class="w-full h-2 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                </div>
                <div>
                    <input
                        bind:value={params.tfs_z}
                        type="number"
                        class=" bg-transparent text-center w-14"
                        min="0"
                        max="2"
                        step="any"
                    />
                </div>
            </div>
        {/if}
    </div>

    <div class=" py-0.5 w-full justify-between">
        <Tooltip
            content="Control the repetition of token sequences in the generated text. A higher value (e.g., 1.5) will penalize repetitions more strongly, while a lower value (e.g., 1.1) will be more lenient. At 1, it is disabled."
            placement="top-start"
            className="inline-tooltip"
        >
            <div class="flex w-full justify-between">
                <div class=" self-center text-xs font-medium">
                    {'repeat_penalty'}
                </div>

                <button
                    class="p-1 px-3 text-xs flex rounded transition flex-shrink-0 outline-none"
                    type="button"
                    on:click={() => {
                        params.repeat_penalty =
                            (params.repeat_penalty ?? undefined) === undefined ? 1.1 : undefined;
                    }}
                >
                    {#if (params.repeat_penalty ?? undefined) === undefined}
                        <span class="ml-2 self-center">{'Default'}</span>
                    {:else}
                        <span class="ml-2 self-center">{'Custom'}</span>
                    {/if}
                </button>
            </div>
        </Tooltip>

        {#if (params.repeat_penalty ?? undefined) !== undefined}
            <div class="flex mt-0.5 space-x-2">
                <div class=" flex-1">
                    <input
                        id="steps-range"
                        type="range"
                        min="-2"
                        max="2"
                        step="0.05"
                        bind:value={params.repeat_penalty}
                        class="w-full h-2 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                </div>
                <div>
                    <input
                        bind:value={params.repeat_penalty}
                        type="number"
                        class=" bg-transparent text-center w-14"
                        min="-2"
                        max="2"
                        step="any"
                    />
                </div>
            </div>
        {/if}
    </div>
</div>
