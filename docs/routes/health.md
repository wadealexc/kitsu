# Health API Specification

## Endpoints

**Context:** Health check endpoints for monitoring, load balancers, and container orchestration.

These endpoints provide health status for the application and database connectivity. Essential for production deployments with load balancers, Kubernetes health probes, and monitoring systems.

---

### GET `/health`

Basic health check that verifies the API server is running.

#### Inputs

None

#### Outputs

Response (200): [`HealthStatus`](#healthstatus)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/main.py:2376`
  - Method: `healthcheck()`
- _Security:_
  - Public endpoint - no authentication required
- _OWUI Implementation Notes:_
  - Lightweight check with no external dependencies
  - Simply returns success if API server is responding
  - No database queries or external service checks
  - Suitable for basic liveness probes

---

### GET `/health/db`

Health check that includes database connectivity verification.

#### Inputs

None

#### Outputs

Response (200): [`HealthStatus`](#healthstatus)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/main.py:2381`
  - Method: `healthcheck_with_db()`
- _Security:_
  - Public endpoint - no authentication required
- _OWUI Implementation Notes:_
  - Verifies both API server and database connectivity
  - Executes `SELECT 1` query to test database connection
  - Uses ScopedSession from SQLAlchemy
  - Returns success only if database query completes
  - Suitable for readiness probes in container orchestration
  - Will raise exception/return error if database is unavailable

---

## Definitions

### `HealthStatus`

Health check response format.

```typescript
{
    status: boolean;  // Always true on success
}
```

**Fields:**
- `status` - Health check result (true = healthy)

**Example:**
```json
{
    "status": true
}
```

**Error behavior:**
- `/health`: Returns 200 with `{"status": true}` if server is running
- `/health/db`: Returns 200 with `{"status": true}` if database is accessible
- `/health/db`: Returns 5xx error if database connection fails

---

## Use Cases

### Load Balancer Health Checks
- Use `/health` for quick availability checks
- Traffic routing decisions based on response

### Kubernetes Liveness Probe
- Use `/health` to verify container is alive
- Restart container if health check fails
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
```

### Kubernetes Readiness Probe
- Use `/health/db` to verify application is ready to serve traffic
- Ensures database connectivity before routing requests
```yaml
readinessProbe:
  httpGet:
    path: /health/db
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
```

### Monitoring Systems
- Poll `/health/db` periodically for uptime monitoring
- Alert on failures or increased response times
- Track database connectivity issues

---

## Implementation Details

### Database Health Check Query
- **Query:** `SELECT 1;`
- **Purpose:** Minimal query to verify database connectivity
- **Session:** Uses ScopedSession from SQLAlchemy
- **Error handling:** Exceptions propagate to HTTP 5xx responses

### Response Times
- `/health`: < 1ms (no external dependencies)
- `/health/db`: Depends on database latency (typically < 50ms)

### Recommended Timeouts
- Load balancer health checks: 2-5 seconds
- Kubernetes liveness probe: 10 seconds
- Kubernetes readiness probe: 5 seconds
- Monitoring systems: 10 seconds
