import { API_BASE_URL } from '$lib/constants';
import type { ModelResponse, ModelAccessResponse, ModelForm } from '@backend/routes/types.js';

export const getModels = async (token: string = ''): Promise<ModelResponse[]> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/models`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
        }
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .catch((err) => {
            error = err;
            console.error(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const getBaseModels = async (token: string = ''): Promise<ModelResponse[]> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/models/base`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
        }
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .catch((err) => {
            error = err;
            console.error(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const createNewModel = async (token: string, model: ModelForm): Promise<ModelResponse> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/models/create`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
        },
        body: JSON.stringify(model)
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .catch((err) => {
            error = err.detail;
            console.error(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const getModelById = async (token: string, id: string): Promise<ModelAccessResponse> => {
    let error = null;

    const searchParams = new URLSearchParams();
    searchParams.append('id', id);

    const res = await fetch(`${API_BASE_URL}/models/model?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
        }
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .then((json) => {
            return json;
        })
        .catch((err) => {
            error = err;

            console.error(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const toggleModelById = async (token: string, id: string): Promise<ModelResponse | null> => {
    let error = null;

    const searchParams = new URLSearchParams();
    searchParams.append('id', id);

    const res = await fetch(`${API_BASE_URL}/models/model/toggle?${searchParams.toString()}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
        }
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .then((json) => {
            return json;
        })
        .catch((err) => {
            error = err;

            console.error(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const updateModelById = async (
    token: string,
    id: string,
    model: ModelForm
): Promise<ModelResponse> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/models/model/update`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ ...model, id })
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .then((json) => {
            return json;
        })
        .catch((err) => {
            error = err;

            console.error(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const deleteModelById = async (token: string, id: string): Promise<boolean> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/models/model/delete`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ id })
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .then((json) => {
            return json;
        })
        .catch((err) => {
            error = err.detail;

            console.error(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const wakeModel = async (
    token: string,
    modelId: string
): Promise<'idle' | 'queued' | 'active'> => {
    const res = await fetch(`${API_BASE_URL}/models/${encodeURIComponent(modelId)}/wake`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) throw new Error('Wake request failed');
    const data = await res.json();
    return data.status;
};
