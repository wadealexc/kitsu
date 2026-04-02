import { API_BASE_URL } from '$lib/constants';
import type { ModelResponse, ModelAccessResponse, ModelForm } from '@backend/routes/types';

export const getModels = async (token: string): Promise<ModelResponse[]> => {
    const route = '/models';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const getBaseModels = async (token: string): Promise<ModelResponse[]> => {
    const route = '/models/base';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const createNewModel = async (token: string, model: ModelForm): Promise<ModelResponse> => {
    const route = '/models/create';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(model)
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const getModelById = async (token: string, id: string): Promise<ModelAccessResponse> => {
    const searchParams = new URLSearchParams();
    searchParams.append('id', id);

    const route = '/models/model';
    const res = await fetch(`${API_BASE_URL}${route}?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const toggleModelById = async (token: string, id: string): Promise<ModelResponse | null> => {
    const searchParams = new URLSearchParams();
    searchParams.append('id', id);

    const route = '/models/model/toggle';
    const res = await fetch(`${API_BASE_URL}${route}?${searchParams.toString()}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const updateModelById = async (
    token: string,
    id: string,
    model: ModelForm
): Promise<ModelResponse> => {
    const route = '/models/model/update';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...model, id })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const deleteModelById = async (token: string, id: string): Promise<boolean> => {
    const route = '/models/model/delete';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const wakeModel = async (
    token: string,
    modelId: string
): Promise<'idle' | 'queued' | 'active'> => {
    const route = `/models/${encodeURIComponent(modelId)}/wake`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    const data = await res.json();
    return data.status;
};
