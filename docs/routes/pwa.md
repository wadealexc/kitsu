# PWA API Specification

## Endpoints

**Context:** Progressive Web App (PWA) support for installable web application.

This endpoint provides the PWA manifest required for making the application installable on mobile and desktop devices. The manifest defines how the app appears when installed, including name, icons, and display preferences.

---

### GET `/manifest.json`

Get the PWA manifest for application installation.

#### Inputs

None

#### Outputs

Response (200): [`PWAManifest`](#pwamanifest) - Standard PWA manifest JSON

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/main.py:2327`
  - Method: `get_manifest_json()`
- _Security:_
  - Public endpoint - no authentication required
- _OWUI Implementation Notes:_
  - **External manifest mode:** If `EXTERNAL_PWA_MANIFEST_URL` is configured, fetches and returns manifest from that URL
  - **Default mode:** Otherwise, generates default manifest with:
    - App name from `WEBUI_NAME` environment variable (default: "Open WebUI")
    - Generic description with app name interpolation
    - Standalone display mode for fullscreen PWA experience
    - Dark gray background (#343541)
    - Logo icon at `/static/logo.png` (500x500) with both "any" and "maskable" purposes
    - Share target for receiving shared text from other apps
  - Content-Type: `application/json`
  - Used by browsers to determine PWA installation eligibility

---

## Definitions

### `PWAManifest`

Progressive Web App manifest structure following the [W3C Web App Manifest specification](https://www.w3.org/TR/appmanifest/).

```typescript
{
    name: string;
    short_name: string;
    description: string;
    start_url: string;
    display: "standalone" | "fullscreen" | "minimal-ui" | "browser";
    background_color: string;
    icons: PWAIcon[];
    share_target?: PWAShareTarget;
}
```

**Fields:**
- `name` - Full application name (from `WEBUI_NAME`)
- `short_name` - Short name for home screen (same as `name`)
- `description` - Application description
- `start_url` - URL to load when app is launched (typically "/")
- `display` - Display mode when installed (default: "standalone")
- `background_color` - Background color during app launch (default: "#343541")
- `icons` - Array of app icons for various contexts
- `share_target` - Optional configuration for receiving shared content from other apps

**Default Example:**
```json
{
    "name": "Open WebUI",
    "short_name": "Open WebUI",
    "description": "Open WebUI is an open, extensible, user-friendly interface for AI that adapts to your workflow.",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#343541",
    "icons": [
        {
            "src": "/static/logo.png",
            "type": "image/png",
            "sizes": "500x500",
            "purpose": "any"
        },
        {
            "src": "/static/logo.png",
            "type": "image/png",
            "sizes": "500x500",
            "purpose": "maskable"
        }
    ],
    "share_target": {
        "action": "/",
        "method": "GET",
        "params": {
            "text": "shared"
        }
    }
}
```

---

### `PWAIcon`

Icon configuration for PWA installation.

```typescript
{
    src: string;      // Icon URL
    type: string;     // MIME type (e.g., "image/png")
    sizes: string;    // Icon dimensions (e.g., "500x500")
    purpose: string;  // Icon purpose: "any", "maskable", or "monochrome"
}
```

**Purpose values:**
- `any` - Default icon, can be used in any context
- `maskable` - Safe-area icon designed to work with platform-specific masks (rounded corners, circles, etc.)
- `monochrome` - Single-color icon for system UI

---

### `PWAShareTarget`

Configuration for receiving shared content from other applications.

```typescript
{
    action: string;           // URL to navigate to when receiving shared content
    method: "GET" | "POST";   // HTTP method for share action
    params: {                 // Query parameter mapping
        text?: string;        // Parameter name for shared text
        title?: string;       // Parameter name for shared title
        url?: string;         // Parameter name for shared URL
    };
}
```

**Example flow:**
1. User shares text from another app
2. System opens PWA with URL: `/?shared=<text>`
3. Application can read and process the shared content

---

## Configuration

### Environment Variables

**WEBUI_NAME**
- Type: string
- Default: "Open WebUI"
- Purpose: Application name used in PWA manifest
- Example: "My AI Assistant"

**EXTERNAL_PWA_MANIFEST_URL**
- Type: string (URL)
- Default: Not set
- Purpose: Optional URL to external PWA manifest for full customization
- Example: "https://cdn.example.com/custom-manifest.json"
- Note: If set, completely replaces default manifest generation

---

## PWA Installation Eligibility

For browsers to offer PWA installation, the application must meet these criteria:

1. **HTTPS Required:** Must be served over HTTPS (except localhost for development)
2. **Manifest Required:** Must have valid `/manifest.json` endpoint
3. **Service Worker:** Must register a service worker (frontend responsibility)
4. **Icons:** Manifest must include icons (at least 192x192 and 512x512 recommended)
5. **Display Mode:** Manifest must specify appropriate display mode
6. **Start URL:** Must define a start_url

This endpoint satisfies requirements #2, #4, #5, and #6.

---

## Browser Support

PWA manifest support:
- ✅ Chrome/Edge (Android & Desktop)
- ✅ Safari (iOS 11.3+, macOS Big Sur+)
- ✅ Firefox (Android)
- ⚠️ Firefox Desktop (limited PWA support)

Icon specifications by platform:
- **Android:** Prefers maskable icons with safe area
- **iOS:** Uses any-purpose icons, ignores maskable
- **Desktop:** Uses largest available icon

---

## Customization Options

### Option 1: Environment Variable
Set `WEBUI_NAME` to customize the app name:
```bash
WEBUI_NAME="My Custom AI App"
```

### Option 2: External Manifest
Host a custom manifest and point to it:
```bash
EXTERNAL_PWA_MANIFEST_URL="https://cdn.example.com/manifest.json"
```

This allows complete control over:
- Multiple icon sizes
- Theme colors
- Orientation preferences
- Advanced PWA features (shortcuts, screenshots, etc.)

---

## Related Files

- `/static/logo.png` - Default app icon (should be 500x500 or larger)
- Service worker registration (frontend code, typically in `index.html` or main JS)
