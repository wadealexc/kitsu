# Breaking Changes from OpenWebUI

This document tracks significant departures from OpenWebUI's API and behavior. These changes are intentional design decisions for our TypeScript backend.

---

## Authentication: Username-Based Instead of Email-Based

**Date:** 2026-01-22

**Change:** Authentication uses unique usernames instead of email addresses.

### What Changed

**Database Schema:**
- `auth.email` → `auth.username`
- `user.email` → `user.username`
- Username is unique, alphanumeric + underscore/dash, 3-50 characters

**API Endpoints:**
- `POST /api/v1/auths/signin` - Expects `{ username, password }` instead of `{ email, password }`
- `POST /api/v1/auths/signup` - Expects `{ username, name, password }` instead of `{ email, name, password }`
- `POST /api/v1/auths/add` - Admin user creation uses `username`
- All user response objects return `username` field instead of `email`

**Frontend Impact:**
- Signin/signup forms need username input instead of email input
- Remove email validation on client side
- Update user profile displays to show username
- Admin contact details show username instead of email

### Features NOT Supported

The following OpenWebUI features are **not supported** due to this change:

❌ **OAuth Authentication** - OAuth providers map accounts via email
❌ **LDAP Integration** - LDAP auth uses email as identity mapping
❌ **Trusted Header Auth** - Reverse proxy mode passes email in header (`WEBUI_AUTH_TRUSTED_EMAIL_HEADER`)
❌ **Email-based account lookup** - All user lookups use username

### Implementation Status

- [ ] Database schema updated
- [ ] Auth operations updated
- [ ] API endpoint types updated
- [ ] Frontend forms updated
- [ ] Documentation updated
- [ ] Tests updated

---

## Removed: auth.active Field

**Date:** 2026-01-22

**Change:** Removed the `auth.active` field from the authentication table.

### What Changed

**Database Schema:**
- Removed `auth.active` column (boolean field indicating account status)

**Operations:**
- No authentication checks for account active status
- Account suspension/banning handled via `user.role` instead

### Rationale

The `active` field in OpenWebUI is **vestigial/unused**:
- Always set to `true` during user creation
- Never modified by any endpoint or admin UI
- No UI exists to toggle this field
- OpenWebUI uses `user.role="pending"` for account approval instead
- Authentication checks it, but since it's always `true`, the check is dead code

For a local setup, account suspension can be handled by:
- Deleting the user account entirely
- Setting `user.role = "pending"` to disable access
- No need for a separate `active` flag

### Implementation Status

- [x] Documentation updated
- [ ] Database schema updated
- [ ] Auth operations updated (remove active checks if any)

---

## Simplified User Profile Fields

**Date:** 2026-01-22

**Change:** Removed numerous profile fields that are unnecessary for a small local deployment.

### What Changed

**Removed Fields:**
- `name` - Display name (use `username` for display instead)
- `bio`
- `gender`
- `date_of_birth`
- `timezone`
- `presence_state`
- `status_emoji`
- `status_message`
- `status_expires_at`
- `oauth`

**Kept Fields:**
- `username` - Primary identifier and display name
- `role` - User role (admin/user/pending)
- `profile_image_url` - Profile image
- `profile_banner_image_url` - Banner image
- `info` - Flexible JSON for custom metadata
- `settings` - UI preferences
- Timestamps (created_at, updated_at, last_active_at)

### Frontend Impact

- Display `username` instead of `name` everywhere
- Remove profile editing forms for bio, gender, DOB, timezone
- Remove custom status UI (emoji, message, expiration)
- Remove presence indicators (online/away badges)
- Simplify user profile pages

### API Changes

**Updated response types:**
```typescript
// Before (OpenWebUI)
{
  "id": "...",
  "name": "John Doe",
  "email": "john@example.com",
  "bio": "...",
  "gender": "...",
  "timezone": "America/New_York",
  "status_emoji": "🎉",
  "status_message": "Working from home",
  "presence_state": "online"
}

// After (llama-shim)
{
  "id": "...",
  "username": "johndoe",
  "role": "user",
  "profile_image_url": "/user.png",
  "profile_banner_image_url": null
}
```

### Implementation Status

- [x] Documentation updated
- [ ] Database schema updated
- [ ] API response types updated
- [ ] Frontend UI simplified

---

## Removed Features: Tags, Channels, Knowledge Bases, Annotations

**Date:** 2026-01-28

**Change:** Several organizational and content features from OpenWebUI are not implemented.

### What's Removed

#### Tags System
**Database:**
- No `tags` table
- No `meta.tags` array on chat records
- No tag relationships or junction tables

**API Endpoints:**
- No tag CRUD operations (`/api/v1/chats/tags/*`)
- No tag-based filtering endpoints
- Chat search syntax `tag:<name>` not supported

**Operations:**
- `addChatTag()` - Not implemented
- `deleteChatTag()` - Not implemented
- `getChatTags()` - Not implemented
- `getChatsByUserIdAndTag()` - Not implemented

#### Channels
**Database:**
- No `channels` table
- No `channel_file` junction table
- Files cannot be associated with channels

**API:**
- No channel endpoints
- File `meta.data.channelId` field not used
- File access control doesn't check channel membership

#### Knowledge Bases
**Database:**
- No `knowledge` table
- No `knowledge_file` junction table
- Files cannot be associated with knowledge bases

**API:**
- No knowledge base endpoints
- File access control doesn't check knowledge membership

#### Message Annotations/Ratings
**Database:**
- Messages don't have `annotation` field in chat JSON
- No rating/feedback storage

**API:**
- No message rating endpoints
- No annotation CRUD operations

### Frontend Impact

**UI Removals:**
- Tag picker/selector components
- Tag management interface
- Tag-based filters in chat list
- Channel file associations
- Knowledge base file browser
- Message rating buttons (thumbs up/down)
- Message annotation UI

**Search Changes:**
- Remove `tag:name` search syntax support
- Simplify search to title/content only with folder/pinned/archived filters

### Rationale

These features are designed for team/enterprise deployments with:
- Multiple users sharing knowledge bases
- Organizational channels for file sharing
- User feedback on AI responses

For a **3-user local deployment**, these features add unnecessary complexity:
- Folders provide sufficient chat organization
- File sharing happens through chat associations
- Simplifies both backend and frontend code

### Implementation Status

- [x] Database models specified without these features
- [x] Database schemas created without these tables
- [x] Documentation updated
- [ ] Mock endpoints removed (currently return empty arrays)
- [ ] Frontend UI simplified

---

## Simplified Chat Deletion (No Admin Override, No Permissions)

**Date:** 2026-01-29

**Change:** `DELETE /api/v1/chats/{id}` simplified to ownership-based deletion only.

### What Changed

**Removed behaviors:**
- Admin force-delete of other users' chats
- Permission check for `chat.delete`

**Current behavior:**
- Users can delete only their own chats (enforced by database query)
- Returns 404 if chat not found or not owned by user

### Rationale

Admin force-delete and permission checks add unnecessary complexity for a 3-user local deployment. Users should always be able to delete their own chats.

---

## Future Breaking Changes (Planned)

### Remove snake_case from API Responses

**Status:** Planned, not yet implemented

**Change:** Convert all API response fields from `snake_case` to `camelCase`.

**Example:**
```typescript
// Before (OpenWebUI)
{
  "profile_image_url": "/user.png",
  "last_active_at": 1234567890
}

// After (llama-shim - planned)
{
  "profileImageUrl": "/user.png",
  "lastActiveAt": 1234567890
}
```

**Impact:** Requires frontend updates to use camelCase property names.

---

### Replace Generic {id} Path Parameters

**Status:** Planned, not yet implemented

**Change:** Use specific parameter names like `{chatId}`, `{userId}` instead of generic `{id}`.

**Example:**
```typescript
// Before (OpenWebUI)
GET /api/v1/chats/{id}

// After (llama-shim - planned)
GET /api/v1/chats/{chatId}
```

**Impact:** Improves API clarity and self-documentation.

---

## Non-Breaking Notable Differences

These differences don't break compatibility but are worth noting:

### SSE Streaming Instead of Socket.IO

**Change:** Chat streaming uses Server-Sent Events (SSE) instead of Socket.IO.

**Why:** Simpler architecture, no bidirectional communication needed for basic chat.

**Compatibility:** Frontend adapted to support both Socket.IO and SSE paths. Original Socket.IO code preserved for potential future collaborative features.

**Details:** See `.claude/DESIGN.md` for full rationale.

---

## Maintaining This Document

When making breaking changes:

1. Add entry with date and clear description
2. Document what changed, why, and what features are affected
3. Include migration notes and frontend impact
4. Update implementation status checklist
5. Move to "Completed" section once fully implemented
