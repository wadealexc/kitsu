<script lang="ts">
    import TurndownService from 'turndown';
    const turndownService = new TurndownService({
        codeBlockStyle: 'fenced',
        headingStyle: 'atx'
    });
    turndownService.escape = (string) => string;

    import { onMount, onDestroy } from 'svelte';
    import { createEventDispatcher } from 'svelte';

    const eventDispatch = createEventDispatcher();

    import { Fragment } from 'prosemirror-model';
    import type { Node as PmNode } from 'prosemirror-model';
    import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
    import type { EditorState, Transaction } from 'prosemirror-state';
    import { Decoration, DecorationSet } from 'prosemirror-view';
    import { Editor, Extension, type JSONContent, getHTMLFromFragment } from '@tiptap/core';

    import StarterKit from '@tiptap/starter-kit';

    import { Placeholder } from '@tiptap/extensions';

    export let oncompositionstart: (e: CompositionEvent) => void = () => {};
    export let oncompositionend: (e: CompositionEvent) => void = () => {};
    export let onChange: (content: { html: string; json: object; md: string }) => void = () => {};

    let editor: Editor | null = null;

    export let placeholder = 'Type here...';
    let _placeholder = placeholder;

    $: if (placeholder !== _placeholder) {
        setPlaceholder();
    }

    const setPlaceholder = () => {
        _placeholder = placeholder;
        if (editor) {
            editor?.view.dispatch(editor.state.tr);
        }
    };

    export let id = '';
    export let value: JSONContent | null = null;
    export let html = '';

    export let editable = true;

    export let messageInput = false;
    export let shiftEnter = false;

    let content: string | JSONContent | null = null;
    let htmlValue = '';
    let jsonValue: JSONContent = {};
    let mdValue = '';

    let element: Element | null = null;

    $: if (editor) {
        editor.setOptions({
            editable: editable
        });
    }

    $: if (value === null && html !== null && editor) {
        editor.commands.setContent(html);
    }

    export const setText = (text: string) => {
        if (!editor || !editor.view) return;
        text = text.replaceAll('\n\n', '\n');

        // reset the editor content
        editor.commands.clearContent();

        const { state, view } = editor;
        const { schema, tr } = state;

        if (text.includes('\n')) {
            // Multiple lines: make paragraphs
            const lines = text.split('\n');
            // Map each line to a paragraph node (empty lines -> empty paragraph)
            const nodes = lines.map((line) =>
                schema.nodes.paragraph.create({}, line ? schema.text(line) : undefined)
            );
            // Create a document fragment containing all parsed paragraphs
            const fragment = Fragment.fromArray(nodes);
            // Replace current selection with these paragraphs
            const { from, to } = state.selection;
            tr.replaceWith(from, to, fragment);
            view.dispatch(tr);
        } else if (text === '') {
            // Empty: replace with empty paragraph using tr
            editor.commands.clearContent();
        } else {
            // Single line: create paragraph with text
            const paragraph = schema.nodes.paragraph.create({}, schema.text(text));
            tr.replaceSelectionWith(paragraph, false);
            view.dispatch(tr);
        }

        selectNextTemplate(editor.view.state, editor.view.dispatch);
    };

    export const focus = () => {
        if (editor && editor.view) {
            // Check if the editor is destroyed
            if (editor.isDestroyed) {
                return;
            }

            try {
                editor.view.focus();
                // Scroll to the current selection
                editor.view.dispatch(editor.view.state.tr.scrollIntoView());
            } catch (e) {
                // sometimes focusing throws an error, ignore
                console.warn('Error focusing editor', e);
            }
        }
    };

    // Function to find the next template in the document
    function findNextTemplate(doc: PmNode, from: number = 0): { from: number; to: number } | null {
        const patterns = [{ start: '{{', end: '}}' }];

        let result: { from: number; to: number } | null = null;

        doc.nodesBetween(from, doc.content.size, (node: PmNode, pos: number) => {
            if (result) return false; // Stop if we've found a match
            if (node.isText && node.text != null) {
                const text = node.text;
                let index = Math.max(0, from - pos);
                while (index < text.length) {
                    for (const pattern of patterns) {
                        if (text.startsWith(pattern.start, index)) {
                            const endIndex = text.indexOf(
                                pattern.end,
                                index + pattern.start.length
                            );
                            if (endIndex !== -1) {
                                result = {
                                    from: pos + index,
                                    to: pos + endIndex + pattern.end.length
                                };
                                return false; // Stop searching
                            }
                        }
                    }
                    index++;
                }
            }
        });

        return result;
    }

    // Function to select the next template in the document
    function selectNextTemplate(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
        const { doc, selection } = state;
        const from = selection.to;
        let template = findNextTemplate(doc, from);

        if (!template) {
            // If not found, search from the beginning
            template = findNextTemplate(doc, 0);
        }

        if (template) {
            if (dispatch) {
                const tr = state.tr.setSelection(
                    TextSelection.create(doc, template.from, template.to)
                );
                dispatch(tr);

                // Scroll to the selected template
                dispatch(
                    tr.scrollIntoView().setMeta('preventScroll', true) // Prevent default scrolling behavior
                );
            }
            return true;
        }
        return false;
    }

    export const setContent = (content: string | JSONContent | null): void => {
        if (!editor) return;
        editor.commands.setContent(content);
    };

    const selectTemplate = (): void => {
        if (value === null || !editor) return;
        // After updating the state, try to find and select the next template
        setTimeout(() => {
            if (!editor) return;
            const templateFound = selectNextTemplate(editor.view.state, editor.view.dispatch);
            if (!templateFound) {
                editor.commands.focus('end');
            }
        }, 0);
    };

    const SelectionDecoration = Extension.create({
        name: 'selectionDecoration',
        addProseMirrorPlugins() {
            return [
                new Plugin({
                    key: new PluginKey('selection'),
                    props: {
                        decorations: (state) => {
                            const { selection } = state;
                            const focused = this.editor.isFocused;

                            if (focused || selection.empty) {
                                return null;
                            }

                            return DecorationSet.create(state.doc, [
                                Decoration.inline(selection.from, selection.to, {
                                    class: 'editor-selection'
                                })
                            ]);
                        }
                    }
                })
            ];
        }
    });

    onMount(async () => {
        content = value;

        if (!content) {
            content = html ? html : null;
        }

        editor = new Editor({
            element: element,
            extensions: [
                StarterKit.configure({}),
                Placeholder.configure({
                    placeholder: () => _placeholder,
                    showOnlyWhenEditable: false
                }),
                SelectionDecoration
            ],
            content: content,
            autofocus: messageInput ? true : false,
            onTransaction: () => {
                // force re-render so `editor.isActive` works as expected
                editor = editor;
                if (!editor) return;

                htmlValue = editor.getHTML();
                jsonValue = editor.getJSON();

                mdValue = turndownService
                    .turndown(
                        htmlValue
                            // Replace empty paragraphs with line breaks
                            .replace(/<p><\/p>/g, '<br/>')
                            // Replace multiple spaces with non-breaking spaces
                            .replace(/ {2,}/g, (m) => m.replace(/ /g, '\u00a0'))
                            // Replace tabs with non-breaking spaces (preserve indentation)
                            .replace(/\t/g, '\u00a0\u00a0\u00a0\u00a0') // 1 tab = 4 spaces
                    )
                    // Convert non-breaking spaces back to regular spaces for markdown
                    .replace(/\u00a0/g, ' ');

                onChange({
                    html: htmlValue,
                    json: jsonValue,
                    md: mdValue
                });

                value = jsonValue;
            },
            editorProps: {
                attributes: { id },
                handlePaste: (view, event) => {
                    // Always use plain-text paste
                    event.preventDefault();
                    const { state, dispatch } = view;

                    const plainText = (event.clipboardData?.getData('text/plain') ?? '').replace(
                        /\r\n/g,
                        '\n'
                    );

                    const lines = plainText.split('\n');
                    const nodes: PmNode[] = [];

                    lines.forEach((line, index) => {
                        if (index > 0) {
                            nodes.push(state.schema.nodes.hardBreak.create());
                        }
                        if (line.length > 0) {
                            nodes.push(state.schema.text(line));
                        }
                    });

                    const fragment = Fragment.fromArray(nodes);
                    const { from, to } = state.selection;
                    dispatch(state.tr.replaceWith(from, to, fragment).scrollIntoView());

                    return true; // handled
                },
                handleDOMEvents: {
                    compositionstart: (view, event) => {
                        oncompositionstart(event);
                        return false;
                    },
                    compositionend: (view, event) => {
                        oncompositionend(event);
                        return false;
                    },
                    keydown: (view, event) => {
                        if (messageInput) {
                            if (!editor) return false;
                            // Check if the current selection is inside a structured block (like codeBlock or list)
                            const { state } = view;
                            const { $head } = state.selection;

                            // Recursive function to check ancestors for specific node types
                            function isInside(nodeTypes: string[]): boolean {
                                let currentNode = $head;
                                while (currentNode) {
                                    if (nodeTypes.includes(currentNode.parent.type.name)) {
                                        return true;
                                    }
                                    if (!currentNode.depth) break; // Stop if we reach the top
                                    currentNode = state.doc.resolve(currentNode.before()); // Move to the parent node
                                }
                                return false;
                            }

                            // Handle Tab Key
                            if (event.key === 'Tab') {
                                const isInCodeBlock = isInside(['codeBlock']);

                                if (isInCodeBlock) {
                                    // Handle tab in code block - insert tab character or spaces
                                    const tabChar = '\t'; // or '    ' for 4 spaces
                                    editor.commands.insertContent(tabChar);
                                    event.preventDefault();
                                    return true; // Prevent further propagation
                                } else {
                                    const handled = selectNextTemplate(view.state, view.dispatch);
                                    if (handled) {
                                        event.preventDefault();
                                        return true;
                                    }
                                }
                            }

                            if (event.key === 'Enter') {
                                const isCtrlPressed = event.ctrlKey || event.metaKey; // metaKey is for Cmd key on Mac

                                const { state } = view;
                                const { $from } = state.selection;
                                const lineStart = $from.before($from.depth);
                                const lineEnd = $from.after($from.depth);
                                const lineText = state.doc
                                    .textBetween(lineStart, lineEnd, '\n', '\0')
                                    .trim();
                                if (event.shiftKey && !isCtrlPressed) {
                                    if (lineText.startsWith('```')) {
                                        // Fix GitHub issue #16337: prevent backtick removal for lines starting with ```
                                        return false; // Let ProseMirror handle the Enter key normally
                                    }

                                    editor.commands.enter(); // Insert a new line
                                    view.dispatch(view.state.tr.scrollIntoView()); // Move viewport to the cursor
                                    event.preventDefault();
                                    return true;
                                } else {
                                    const isInCodeBlock = isInside(['codeBlock']);
                                    const isInList = isInside([
                                        'listItem',
                                        'bulletList',
                                        'orderedList'
                                    ]);
                                    const isInHeading = isInside(['heading']);

                                    if (isInCodeBlock || isInList || isInHeading) {
                                        // Let ProseMirror handle the normal Enter behavior
                                        return false;
                                    }
                                }
                            }

                            // Handle shift + Enter for a line break
                            if (shiftEnter) {
                                if (
                                    event.key === 'Enter' &&
                                    event.shiftKey &&
                                    !event.ctrlKey &&
                                    !event.metaKey
                                ) {
                                    editor.commands.setHardBreak(); // Insert a hard break
                                    view.dispatch(view.state.tr.scrollIntoView()); // Move viewport to the cursor
                                    event.preventDefault();
                                    return true;
                                }
                            }
                        }
                        eventDispatch('keydown', { event });
                        return false;
                    },
                    paste: (view, event) => {
                        if (event.clipboardData) {
                            const plainText = event.clipboardData.getData('text/plain');
                            if (plainText) {
                                // Workaround for mobile WebViews that strip line breaks when pasting from
                                // clipboard suggestions (e.g., Gboard clipboard history).
                                const isMobile = /Android|iPhone|iPad|iPod|Windows Phone/i.test(
                                    navigator.userAgent
                                );
                                const isWebView =
                                    typeof window !== 'undefined' &&
                                    (/wv/i.test(navigator.userAgent) || // Standard Android WebView flag
                                        (navigator.userAgent.includes('Android') &&
                                            !navigator.userAgent.includes('Chrome')) || // Other generic Android WebViews
                                        (navigator.userAgent.includes('Safari') &&
                                            !navigator.userAgent.includes('Version'))); // iOS WebView (in-app browsers)

                                if (isMobile && isWebView && plainText.includes('\n')) {
                                    // Manually deconstruct the pasted text and insert it with hard breaks
                                    // to preserve the multi-line formatting.
                                    const { state, dispatch } = view;
                                    const { from, to } = state.selection;

                                    const lines = plainText.split('\n');
                                    const nodes: PmNode[] = [];

                                    lines.forEach((line, index) => {
                                        if (index > 0) {
                                            nodes.push(state.schema.nodes.hardBreak.create());
                                        }
                                        if (line.length > 0) {
                                            nodes.push(state.schema.text(line));
                                        }
                                    });

                                    const fragment = Fragment.fromArray(nodes);
                                    const tr = state.tr.replaceWith(from, to, fragment);
                                    dispatch(tr.scrollIntoView());
                                    event.preventDefault();
                                    return true;
                                }
                                // Let ProseMirror handle normal text paste in non-problematic environments.
                                return false;
                            }

                            // Delegate image paste handling to the parent component.
                            const hasImageFile = Array.from(event.clipboardData.files).some(
                                (file) => file.type.startsWith('image/')
                            );
                            // Fallback for cases where an image is in dataTransfer.items but not clipboardData.files.
                            const hasImageItem = Array.from(event.clipboardData.items).some(
                                (item) => item.type.startsWith('image/')
                            );

                            const hasFile = Array.from(event.clipboardData.files).length > 0;

                            if (hasImageFile || hasImageItem || hasFile) {
                                eventDispatch('paste', { event });
                                event.preventDefault();
                                return true;
                            }
                        }
                        // For all other cases, let ProseMirror perform its default paste behavior.
                        view.dispatch(view.state.tr.scrollIntoView());
                        return false;
                    },
                    copy: (view, event: ClipboardEvent) => {
                        if (!event.clipboardData || !editor) return false;

                        const { state } = view;
                        const { from, to } = state.selection;

                        // Only take the selected text & HTML, not the full doc
                        const plain = state.doc.textBetween(from, to, '\n');
                        const slice = state.doc.slice(from, to);
                        const html = getHTMLFromFragment(slice.content, state.schema);

                        event.clipboardData.setData('text/plain', plain);
                        event.clipboardData.setData('text/html', html);

                        event.preventDefault();
                        return true;
                    }
                }
            },
            enableInputRules: false,
            enablePasteRules: false
        });

        if (messageInput) {
            selectTemplate();
        }
    });

    onDestroy(() => {
        if (editor) {
            editor.destroy();
        }
    });

    $: if (value !== null && editor) {
        onValueChange();
    }

    const onValueChange = () => {
        if (!editor) return;

        const jsonValue = editor.getJSON();

        if (value === null) {
            editor.commands.clearContent(); // Clear content if value is empty
            selectTemplate();

            return;
        }

        if (JSON.stringify(value) !== JSON.stringify(jsonValue)) {
            editor.commands.setContent(value);
            selectTemplate();
        }
    };
</script>

<div
    bind:this={element}
    dir="auto"
    class="relative w-full min-w-full input-prose min-h-fit h-full {!editable
        ? 'cursor-not-allowed'
        : ''}"
></div>
