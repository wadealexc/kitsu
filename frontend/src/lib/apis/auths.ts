import { API_BASE_URL } from '$lib/constants';
import type {
    SessionUserResponse,
    SignoutResponse,
    AdminConfig,
    UpdateProfileResponse,
    UpdateProfileForm
} from '@backend/routes/types.js';

export const getAdminConfig = async (token: string): Promise<AdminConfig> => {
    const route = '/auths/admin/config';
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

export const updateAdminConfig = async (token: string, body: AdminConfig): Promise<AdminConfig> => {
    const route = '/auths/admin/config';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const getSessionUser = async (token: string): Promise<SessionUserResponse> => {
    const route = '/auths/';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        credentials: 'include'
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const userSignIn = async (
    username: string,
    password: string
): Promise<SessionUserResponse> => {
    const route = '/auths/signin';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const userSignUp = async (
    username: string,
    password: string
): Promise<SessionUserResponse> => {
    const route = '/auths/signup';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const userSignOut = async (): Promise<SignoutResponse> => {
    const route = '/auths/signout';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include'
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    sessionStorage.clear();
    return await res.json();
};

export const updateUserProfile = async (
    token: string,
    profile: UpdateProfileForm
): Promise<UpdateProfileResponse> => {
    const route = '/auths/update/profile';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...profile })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const updateUserTimezone = async (token: string, timezone: string): Promise<void> => {
    const route = '/auths/update/timezone';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ timezone })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }
};

export const updateUserPassword = async (
    token: string,
    password: string,
    newPassword: string
): Promise<boolean> => {
    const route = '/auths/update/password';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password, new_password: newPassword })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};
