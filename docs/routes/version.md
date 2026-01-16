# Version API Specification

## Endpoints

**Context:** Version information and update checking for diagnostics and maintenance.

These endpoints provide application version information and check for available updates. Version info is sourced from package.json, and update checking queries the GitHub releases API.

---

### GET `/api/version`

Get current application version and deployment ID.

#### Inputs

None

#### Outputs

Response (200): [`VersionInfo`](#versioninfo)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/main.py:2068`
  - Method: `get_app_version()`
- _Security:_
  - Public endpoint - no authentication required
- _OWUI Implementation Notes:_
  - Returns `VERSION` from package.json
  - Returns `DEPLOYMENT_ID` from environment variable (empty string if not set)
  - Stateless endpoint - no database queries
  - Used for diagnostics, monitoring, and support

---

### GET `/api/version/updates`

Check for available updates by comparing current version with latest GitHub release.

#### Inputs

None

#### Outputs

Response (200): [`VersionUpdateInfo`](#versionupdateinfo)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/main.py:2076`
  - Method: `get_app_latest_release_version()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - **Feature flag:** Controlled by `ENABLE_VERSION_UPDATE_CHECK` environment variable (default: true)
  - **Offline mode:** Automatically disabled if `OFFLINE_MODE=true`
  - **GitHub API integration:**
    - Queries: `https://api.github.com/repos/open-webui/open-webui/releases/latest`
    - Uses aiohttp with 1-second timeout
    - Respects SSL configuration via `AIOHTTP_CLIENT_SESSION_SSL`
  - **Response format:** Returns both current and latest version
  - **Error handling:** If GitHub API fails or update check disabled, returns current version as both current and latest
  - **Version format:** Strips leading 'v' from GitHub tag (e.g., "v1.2.3" → "1.2.3")

---

## Definitions

### `VersionInfo`

Current application version information.

```typescript
{
    version: string;        // Current version from package.json
    deployment_id: string;  // Deployment identifier from env (may be empty)
}
```

**Fields:**
- `version` - Semantic version string (e.g., "0.3.9")
- `deployment_id` - Optional deployment identifier for tracking multiple instances

**Example:**
```json
{
    "version": "0.3.9",
    "deployment_id": "prod-us-east-1"
}
```

---

### `VersionUpdateInfo`

Version comparison for update checking.

```typescript
{
    current: string;  // Current installed version
    latest: string;   // Latest available version from GitHub
}
```

**Fields:**
- `current` - Currently running version
- `latest` - Latest release version from GitHub (or same as current if check disabled/failed)

**Example - Update available:**
```json
{
    "current": "0.3.8",
    "latest": "0.3.9"
}
```

**Example - Up to date:**
```json
{
    "current": "0.3.9",
    "latest": "0.3.9"
}
```

---

## Configuration

### Environment Variables

**ENABLE_VERSION_UPDATE_CHECK**
- Type: boolean (string "true" or "false")
- Default: "true"
- Purpose: Enable/disable GitHub update checking
- Note: Automatically set to false if OFFLINE_MODE is enabled

**OFFLINE_MODE**
- Type: boolean (string "true" or "false")
- Default: "false"
- Purpose: Disables all external network calls including update checks
- Side effect: Sets HF_HUB_OFFLINE=1 and disables version update checking

**DEPLOYMENT_ID**
- Type: string
- Default: "" (empty string)
- Purpose: Identifier for tracking specific deployment instances

---

## Version Source

Version information is sourced from:
- **File:** `/backend/package.json`
- **Field:** `version`
- **Fallback:** "0.0.0" if package.json not found
- **Format:** Semantic versioning (e.g., "0.3.9")

---

## Update Check Behavior

1. **Enabled:** `ENABLE_VERSION_UPDATE_CHECK=true` and not in offline mode
   - Queries GitHub releases API
   - 1-second timeout for responsiveness
   - Returns latest release version

2. **Disabled:** `ENABLE_VERSION_UPDATE_CHECK=false` or `OFFLINE_MODE=true`
   - Skips GitHub API call
   - Returns current version as both current and latest
   - Logged at debug level

3. **Error/Timeout:**
   - Falls back to current version for both fields
   - Error logged at debug level
   - Does not throw exceptions to client
