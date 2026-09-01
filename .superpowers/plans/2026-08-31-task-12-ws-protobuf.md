# Task 12: Server — Port 10007 WebSocket + Protobuf

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert port 10007 from raw TCP protobuf to WebSocket + protobuf binary frames. Port 10008 stays untouched.

**Architecture:** Replace the TCP codec pipeline (LengthFieldBasedFrameDecoder → ProtobufDecoder → ProtobufEncoder) with a WebSocket pipeline (HttpServerCodec → HttpObjectAggregator → WebSocketServerProtocolHandler → ProtobufFrameHandler → ProtobufFrameOutHandler). Two new handler classes bridge between WebSocket frames and protobuf messages.

**Tech Stack:** Java 21, Netty (netty-all), Protobuf, Spring Boot

## Global Constraints

- Java 21 — pattern-matching `instanceof` available
- `netty-all` already in pom.xml — no dependency changes
- Port 10008 (`WebSocketServer.java`) must NOT be touched
- Protobuf classes at `org.jpstale.server.proto.base.MessageProto`
- `PacketRouterHandler` accepts `MessageProto.ClientMessage` — no changes needed
- `PlayerSession.send()` writes `MessageProto.ServerMessage` objects — outbound handler intercepts these

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `pt-game-server/.../network/ProtobufFrameHandler.java` | Inbound: BinaryWebSocketFrame → ClientMessage |
| Create | `pt-game-server/.../network/ProtobufFrameOutHandler.java` | Outbound: ServerMessage → BinaryWebSocketFrame |
| Modify | `pt-game-server/.../network/NettyServer.java` | Replace TCP pipeline with WebSocket pipeline |

Base path: `E:\JPsTale\jpstale-server\pt-game-server\src\main\java\org\jpstale\server\game\network\`

---

### Task 1: Create ProtobufFrameHandler.java (Inbound)

**Files:**
- Create: `ProtobufFrameHandler.java`

**Interfaces:**
- Consumes: `BinaryWebSocketFrame` from Netty pipeline
- Produces: `MessageProto.ClientMessage` fired to next handler

- [ ] **Step 1: Create the file**

```java
package org.jpstale.server.game.network;

import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.handler.codec.http.websocketx.BinaryWebSocketFrame;
import org.jpstale.server.proto.base.MessageProto;

public class ProtobufFrameHandler extends SimpleChannelInboundHandler<BinaryWebSocketFrame> {
    @Override
    protected void channelRead0(ChannelHandlerContext ctx, BinaryWebSocketFrame frame) throws Exception {
        MessageProto.ClientMessage msg = MessageProto.ClientMessage.parseFrom(frame.content());
        ctx.fireChannelRead(msg);
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        System.err.println("[WS-Proto] error: " + cause.getMessage());
        ctx.close();
    }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd E:\JPsTale\jpstale-server && mvn compile -pl pt-game-server -q`
Expected: BUILD SUCCESS

---

### Task 2: Create ProtobufFrameOutHandler.java (Outbound)

**Files:**
- Create: `ProtobufFrameOutHandler.java`

**Interfaces:**
- Consumes: `MessageProto.ServerMessage` from `PlayerSession.send()`
- Produces: `BinaryWebSocketFrame` written to channel

- [ ] **Step 1: Create the file**

```java
package org.jpstale.server.game.network;

import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelOutboundHandlerAdapter;
import io.netty.channel.ChannelPromise;
import io.netty.handler.codec.http.websocketx.BinaryWebSocketFrame;
import io.netty.buffer.Unpooled;
import org.jpstale.server.proto.base.MessageProto;

public class ProtobufFrameOutHandler extends ChannelOutboundHandlerAdapter {
    @Override
    public void write(ChannelHandlerContext ctx, Object msg, ChannelPromise promise) throws Exception {
        if (msg instanceof MessageProto.ServerMessage serverMsg) {
            byte[] bytes = serverMsg.toByteArray();
            ctx.write(new BinaryWebSocketFrame(Unpooled.wrappedBuffer(bytes)), promise);
        } else {
            ctx.write(msg, promise);
        }
    }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd E:\JPsTale\jpstale-server && mvn compile -pl pt-game-server -q`
Expected: BUILD SUCCESS

---

### Task 3: Modify NettyServer.java Pipeline

**Files:**
- Modify: `NettyServer.java` (lines 1-68)

**Interfaces:**
- Consumes: ProtobufFrameHandler, ProtobufFrameOutHandler from Tasks 1-2
- Produces: Updated pipeline for port 10007

- [ ] **Step 1: Replace imports and pipeline**

Remove imports:
```java
import io.netty.handler.codec.LengthFieldBasedFrameDecoder;
import org.jpstale.server.common.network.codec.ProtobufDecoder;
import org.jpstale.server.common.network.codec.ProtobufEncoder;
```

Add imports:
```java
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpServerCodec;
import io.netty.handler.codec.http.websocketx.WebSocketServerProtocolHandler;
```

Replace `initChannel` body:
```java
ch.pipeline()
    .addLast(new IdleStateHandler(60, 0, 0, TimeUnit.SECONDS))
    .addLast(serverHeartbeatHandler)
    .addLast(new HttpServerCodec())
    .addLast(new HttpObjectAggregator(64 * 1024))
    .addLast(new WebSocketServerProtocolHandler("/ws"))
    .addLast(new ProtobufFrameHandler())
    .addLast(new ProtobufFrameOutHandler())
    .addLast(packetRouterHandler);
```

- [ ] **Step 2: Verify full build**

Run: `cd E:\JPsTale\jpstale-server && mvn compile -pl pt-game-server -q`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
cd E:\JPsTale\jpstale-server
git add pt-game-server/src/main/java/org/jpstale/server/game/network/
git commit -m "feat: convert port 10007 from TCP to WebSocket+protobuf"
```

---

### Task 4: Write Report

- [ ] **Step 1: Create report**

Write to `E:\JPsTale\jpstale-web\.superpowers\task-12-report.md`:
- Status: COMPLETE
- Files changed: 3 (2 created, 1 modified)
- Build: SUCCESS
- Commit: (hash from step 3)
- Pipeline before: TCP LengthFieldBasedFrameDecoder → ProtobufDecoder → ProtobufEncoder
- Pipeline after: WebSocket HttpServerCodec → HttpObjectAggregator → WebSocketServerProtocolHandler → ProtobufFrameHandler → ProtobufFrameOutHandler
- Port 10008: untouched
