# Game Token Auth via Redis

## Context

Login currently happens on pt-game-server via WebSocket protobuf/JSON, duplicating password verification. The intended architecture: pt-web-server handles login + issues a game token stored in Redis, pt-game-server validates the token on WebSocket connect. Both servers already share PostgreSQL; Redis is the missing link.

## Design

### Flow

```
1. POST /api/game/login { account, password }  →  pt-web-server
2. pt-web-server validates → generates UUID token → writes to Redis:
      key:   pt:user:{token}
      value: { accountId: 123, accountName: "test" }
      TTL:   86400 (24h)
3. Returns { token, servers: [{ id, name, ip, port }] }
4. Browser opens WS: ws://ip:port/ws?token=xxx  →  pt-game-server
5. pt-game-server reads pt:user:{token} from Redis → sets accountId on session
6. No more login handshake over WebSocket
```

### Server List

Hardcoded in pt-web-server config for now:
```yaml
pt:
  game:
    servers:
      - id: 1
        name: Local Game Server
        host: ${PT_GAME_HOST:192.168.31.10}
        port: ${PT_GAME_PORT:10007}
```

---

## Tasks

### 1. pt-game-server: Add Redis dependency + config

**Files:**
- `pt-game-server/pom.xml` — add `spring-boot-starter-data-redis`
- `pt-game-server/src/main/resources/application.yml` — add `spring.redis.*` (same pattern as web-server)

### 2. pt-game-server: TokenService — validate token via Redis

**New file:** `pt-game-server/.../service/GameTokenService.java`
- `@Service` with `StringRedisTemplate`
- `GameToken validate(String token)` — reads `pt:user:{token}` from Redis, parses JSON, deletes key (one-time use), returns `GameToken { accountId, accountName }` or null
- Use `StringRedisTemplate` directly, no extra abstraction

### 3. pt-game-server: TokenAuthHandler — extract token from WS URL

**New file:** `pt-game-server/.../network/TokenAuthHandler.java`
- Extends `ChannelInboundHandlerAdapter`
- On `channelActive`: parse query string from `FullHttpRequest` (`?token=xxx`), call `GameTokenService.validate()`, store result in channel attributes
- If token invalid: close channel with 403
- Placed in pipeline **before** `WebSocketServerProtocolHandler`

### 4. pt-game-server: Update NettyServer pipeline

**File:** `pt-game-server/.../network/NettyServer.java`
- Add `TokenAuthHandler` before `WebSocketServerProtocolHandler`
- Autowire `TokenAuthHandler`

### 5. pt-game-server: Update PacketRouterHandler.channelActive

**File:** `pt-game-server/.../network/PacketRouterHandler.java`
- On `channelActive`: read `GameToken` from channel attributes
- If present: set `session.setAccountId()` and `session.setState(LOGGED_IN)` directly
- Skip the old protobuf login flow for token-authed connections

### 6. pt-game-server: Clean up AccountService.handleLogin

**File:** `pt-game-server/.../service/AccountService.java`
- `handleLogin` still exists for legacy/debug but token-authed sessions skip it
- `sendServerList` can be removed (server list now comes from web-server)

### 7. pt-web-server: GameLoginController — issue game token

**New file:** `pt-web-server/.../controller/GameLoginController.java`
- `POST /api/game/login` — validates credentials via `LoginService`, generates UUID token, stores in Redis via `StringRedisTemplate`, returns `{ token, servers: [...] }`
- Server list from `@Value` config
- No `@SaCheckLogin` — this is the entry point

### 8. pt-web-server: Add game server config

**File:** `pt-web-server/src/main/resources/application.yml`
- Add `pt.game.servers` list with id/name/host/port

### 9. jpstale-web: Update frontend auth flow

**Files:**
- `src/main.ts` — login becomes HTTP POST to `/api/game/login`, then connect WS with token
- `src/net/transport.ts` — `connect()` accepts token, appends `?token=xxx` to WS URL
- Remove `send(loginRequest(...))` from login flow
- Remove `onMessage` handler for `loginResponse` (no longer sent over WS)
- Server list + character list still come over WS as JSON (game-server still sends them)

### 10. Build & deploy

- `mvn package` both servers
- Deploy to remote, restart
- Test full flow: HTTP login → server list → WS connect → char select → enter game

---

## Verification

1. `mvn compile` passes for both servers
2. HTTP `POST /api/game/login` returns `{ token, servers }` 
3. Redis key `pt:user:{token}` exists after login
4. WS `ws://host:10007/ws?token=xxx` connects and session is authenticated
5. WS without token or with expired token → connection rejected
6. Character list, character creation, character selection, enter game all work
7. `npm run build` passes for jpstale-web
8. Full browser flow works: login → server select → char select → play
