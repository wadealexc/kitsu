import { API_BASE_URL } from '$lib/constants';
import type {
    FolderModel,
    FolderNameIdResponse,
    FolderForm,
    FolderUpdateForm
} from '@backend/routes/types.js';

export const createNewFolder = async (
    token: string,
    folderForm: FolderForm
): Promise<FolderModel> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/folders/`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
        },
        body: JSON.stringify(folderForm)
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .catch((err) => {
            error = err.detail;
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const getFolders = async (token: string = ''): Promise<FolderNameIdResponse[]> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/folders/`, {
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
            error = err.detail;
            console.error(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const getFolderById = async (token: string, id: string): Promise<FolderModel> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/folders/${id}`, {
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
            error = err.detail;
            console.error(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const updateFolderById = async (
    token: string,
    id: string,
    folderForm: FolderUpdateForm
): Promise<FolderModel> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/folders/${id}/update`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
        },
        body: JSON.stringify(folderForm)
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

export const updateFolderIsExpandedById = async (
    token: string,
    id: string,
    isExpanded: boolean
): Promise<FolderModel> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/folders/${id}/update/expanded`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            is_expanded: isExpanded
        })
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

export const updateFolderParentIdById = async (
    token: string,
    id: string,
    parentId: string | null
): Promise<FolderModel> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/folders/${id}/update/parent`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            parent_id: parentId
        })
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

export const deleteFolderById = async (
    token: string,
    id: string,
    deleteContents: boolean
): Promise<boolean> => {
    let error = null;

    const searchParams = new URLSearchParams();
    searchParams.append('delete_contents', deleteContents ? 'true' : 'false');

    const res = await fetch(`${API_BASE_URL}/folders/${id}?${searchParams.toString()}`, {
        method: 'DELETE',
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
            error = err.detail;
            console.error(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};
