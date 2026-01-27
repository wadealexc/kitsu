# User Database Model

## Overview

The User model stores user profile information, settings, permissions, and metadata. It has a 1:1 relationship with the Auth model.

References:
- _OWUI Implementation:_ `open-webui/backend/open_webui/models/users.py`

## Table Schema

### Table Name: `user`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY, UNIQUE | User ID (UUID v4) |
| `username` | TEXT | NOT NULL, UNIQUE | Username (lowercase, alphanumeric + dash/underscore, 3-50 chars) |
| `role` | TEXT | NOT NULL | User role: "admin", "user", or "pending" |
| `profile_image_url` | TEXT | NOT NULL | Profile image URL or data URI |
| `profile_banner_image_url` | TEXT | NULLABLE | Optional banner image URL |
| `info` | TEXT (JSON) | NULLABLE | Custom user metadata (flexible JSON object; OWUI uses for geolocation) |
| `settings` | TEXT (JSON) | NULLABLE | User settings (UI preferences, etc.) |
| `last_active_at` | INTEGER | NOT NULL | Last activity timestamp (unix seconds) |
| `updated_at` | INTEGER | NOT NULL | Last update timestamp (unix seconds) |
| `created_at` | INTEGER | NOT NULL | Account creation timestamp (unix seconds) |

### Indexes

```sql
-- Primary key automatically creates index on id
CREATE UNIQUE INDEX idx_user_id ON user(id);

-- Username lookup (unique)
CREATE UNIQUE INDEX idx_user_username ON user(username);

-- Role filtering
CREATE INDEX idx_user_role ON user(role);

-- Activity tracking
CREATE INDEX idx_user_last_active_at ON user(last_active_at);

-- Creation order (for determining primary admin)
CREATE INDEX idx_user_created_at ON user(created_at);
```

### Special Logic

* All timestamps use _unix time in seconds_ (not milliseconds).
* `DEFAULT_USER_ROLE`: `user`

#### First User is Admin

_Rule:_ The first user created in the system is automatically assigned the "admin" role and is protected from modification/deletion by other admins.

_Usage in endpoints:_
- _Signup:_ First user gets "admin", subsequent users get `DEFAULT_USER_ROLE`
- _Update:_ Prevent non-primary-admin from modifying primary admin
- _Delete:_ Prevent deletion of primary admin
- _Role change:_ Prevent primary admin from downgrading own role

---

## Operations

### Core CRUD Operations

#### `createUser(data: NewUser): Promise<User>`

_Transaction:_ Yes (typically combined with auth creation)

Creates a new user record. Username is automatically validated and normalized to lowercase.

_Required fields:_
- `id` - UUID v4
- `username` - Username (will be validated and normalized: 3-50 chars, alphanumeric + dash/underscore, lowercase)
- `role` - 'admin', 'user', or 'pending'

_Auto-generated fields:_
- `createdAt` - Current unix timestamp (if not provided)
- `updatedAt` - Current unix timestamp (if not provided)
- `lastActiveAt` - Current unix timestamp (if not provided)
- `profileImageUrl` - Defaults to '/user.png' (if not provided)

_Validation:_
- Username format is validated via `validateUsername()` from auth operations
- Username is normalized to lowercase

_Example:_
```typescript
const user = await createUser({
    id: crypto.randomUUID(),
    username: 'JohnDoe', // Will be normalized to 'johndoe'
    role: 'user',
});
```

#### `getUserById(id: string): Promise<User | null>`

Retrieves user by ID.

_Use case:_ Profile lookup, authentication, authorization

#### `getUserByUsername(username: string): Promise<User | null>`

Retrieves user by username.

_Use case:_ Username uniqueness checks, lookup by username

#### `getUsers(options: GetUsersOptions): Promise<{ users: User[], total: number }>`

Lists users with pagination, filtering, and sorting. If limit is not provided, returns all matching users.

_Use case:_ Admin user management, user search

_Options:_
```typescript
type GetUsersOptions = {
    query?: string;                                              // Search by username
    role?: UserRole;                                             // Filter by role
    orderBy?: 'role' | 'username' | 'lastActiveAt' | 'createdAt'; // Sort field (default: 'createdAt')
    direction?: 'asc' | 'desc';                                  // Sort direction (default: 'desc')
    skip?: number;                                               // Offset for pagination
    limit?: number;                                              // Page size (optional, no limit if not provided)
};
```

#### `updateUser(id: string, updates: Partial<User>): Promise<User>`

Updates user fields. Only fields that are explicitly provided (not undefined) will be updated.

_Auto-updated fields:_
- `updatedAt` - Set to current unix timestamp

_Behavior:_
- Filters out `undefined` values to prevent overwriting fields with NULL
- Only provided fields are updated in the database

#### `updateLastActive(id: string): Promise<void>`

Updates user's last activity timestamp.

_Throttling:_ Should be throttled to avoid excessive writes (e.g., update max once per minute)

_Use case:_ Called on each authenticated request (via background task)

#### `deleteUser(id: string): Promise<boolean>`

Deletes user and cascades to:
- Auth record
- Chats
- Files
- Folders

_Transaction:_ Yes (cascades to related data)

_Protection:_ Cannot delete primary admin (first user)

---

### User Queries

#### `hasUsers(): Promise<boolean>`

Checks if any users exist in the system.

_Use case:_ Determine if first signup should be admin

#### `getFirstUser(): Promise<User | null>`

Returns the user with the earliest `created_at` timestamp.

_Use case:_ Identify primary admin for protection logic

_Query:_
```sql
SELECT * FROM user ORDER BY created_at ASC LIMIT 1;
```

#### `searchUsers(query: string, limit: number): Promise<User[]>`

Searches users by name or username (case-insensitive).

_Use case:_ User search/autocomplete in UI

---

### Settings & Metadata

#### `updateUserSettings(id: string, settings: UserSettings): Promise<UserSettings>`

Updates user's settings object.

_Validations:_
- Non-admin users cannot set `settings.ui.toolServers` without permission

_Use case:_ UI preferences, configuration

#### `updateUserInfo(id: string, info: Record<string, any>): Promise<Record<string, any>>`

Updates user's custom info object.

_Note:_ Flexible JSON structure, no strict schema

_Use case:_ Application-specific metadata

_OWUI Usage Reference:_
- **Primary use:** Stores user geolocation data for `{{USER_LOCATION}}` prompt template substitution
- **Structure example:** `{ "location": { "latitude": 37.7749, "longitude": -122.4194, "accuracy": 10 } }`
- **Frontend:** `open-webui/src/lib/components/chat/Chat.svelte` (lines 1890-1891, 2107-2108)
- **Backend:** `open-webui/backend/open_webui/routers/users.py` (lines 388-430)
- **Template processing:** `open-webui/backend/open_webui/utils/task.py` - Extracts `user.info.get("location")`
- **Feature:** Optional, user must enable "userLocation" setting; fetches browser geolocation on each message send
- **Extensible:** Can store any JSON data for custom features (preferences, metadata, etc.)

---

### Role & Permissions

#### `updateUserRole(id: string, role: UserRole): Promise<User>`

Updates user's role.

_Validations:_
- Cannot change primary admin's role from 'admin'
- Role must be 'admin', 'user', or 'pending'

_Use case:_ Admin user management

---

### Profile Operations

#### `updateProfile(id: string, profile: UpdateProfileData): Promise<User>`

Updates user's profile fields. Only fields that are explicitly provided (not undefined) will be updated.

_Fields:_
```typescript
type UpdateProfileData = {
    profileImageUrl?: string;
    profileBannerImageUrl?: string;
};
```

_Behavior:_
- Filters out `undefined` values to prevent overwriting fields with NULL
- Only provided fields are updated in the database

---

## Transaction Examples

### User Creation (with Auth)

```typescript
await db.transaction(async (tx) => {
    const userId = crypto.randomUUID();

    // createUser validates username automatically
    const user = await createUser({
        id: userId,
        username: username, // Will be validated and normalized
        role: await determineRole(tx),
        profileImageUrl: profileImageUrl,
    }, tx);

    // createAuth validates password and hashes automatically
    const auth = await createAuth(userId, username, password, tx);

    return { user, auth };
});
```

### User Update (with Username Change)

```typescript
await db.transaction(async (tx) => {
    // Validate and normalize
    const normalizedUsername = validateUsername(newUsername);

    // Check username uniqueness
    const existing = await getUserByUsername(normalizedUsername, tx);
    if (existing && existing.id !== userId) {
        throw new Error('Username already taken');
    }

    // Update user
    await tx
        .update(users)
        .set({
            username: normalizedUsername,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(users.id, userId));

    // Update auth
    await updateUsername(userId, newUsername, tx);
});
```

---

## Migration from Mock Data

When replacing mock user endpoints:

1. _GET `/api/v1/users/`_ - Use `getUsers()` with pagination (pass `limit`)
2. _GET `/api/v1/users/all`_ - Use `getUsers()` without limit (returns all users)
3. _GET `/api/v1/users/search`_ - Use `searchUsers()` or `getUsers()` with query filter
4. _GET `/api/v1/users/{user_id}`_ - Use `getUserById()`
5. _POST `/api/v1/users/{user_id}/update`_ - Use `updateUser()` with validation
6. _DELETE `/api/v1/users/{user_id}`_ - Use `deleteUser()` with primary admin check
7. _GET `/api/v1/users/user/settings`_ - Return `user.settings`
8. _POST `/api/v1/users/user/settings/update`_ - Use `updateUserSettings()`
9. _GET `/api/v1/users/user/info`_ - Return `user.info`
10. _POST `/api/v1/users/user/info/update`_ - Use `updateUserInfo()`
