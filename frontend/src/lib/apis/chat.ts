import { API_BASE_URL } from '$lib/constants';
import type { ChatCompletionForm } from '@backend/routes/types.js';

export const chatCompletion = async (
    token: string,
    body: ChatCompletionForm
): Promise<[Response | null, AbortController]> => {
    const controller = new AbortController();

    const res = await fetch(`${API_BASE_URL}/chat/custom-completions`, {
        signal: controller.signal,
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    return [res, controller];
};
