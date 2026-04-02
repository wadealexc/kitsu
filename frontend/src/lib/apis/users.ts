import { API_BASE_URL } from '$lib/constants';
import { getUserPosition } from '$lib/utils';
import type {
    UserModelListResponse,
    UserActiveResponse,
    User,
    UserSettings,
    UserUpdateForm
} from '@backend/routes/types';

export const getUsers = async (
    token: string,
    query?: string,
    orderBy?: 'role' | 'username' | 'lastActiveAt' | 'createdAt',
    direction?: 'asc' | 'desc',
    page = 1
): Promise<UserModelListResponse> => {
    const searchParams = new URLSearchParams();

    searchParams.set('page', `${page}`);

    if (query) {
        searchParams.set('query', query);
    }

    if (orderBy) {
        searchParams.set('orderBy', orderBy);
    }

    if (direction) {
        searchParams.set('direction', direction);
    }

    const route = '/users/';
    const res = await fetch(`${API_BASE_URL}${route}?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
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

export const getUserSettings = async (token: string): Promise<UserSettings | null> => {
    const route = '/users/user/settings';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'GET',
        headers: {
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

export const updateUserSettings = async (
    token: string,
    settings: UserSettings
): Promise<UserSettings> => {
    const route = '/users/user/settings/update';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...settings })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const getUserById = async (token: string, userId: string): Promise<UserActiveResponse> => {
    const route = `/users/${userId}`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'GET',
        headers: {
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

export const updateUserInfo = async (
    token: string,
    info: object
): Promise<Record<string, any> | null> => {
    const route = '/users/user/info/update';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...info })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
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
    const route = `/users/${userId}`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'DELETE',
        headers: {
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

export const updateUserById = async (
    token: string,
    userId: string,
    user: UserUpdateForm
): Promise<User> => {
    const route = `/users/${userId}/update`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            role: user.role,
            username: user.username,
            password: user.password !== '' ? user.password : undefined
        })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};
