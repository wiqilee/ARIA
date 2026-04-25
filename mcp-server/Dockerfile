# ── Stage 1: Build ──────────────────────────────────────────
FROM rust:1.86-slim AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Cargo.toml Cargo.lock* ./
COPY src/ src/

RUN cargo build --release

# Sanity check binary exists
RUN ls -la /app/target/release/aria-mcp-server

# ── Stage 2: Runtime ────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/aria-mcp-server .

ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080

CMD ["./aria-mcp-server"]
