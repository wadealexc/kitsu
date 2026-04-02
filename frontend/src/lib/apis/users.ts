import { API_BASE_URL } from '$lib/constants';
import { getUserPosition } from '$lib/utils';
import type {
    UserModelListResponse,
    UserActiveResponse,
    UserModel,
    UserSettings,
    UserUpdateForm
} from '@backend/routes/types.js';

export const getUsers = async (
    token: string,
    query?: string,
    orderBy?: 'role' | 'username' | 'last_active_at' | 'created_at',
    direction?: 'asc' | 'desc',
    page = 1
): Promise<UserModelListResponse> => {
    let error = null;
    let res = null;

    const searchParams = new URLSearchParams();

    searchParams.set('page', `${page}`);

    if (query) {
        searchParams.set('query', query);
    }

    if (orderBy) {
        searchParams.set('order_by', orderBy);
    }

    if (direction) {
        searchParams.set('direction', direction);
    }

    res = await fetch(`${API_BASE_URL}/users/?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        }
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .catch((err) => {
            console.error(err);
            error = err.detail;
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const getUserSettings = async (token: string): Promise<UserSettings | null> => {
    let error = null;
    const res = await fetch(`${API_BASE_URL}/users/user/settings`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        }
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .catch((err) => {
            console.error(err);
            error = err.detail;
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const updateUserSettings = async (
    token: string,
    settings: UserSettings
): Promise<UserSettings> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/users/user/settings/update`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            ...settings
        })
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .catch((err) => {
            console.error(err);
            error = err.detail;
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const getUserById = async (token: string, userId: string): Promise<UserActiveResponse> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        }
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .catch((err) => {
            console.error(err);
            error = err.detail;
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const updateUserInfo = async (
    token: string,
    info: object
): Promise<Record<string, any> | null> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/users/user/info/update`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            ...info
        })
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .catch((err) => {
            console.error(err);
            error = err.detail;
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const getAndUpdateUserLocation = async (token: string) => {
    const location = await getUserPosition().catch((err) => {
        console.error(err);
        return null;
    });

    if (location) {
        await updateUserInfo(token, { location: location });
        return location;
    } else {
        console.info('Failed to get user location');
        return null;
    }
};

export const deleteUserById = async (token: string, userId: string): Promise<boolean> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        }
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .catch((err) => {
            console.error(err);
            error = err.detail;
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const updateUserById = async (
    token: string,
    userId: string,
    user: UserUpdateForm
): Promise<UserModel> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/users/${userId}/update`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            role: user.role,
            username: user.username,
            password: user.password !== '' ? user.password : undefined
        })
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .catch((err) => {
            console.error(err);
            error = err.detail;
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};
