# Configuration Routes

## Endpoints

**Context:** Core configuration management - import/export system configs and admin announcements.

These endpoints handle system-wide configuration management and admin announcements (banners). The config is stored as a single JSON object in the database that can be exported/imported for backup or migration. Banners are admin announcements displayed to all users in the UI.

---

### GET `/api/v1/configs/export`

**Admin Only:** Export the entire system configuration as a JSON object. Used for backup or migration to another instance.

#### Inputs

None

#### Outputs

Response (200): `object` (generic JSON object containing all system configuration)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/configs.py:57`
  - Method: `export_config()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - Calls `get_config()` which fetches the latest config entry from the database
  - Returns `DEFAULT_CONFIG` (`{ version: 0, ui: {} }`) if no config exists in database
  - Config stored in `config` table with columns: `id`, `data` (JSON), `version`, `created_at`, `updated_at`

---

### POST `/api/v1/configs/import`

**Admin Only:** Import a system configuration JSON object. Replaces the current configuration with the provided one. Used for restoring from backup or migrating from another instance.

#### Inputs

Request Body: [`ImportConfigForm`](#importconfigform)

#### Outputs

Response (200): `object` (the imported configuration, returned to confirm what was saved)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/configs.py:46`
  - Method: `import_config()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - Calls `save_config(form_data.config)` which saves to database
  - Updates global `CONFIG_DATA` variable
  - Triggers updates on all registered `PersistentConfig` entries
  - Returns the saved config via `get_config()`
  - If save fails (exception), returns `false` but endpoint still returns 200

---

### GET `/api/v1/configs/banners`

Get the list of admin announcement banners. Banners are displayed to all users in the UI for important announcements (maintenance, new features, warnings, etc.).

#### Inputs

None

#### Outputs

Response (200): [`BannerModel[]`](#bannermodel)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/configs.py:535`
  - Method: `get_banners()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - Returns `request.app.state.config.BANNERS`
  - Banners are stored in app state, not in the main config database table
  - Can be initialized from `WEBUI_BANNERS` environment variable (JSON array)

---

### POST `/api/v1/configs/banners`

**Admin Only:** Set the list of admin announcement banners. Replaces the current banner list with the provided one.

#### Inputs

Request Body: [`SetBannersForm`](#setbannersform)

#### Outputs

Response (200): [`BannerModel[]`](#bannermodel)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/configs.py:524`
  - Method: `set_banners()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - Extracts `banners` array from form data via `form_data.model_dump()`
  - Sets `request.app.state.config.BANNERS` (app state, not database)
  - Returns the updated banner list
  - Banners are NOT persisted to database - stored only in app state (lost on restart unless set via env var)

---

## Definitions

### `ImportConfigForm`

```typescript
{
    config: object  // Generic JSON object containing system configuration
}
```

**Required fields:** `config`

**Notes:** The config object structure is not strictly defined in the schema - it's a flexible object that can contain any configuration keys/values.

---

### `BannerModel`

```typescript
{
    id: string           // Unique banner identifier
    type: string         // Banner type (e.g., "info", "warning", "error", "success")
    title?: string       // Optional banner title
    content: string      // Banner message content (supports markdown)
    dismissible: boolean // Whether users can dismiss/hide this banner
    timestamp: number    // Unix timestamp (seconds) when banner was created
}
```

**Required fields:** `id`, `type`, `content`, `dismissible`, `timestamp`

**Optional fields:** `title`

**Notes:**
- `type` is used by frontend to determine banner styling/color
- `dismissible` determines if users see a close button
- `timestamp` can be used to display "posted X hours ago" or auto-expire old banners

---

### `SetBannersForm`

```typescript
{
    banners: BannerModel[]  // Array of banner objects
}
```

**Required fields:** `banners`

**Notes:** Completely replaces the existing banner list with the provided array.
