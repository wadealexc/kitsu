# Authentication & Authorization Routes

## Endpoints

**Context:** Core authentication and authorization - session management, registration/login, profile updates, admin user management.

These endpoints handle user authentication (signin/signup/signout), session management, profile updates, password management, admin user creation, and admin configuration.

**Implementation Note - Cookie Clearing on Auth Failure:**
When implementing authentication middleware (`get_current_user()`), invalid or expired tokens should trigger automatic cookie deletion. This prevents authentication loops where the browser repeatedly sends invalid credentials. Clear the `token` cookie when:
- JWT token is expired, invalid, or malformed
- User ID from token doesn't exist in database
- Token signature verification fails
- Token has been revoked/blacklisted

This improves security hygiene and user experience by forcing clean re-authentication rather than leaving the client in a confused "half-authenticated" state.

---

### GET `/api/v1/auths/`

Returns the currently authenticated user's session information including their profile, permissions, and token expiration.

#### Inputs

None

#### Outputs

Response (200): [`SessionUserInfoResponse`](#sessionuserinforesponse)

#### Cookies

- Set `token` - JWT token (httponly, secure, samesite configuration from env)
  - Expires: matches JWT expiration from token payload
  - Note: This refreshes/extends the cookie on each session check

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/auths.py:106`
  - Method: `get_session_user()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token in Authorization header)
- _OWUI Implementation Notes:_
  - Decodes the JWT token from the Authorization header to get expiration time
  - Raises 401 if token is expired
  - Fetches user permissions from the database via `get_permissions()`
  - Returns extended user info including bio, gender, date_of_birth, and status fields

---

### POST `/api/v1/auths/signin`

Authenticate a user with email and password, returning a session token.

#### Inputs

Request Body: [`SigninForm`](#signinform)

#### Outputs

Response (200): [`SessionUserResponse`](#sessionuserresponse)

#### Cookies

- Set `token` - JWT token (httponly, secure, samesite configuration from env)
  - Expires: matches JWT expiration from `JWT_EXPIRES_IN` config

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/auths.py:555`
  - Method: `signin()`
- _Security:_
  - None (public endpoint)
- _OWUI Implementation Notes:_
  - Checks `ENABLE_PASSWORD_AUTH` config - raises 403 if disabled
  - Supports trusted header authentication (`WEBUI_AUTH_TRUSTED_EMAIL_HEADER`) - auto-creates users
  - Supports no-auth mode (`WEBUI_AUTH == False`) - creates admin@localhost with password "admin"
  - Rate limits signin attempts (5*3 attempts per 60*3 seconds window via Redis)
  - Passwords are truncated to 72 bytes for bcrypt compatibility
  - Calls `Auths.authenticate_user()` with bcrypt password verification
  - Generates JWT token with configurable expiration (`JWT_EXPIRES_IN`)
  - Returns user info with permissions

---

### POST `/api/v1/auths/signup`

Register a new user account. First user becomes admin, subsequent users get the default role.

#### Inputs

Request Body: [`SignupForm`](#signupform)

#### Outputs

Response (200): [`SessionUserResponse`](#sessionuserresponse)

#### Cookies

- Set `token` - JWT token (httponly, secure, samesite configuration from env)
  - Expires: matches JWT expiration from `JWT_EXPIRES_IN` config

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/auths.py:700`
  - Method: `signup()`
- _Security:_
  - None (public endpoint)
- _OWUI Implementation Notes:_
  - Checks if signup is enabled via `ENABLE_SIGNUP` and `ENABLE_LOGIN_FORM` config
  - If no users exist, first signup becomes admin (otherwise uses `DEFAULT_USER_ROLE`)
  - Validates email format with `validate_email_format()`
  - Checks if email is already taken
  - Validates password strength with `validate_password()`
  - Hashes password with bcrypt via `get_password_hash()`
  - Calls `Auths.insert_new_auth()` to create user
  - Generates JWT token
  - Sends webhook notification if `WEBHOOK_URL` is configured
  - Applies default group assignment via `apply_default_group_assignment()`
  - Disables signup after first user is created (if no users existed before)
  - Returns user info with token and permissions

---

### GET `/api/v1/auths/signout`

Sign out the current user by invalidating their token and clearing cookies.

#### Inputs

None

#### Outputs

Response (200): [`SignoutResponse`](#signoutresponse)

#### Cookies

- Delete `token` - Clears the JWT token cookie

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/auths.py:821`
  - Method: `signout()`
- _Security:_
  - None (accepts token from header or cookie)
- _OWUI Implementation Notes:_
  - Reads token from Authorization header OR `token` cookie
  - Calls `invalidate_token()` to blacklist the token
  - Deletes multiple cookies: `token`, `oui-session`, `oauth_id_token`, `oauth_session_id`
  - If OAuth session exists, fetches OpenID end_session_endpoint and returns redirect URL
  - If `WEBUI_AUTH_SIGNOUT_REDIRECT_URL` configured, returns redirect URL
  - Otherwise returns simple `{"status": true}` response

---

### POST `/api/v1/auths/update/profile`

Update the current user's profile information (name, bio, gender, date of birth, profile image).

#### Inputs

Request Body: [`UpdateProfileForm`](#updateprofileform)

#### Outputs

Response (200): [`UserProfileImageResponse`](#userprofileimageresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/auths.py:172`
  - Method: `update_profile()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
- _OWUI Implementation Notes:_
  - Uses `get_verified_user` dependency (requires verified/non-pending user)
  - Calls `Users.update_user_by_id()` with form data
  - Returns updated user profile (id, name, role, email, profile_image_url)
  - Raises 400 if update fails or user is invalid

---

### POST `/api/v1/auths/update/password`

Change the current user's password after verifying their current password.

#### Inputs

Request Body: [`UpdatePasswordForm`](#updatepasswordform)

#### Outputs

Response (200): `boolean` (true if successful)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/auths.py:223`
  - Method: `update_password()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
- _OWUI Implementation Notes:_
  - Blocked if `WEBUI_AUTH_TRUSTED_EMAIL_HEADER` is set (trusted auth mode)
  - Verifies current password with `Auths.authenticate_user()`
  - Validates new password strength with `validate_password()`
  - Hashes new password with bcrypt
  - Calls `Auths.update_user_password_by_id()`
  - Returns boolean indicating success
  - Raises 400 if current password is incorrect

---

### POST `/api/v1/auths/update/timezone`

Update the current user's timezone preference.

#### Inputs

Request Body: [`UpdateTimezoneForm`](#updatetimezoneform)

#### Outputs

Response (200): [`StatusResponse`](#statusresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/auths.py:201`
  - Method: `update_timezone()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
- _OWUI Implementation Notes:_
  - Simple endpoint that updates user's timezone field
  - Calls `Users.update_user_by_id()` with timezone
  - Returns `{"status": true}` on success
  - Raises 400 if user is invalid

---

### POST `/api/v1/auths/add`

**Admin Only:** Create a new user account without going through the signup flow.

#### Inputs

Request Body: [`AddUserForm`](#adduserform)

#### Outputs

Response (200): [`SigninResponse`](#signinresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/auths.py:907`
  - Method: `add_user()`
- _Security:_
  - Requires `HTTPBearer` authentication and admin role (via `get_admin_user` dependency)
  - Admin-only endpoint (uses `get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - Validates email format
  - Checks if email is already taken
  - Validates password strength
  - Hashes password with bcrypt
  - Creates user with specified role (or "pending" by default)
  - Applies default group assignment
  - Generates token for the new user (but doesn't set cookie)
  - Returns user info with token

---

### GET `/api/v1/auths/admin/details`

Get the admin's name and email for display purposes (e.g., support contact info).

#### Inputs

None

#### Outputs

Response (200): [`AdminDetailsResponse`](#admindetailsresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/auths.py:969`
  - Method: `get_admin_details()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
- _OWUI Implementation Notes:_
  - Checks `SHOW_ADMIN_DETAILS` config - raises 400 if disabled
  - If `ADMIN_EMAIL` is configured, looks up that user
  - Otherwise, falls back to first user in database (assumed to be admin)
  - Returns admin's name and email
  - Used by frontend to show "Contact Admin" information

---

### GET `/api/v1/auths/admin/config`

**Admin Only:** Get the current admin/auth configuration settings.

#### Inputs

None

#### Outputs

Response (200): [`AdminConfig`](#adminconfig) (all fields from request.app.state.config)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/auths.py:1002`
  - Method: `get_admin_config()`
- _Security:_
  - Requires `HTTPBearer` authentication and admin role (via `get_admin_user` dependency)
  - Admin-only endpoint
- _OWUI Implementation Notes:_
  - Returns 22 configuration fields from app.state.config:
    - `SHOW_ADMIN_DETAILS`, `ADMIN_EMAIL`, `WEBUI_URL`
    - `ENABLE_SIGNUP`, `ENABLE_API_KEYS`, API key restrictions
    - `DEFAULT_USER_ROLE`, `DEFAULT_GROUP_ID`, `JWT_EXPIRES_IN`
    - Feature flags: `ENABLE_COMMUNITY_SHARING`, `ENABLE_MESSAGE_RATING`, `ENABLE_FOLDERS`, `ENABLE_CHANNELS`, `ENABLE_MEMORIES`, `ENABLE_NOTES`, `ENABLE_USER_WEBHOOKS`, `ENABLE_USER_STATUS`
    - `FOLDER_MAX_FILE_COUNT`
    - Pending user overlay settings
    - `RESPONSE_WATERMARK`
  - These are runtime configuration values stored in app state

---

### POST `/api/v1/auths/admin/config`

**Admin Only:** Update the admin/auth configuration settings.

#### Inputs

Request Body: [`AdminConfig`](#adminconfig)

#### Outputs

Response (200): [`AdminConfig`](#adminconfig) (echoes back the updated configuration)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/auths.py:1055`
  - Method: `update_admin_config()`
- _Security:_
  - Requires `HTTPBearer` authentication and admin role (via `get_admin_user` dependency)
  - Admin-only endpoint
- _OWUI Implementation Notes:_
  - Updates all 22 configuration fields in app.state.config
  - Validates `DEFAULT_USER_ROLE` is one of: "pending", "user", "admin"
  - Validates `JWT_EXPIRES_IN` format with regex pattern: `^(-1|0|(-?\d+(\.\d+)?)(ms|s|m|h|d|w))$`
  - Converts `FOLDER_MAX_FILE_COUNT` to int if provided
  - All other fields are updated directly without validation
  - Returns the updated configuration
  - **Important:** These are runtime config changes, not persisted to disk

---

## Definitions

### `SigninForm`

Request body for signing in.

```json
{
  "type": "object",
  "required": ["email", "password"],
  "properties": {
    "email": {
      "type": "string",
      "title": "Email"
    },
    "password": {
      "type": "string",
      "title": "Password"
    }
  }
}
```

---

### `SignupForm`

Request body for signing up.

```json
{
  "type": "object",
  "required": ["name", "email", "password"],
  "properties": {
    "name": {
      "type": "string",
      "title": "Name"
    },
    "email": {
      "type": "string",
      "title": "Email"
    },
    "password": {
      "type": "string",
      "title": "Password"
    },
    "profile_image_url": {
      "type": "string",
      "title": "Profile Image Url",
      "default": "/user.png",
      "nullable": true
    }
  }
}
```

---

### `SessionUserResponse`

Response for signin/signup operations.

```json
{
  "type": "object",
  "required": ["id", "name", "role", "email", "profile_image_url", "token", "token_type"],
  "properties": {
    "id": {
      "type": "string",
      "title": "Id"
    },
    "name": {
      "type": "string",
      "title": "Name"
    },
    "role": {
      "type": "string",
      "title": "Role"
    },
    "email": {
      "type": "string",
      "title": "Email"
    },
    "profile_image_url": {
      "type": "string",
      "title": "Profile Image Url"
    },
    "token": {
      "type": "string",
      "title": "Token",
      "description": "JWT token for authentication"
    },
    "token_type": {
      "type": "string",
      "title": "Token Type",
      "description": "Always 'Bearer'"
    },
    "expires_at": {
      "type": "integer",
      "title": "Expires At",
      "description": "Unix timestamp when token expires",
      "nullable": true
    },
    "permissions": {
      "type": "object",
      "title": "Permissions",
      "additionalProperties": true,
      "nullable": true
    }
  }
}
```

---

### `SessionUserInfoResponse`

Extended response for get session user (includes status and profile fields).

```json
{
  "type": "object",
  "required": ["id", "name", "role", "email", "profile_image_url", "token", "token_type"],
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "role": {
      "type": "string"
    },
    "email": {
      "type": "string"
    },
    "profile_image_url": {
      "type": "string"
    },
    "token": {
      "type": "string",
      "description": "JWT token"
    },
    "token_type": {
      "type": "string",
      "description": "Always 'Bearer'"
    },
    "expires_at": {
      "type": "integer",
      "description": "Unix timestamp",
      "nullable": true
    },
    "permissions": {
      "type": "object",
      "additionalProperties": true,
      "nullable": true
    },
    "bio": {
      "type": "string",
      "nullable": true
    },
    "gender": {
      "type": "string",
      "nullable": true
    },
    "date_of_birth": {
      "type": "string",
      "format": "date",
      "nullable": true
    },
    "status_emoji": {
      "type": "string",
      "nullable": true
    },
    "status_message": {
      "type": "string",
      "nullable": true
    },
    "status_expires_at": {
      "type": "integer",
      "description": "Unix timestamp",
      "nullable": true
    }
  }
}
```

---

### `UpdateProfileForm`

Request body for updating user profile.

```json
{
  "type": "object",
  "required": ["profile_image_url", "name"],
  "properties": {
    "profile_image_url": {
      "type": "string",
      "title": "Profile Image Url"
    },
    "name": {
      "type": "string",
      "title": "Name"
    },
    "bio": {
      "type": "string",
      "nullable": true
    },
    "gender": {
      "type": "string",
      "nullable": true
    },
    "date_of_birth": {
      "type": "string",
      "format": "date",
      "nullable": true
    }
  }
}
```

---

### `UserProfileImageResponse`

Response for profile update.

```json
{
  "type": "object",
  "required": ["id", "name", "role", "email", "profile_image_url"],
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "role": {
      "type": "string"
    },
    "email": {
      "type": "string"
    },
    "profile_image_url": {
      "type": "string"
    }
  }
}
```

---

### `UpdatePasswordForm`

Request body for updating password.

```json
{
  "type": "object",
  "required": ["password", "new_password"],
  "properties": {
    "password": {
      "type": "string",
      "title": "Password",
      "description": "Current password"
    },
    "new_password": {
      "type": "string",
      "title": "New Password",
      "description": "New password to set"
    }
  }
}
```

---

### `UpdateTimezoneForm`

Request body for updating timezone.

```json
{
  "type": "object",
  "required": ["timezone"],
  "properties": {
    "timezone": {
      "type": "string",
      "title": "Timezone",
      "description": "IANA timezone string (e.g., 'America/New_York')"
    }
  }
}
```

---

### `AddUserForm`

Request body for admin adding a new user.

```json
{
  "type": "object",
  "required": ["name", "email", "password"],
  "properties": {
    "name": {
      "type": "string",
      "title": "Name"
    },
    "email": {
      "type": "string",
      "title": "Email"
    },
    "password": {
      "type": "string",
      "title": "Password"
    },
    "profile_image_url": {
      "type": "string",
      "title": "Profile Image Url",
      "default": "/user.png",
      "nullable": true
    },
    "role": {
      "type": "string",
      "title": "Role",
      "description": "User role: 'pending', 'user', or 'admin'",
      "default": "pending",
      "nullable": true
    }
  }
}
```

---

### `SigninResponse`

Response for admin add user operation (simpler than SessionUserResponse, no expiration or permissions).

```json
{
  "type": "object",
  "required": ["id", "name", "role", "email", "profile_image_url", "token", "token_type"],
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "role": {
      "type": "string"
    },
    "email": {
      "type": "string"
    },
    "profile_image_url": {
      "type": "string"
    },
    "token": {
      "type": "string",
      "description": "JWT token"
    },
    "token_type": {
      "type": "string",
      "description": "Always 'Bearer'"
    }
  }
}
```

---

### `AdminConfig`

Request/response body for admin configuration.

```json
{
  "type": "object",
  "required": [
    "SHOW_ADMIN_DETAILS",
    "WEBUI_URL",
    "ENABLE_SIGNUP",
    "ENABLE_API_KEYS",
    "ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS",
    "API_KEYS_ALLOWED_ENDPOINTS",
    "DEFAULT_USER_ROLE",
    "DEFAULT_GROUP_ID",
    "JWT_EXPIRES_IN",
    "ENABLE_COMMUNITY_SHARING",
    "ENABLE_MESSAGE_RATING",
    "ENABLE_FOLDERS",
    "ENABLE_CHANNELS",
    "ENABLE_MEMORIES",
    "ENABLE_NOTES",
    "ENABLE_USER_WEBHOOKS",
    "ENABLE_USER_STATUS"
  ],
  "properties": {
    "SHOW_ADMIN_DETAILS": {
      "type": "boolean",
      "description": "Whether to show admin contact details"
    },
    "ADMIN_EMAIL": {
      "type": "string",
      "nullable": true,
      "description": "Admin email for contact purposes"
    },
    "WEBUI_URL": {
      "type": "string",
      "description": "Base URL of the web UI"
    },
    "ENABLE_SIGNUP": {
      "type": "boolean",
      "description": "Allow new user signups"
    },
    "ENABLE_API_KEYS": {
      "type": "boolean",
      "description": "Enable API key generation"
    },
    "ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS": {
      "type": "boolean",
      "description": "Restrict API key access to specific endpoints"
    },
    "API_KEYS_ALLOWED_ENDPOINTS": {
      "type": "string",
      "description": "Comma-separated list of allowed endpoints for API keys"
    },
    "DEFAULT_USER_ROLE": {
      "type": "string",
      "description": "Default role for new users: 'pending', 'user', or 'admin'"
    },
    "DEFAULT_GROUP_ID": {
      "type": "string",
      "description": "Default group ID to assign new users"
    },
    "JWT_EXPIRES_IN": {
      "type": "string",
      "description": "JWT expiration duration (e.g., '7d', '24h', '-1' for no expiry)"
    },
    "ENABLE_COMMUNITY_SHARING": {
      "type": "boolean",
      "description": "Enable community sharing features"
    },
    "ENABLE_MESSAGE_RATING": {
      "type": "boolean",
      "description": "Enable message rating/feedback"
    },
    "ENABLE_FOLDERS": {
      "type": "boolean",
      "description": "Enable folder organization"
    },
    "FOLDER_MAX_FILE_COUNT": {
      "type": "integer",
      "nullable": true,
      "description": "Maximum files per folder"
    },
    "ENABLE_CHANNELS": {
      "type": "boolean",
      "description": "Enable channels feature"
    },
    "ENABLE_MEMORIES": {
      "type": "boolean",
      "description": "Enable memories/knowledge feature"
    },
    "ENABLE_NOTES": {
      "type": "boolean",
      "description": "Enable notes feature"
    },
    "ENABLE_USER_WEBHOOKS": {
      "type": "boolean",
      "description": "Enable user webhooks"
    },
    "ENABLE_USER_STATUS": {
      "type": "boolean",
      "description": "Enable user status (online/away/busy)"
    },
    "PENDING_USER_OVERLAY_TITLE": {
      "type": "string",
      "nullable": true,
      "description": "Title shown to pending users"
    },
    "PENDING_USER_OVERLAY_CONTENT": {
      "type": "string",
      "nullable": true,
      "description": "Message shown to pending users"
    },
    "RESPONSE_WATERMARK": {
      "type": "string",
      "nullable": true,
      "description": "Watermark text added to AI responses"
    }
  }
}
```

---

### `SignoutResponse`

Response for signout operation.

```json
{
  "type": "object",
  "required": ["status"],
  "properties": {
    "status": {
      "type": "boolean",
      "description": "Always true on successful signout"
    },
    "redirect_url": {
      "type": "string",
      "nullable": true,
      "description": "Redirect URL if OAuth or signout redirect is configured"
    }
  }
}
```

---

### `StatusResponse`

Simple success response.

```json
{
  "type": "object",
  "required": ["status"],
  "properties": {
    "status": {
      "type": "boolean",
      "description": "Always true on success"
    }
  }
}
```

---

### `AdminDetailsResponse`

Admin contact details for display purposes.

```json
{
  "type": "object",
  "required": ["name", "email"],
  "properties": {
    "name": {
      "type": "string",
      "description": "Admin's display name"
    },
    "email": {
      "type": "string",
      "description": "Admin's email address"
    }
  }
}
```
