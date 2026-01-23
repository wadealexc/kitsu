# Auth Database Model

## Overview

The Auth model stores authentication credentials (username and password) for users. It has a 1:1 relationship with the User model via the `id` field.

References:
- _OWUI Implementation:_ `open-webui/backend/open_webui/models/auths.py`
- _Auth Utils:_ `open-webui/backend/open_webui/utils/auth.py`

## Table Schema

### Table Name: `auth`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY, FOREIGN KEY → user(id) ON DELETE CASCADE | User ID (UUID v4), 1:1 relationship with user table |
| `username` | TEXT | NOT NULL, UNIQUE | Username for authentication (lowercase, alphanumeric + dash/underscore) |
| `password` | TEXT | NOT NULL | Bcrypt hashed password |

### Indexes

```sql
-- Primary key automatically creates index on id
CREATE UNIQUE INDEX idx_auth_id ON auth(id);

-- Username lookup for signin (unique index)
CREATE UNIQUE INDEX idx_auth_username ON auth(username);
```

### Usernames

_Rules:_
- Length: 3-50 characters
- Characters: Alphanumeric + underscore + dash only (`a-zA-Z0-9_-`)
- Normalized to lowercase for consistency

### Password Handling

_Rules:_
- Length: 8-72 characters (upper bound due to bcrypt limitation)

_Hashing:_
- bcrypt.hash with 10 salt rounds
- bcrypt.compare

---

## Operations

### Core CRUD Operations

#### `createAuth(id: string, username: string, plainPassword: string): Promise<Auth>`

Creates a new auth record. Used during signup and admin user creation.

_Transaction:_ Yes (typically combined with user creation)

_Validation:_
- Username must be unique across all auth records
- Username must be 3-50 characters, alphanumeric + dash/underscore
- Password is automatically validated (8-72 bytes) and hashed with bcrypt
- ID must match corresponding user ID

_Example:_
```typescript
const auth = await createAuth(userId, 'johndoe', 'mypassword123');
```

#### `getAuthById(id: string): Promise<Auth | null>`

Retrieves auth record by user ID.

_Use case:_ Password verification, account status checks

#### `getAuthByUsername(username: string): Promise<Auth | null>`

Retrieves auth record by username.

_Use case:_ User lookup during signin

_Note:_ Username should be normalized to lowercase before querying.

#### `updatePassword(id: string, newPlainPassword: string): Promise<boolean>`

Updates user's password.

_Validation:_
- New password is automatically validated (8-72 bytes) and hashed with bcrypt

_Use case:_ Password change, password reset

#### `updateUsername(id: string, newUsername: string): Promise<boolean>`

Updates user's username.

_Validation:_
- New username must not be taken by another user
- Must pass username validation (3-50 chars, alphanumeric + dash/underscore)
- Should be normalized to lowercase

_Note:_ Must also update corresponding `user.username` field in transaction

#### `deleteAuth(id: string): Promise<boolean>`

Deletes auth record.

_Cascade behavior:_ Should cascade delete corresponding user record

_Use case:_ Account deletion

---

### Authentication Operations

#### `authenticateUser(username: string, plainPassword: string): Promise<{ user: User, auth: Auth } | null>`

Validates user credentials.

_Flow:_
1. Lookup auth record by username
2. Verify password using bcrypt.compare
3. Return user + auth if valid, null otherwise

_Use case:_ Signin endpoint

_Example:_
```typescript
const result = await authenticateUser('johndoe', 'password123');
if (!result) {
    throw new Error('Invalid credentials');
}
const { user, auth } = result;
```

---

## Implementation Notes

### Transaction Requirements

_Auth + User Creation (Signup):_
```typescript
await db.transaction(async (tx) => {
    const user = await createUser(tx, { id, username, role, ... });
    const auth = await createAuth(tx, id, username, plainPassword);
    return { user, auth };
});
```

_Username Change:_
```typescript
await db.transaction(async (tx) => {
    // Validate new username
    const normalizedUsername = validateUsername(newUsername);

    // Check uniqueness (exclude current user)
    const existing = await getUserByUsername(tx, normalizedUsername);
    if (existing && existing.id !== userId) {
        throw new Error('Username already taken');
    }

    // Update both tables
    await updateUserUsername(tx, userId, normalizedUsername);
    await updateAuthUsername(tx, userId, normalizedUsername);
});
```

_User Deletion:_
```typescript
await db.transaction(async (tx) => {
    // Check primary admin protection
    if (await isPrimaryAdmin(userId)) {
        throw new Error('Cannot delete primary admin');
    }

    // Delete user only - auth is automatically deleted via FK cascade
    await tx.delete(users).where(eq(users.id, userId));

    // Note: chats, files, folders also need FK constraints with ON DELETE CASCADE
    // to be automatically cleaned up. Otherwise, delete them manually first.
});
```

### Rate Limiting

_Signin attempts should be rate limited:_
- Limit: 15 attempts per 3 minutes per username
- Implementation: Use Redis or in-memory cache
- Reset on successful signin
- Key format: `auth:ratelimit:${username.toLowerCase()}`

## Migration from Mock Data

When replacing mock auth endpoints:

1. _Signup endpoint (`POST /api/v1/auths/signup`):_
   - Validate username format and uniqueness
   - Create auth + user in transaction (password validation and hashing handled by `createAuth`)
   - Generate JWT token
   - Set secure cookie

2. _Signin endpoint (`POST /api/v1/auths/signin`):_
   - Rate limit by username
   - Authenticate credentials using `authenticateUser`
   - Generate JWT token
   - Set secure cookie

3. _Password change endpoint (`POST /api/v1/auths/update/password`):_
   - Authenticate current password using `authenticateUser`
   - Update password using `updatePassword` (validation and hashing handled internally)

4. _Admin add user endpoint (`POST /api/v1/auths/add`):_
   - Admin permission check
   - Create auth + user (password validation and hashing handled by `createAuth`)
   - Generate token (but don't set cookie)