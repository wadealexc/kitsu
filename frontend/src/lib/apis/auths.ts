import { API_BASE_URL } from '$lib/constants';
import type {
    SessionUserResponse,
    SignoutResponse,
    AdminConfig,
    UpdateProfileResponse,
    UpdateProfileForm
} from '@backend/routes/types.js';

export const getAdminConfig = async (token: string): Promise<AdminConfig> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/auths/admin/config`, {
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

export const updateAdminConfig = async (token: string, body: AdminConfig): Promise<AdminConfig> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/auths/admin/config`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
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

export const getSessionUser = async (token: string): Promise<SessionUserResponse> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/auths/`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        credentials: 'include'
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

export const userSignIn = async (
    username: string,
    password: string
): Promise<SessionUserResponse> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/auths/signin`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
            username: username,
            password: password
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

export const userSignUp = async (
    username: string,
    password: string
): Promise<SessionUserResponse> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/auths/signup`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
            username: username,
            password: password
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

export const userSignOut = async (): Promise<SignoutResponse> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/auths/signout`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include'
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

    sessionStorage.clear();
    return res;
};

export const updateUserProfile = async (
    token: string,
    profile: UpdateProfileForm
): Promise<UpdateProfileResponse> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/auths/update/profile`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token && { authorization: `Bearer ${token}` })
        },
        body: JSON.stringify({
            ...profile
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

export const updateUserTimezone = async (token: string, timezone: string) => {
    await fetch(`${API_BASE_URL}/auths/update/timezone`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token && { authorization: `Bearer ${token}` })
        },
        body: JSON.stringify({ timezone })
    }).catch((err) => {
        console.error('Failed to update timezone:', err);
    });
};

export const updateUserPassword = async (
    token: string,
    password: string,
    newPassword: string
): Promise<boolean> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/auths/update/password`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token && { authorization: `Bearer ${token}` })
        },
        body: JSON.stringify({
            password: password,
            new_password: newPassword
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
