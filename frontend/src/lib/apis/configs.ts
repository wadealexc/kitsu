import { API_BASE_URL } from '$lib/constants';
import type { Config } from '$lib/stores';

export const getBackendConfig = async (): Promise<Config> => {
    const route = '/configs/';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};
