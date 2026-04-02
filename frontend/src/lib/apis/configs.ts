import { API_BASE_URL } from '$lib/constants';
import type { Config } from '$lib/stores';

export const getBackendConfig = async (): Promise<Config> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/configs/`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .catch((err) => {
            console.error(err);
            error = err;
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};
