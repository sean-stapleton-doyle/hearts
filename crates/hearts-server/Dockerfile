# Build context is the repo root (the workspace root Cargo.toml/Cargo.lock
# and every crate must be visible) — see deploy/compose.yaml's
# `build.context: ..` / `build.dockerfile`.

FROM rust:1-slim AS builder
WORKDIR /app

# The workspace manifest lists every crate as a member, so all of them need
# to be present to resolve — even though `-p hearts-server` only compiles
# hearts-server and its actual dependency (hearts-core). No system deps
# needed: sqlx uses tls-rustls (pure Rust) and argon2/sha2/rand are pure
# Rust too.
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN cargo build --release -p hearts-server

# `sqlx::migrate!()` (crates/hearts-server/src/main.rs) embeds the
# migrations directory into the binary at compile time, so the runtime
# image needs nothing from crates/hearts-server/migrations at all.
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --shell /usr/sbin/nologin hearts
COPY --from=builder /app/target/release/hearts-server /usr/local/bin/hearts-server
# main.rs creates `logs/` relative to CWD (tracing_appender::rolling) —
# needs an actual writable working directory, not the default `/`, which
# `hearts` (non-root) can't write to. Own it before dropping to that user.
WORKDIR /app
RUN chown hearts:hearts /app
USER hearts
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/hearts-server"]
