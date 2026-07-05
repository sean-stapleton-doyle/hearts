//! Simple in-process per-IP rate limiting (fixed window), for the handful
//! of unauthenticated-or-cheap endpoints worth blunting brute force /
//! automated abuse on: session creation, login, register, and joining a
//! game by invite code. Sized for a single server instance — a restart
//! resets every window, and it doesn't coordinate across instances if the
//! deployment ever scales out. Both fine at this scale; reach for a shared
//! store (e.g. Redis) only if that changes.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::request::Parts;

use crate::error::ApiError;
use crate::state::AppState;

#[derive(Clone, Default)]
pub struct RateLimiter {
    windows: Arc<Mutex<HashMap<(&'static str, IpAddr), (u32, Instant)>>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Errors with 429 once `ip` has made more than `max` calls to `bucket`
    /// within the trailing `window`. The window resets (rather than
    /// sliding) once it elapses — an approximation, not an exact rate,
    /// which is fine for blunting brute force rather than precise
    /// throttling.
    pub fn check(
        &self,
        bucket: &'static str,
        ip: IpAddr,
        max: u32,
        window: Duration,
    ) -> Result<(), ApiError> {
        let mut windows = self.windows.lock().expect("rate limiter mutex poisoned");
        let now = Instant::now();
        let entry = windows.entry((bucket, ip)).or_insert((0, now));
        if now.duration_since(entry.1) > window {
            *entry = (0, now);
        }
        entry.0 += 1;
        if entry.0 > max {
            return Err(ApiError::too_many_requests(
                "rate_limited",
                "too many requests — try again shortly",
            ));
        }
        Ok(())
    }
}

/// The caller's IP, for rate limiting. Prefers the first hop of
/// `X-Forwarded-For` and falls back to the TCP peer address. Trusting a
/// client-suppliable header for this is only sound because the deployment
/// this server is designed for (see compose.yaml / Caddyfile) never
/// exposes it directly to the internet — only the reverse proxy, which
/// sets this header itself, can reach it. If that ever changes (server
/// exposed directly), this would need a trusted-proxy allowlist instead.
pub struct ClientIp(pub IpAddr);

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        if let Some(ip) = parts
            .headers
            .get("x-forwarded-for")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(',').next())
            .and_then(|first| first.trim().parse::<IpAddr>().ok())
        {
            return Ok(ClientIp(ip));
        }
        let ConnectInfo(addr) = ConnectInfo::<SocketAddr>::from_request_parts(parts, state)
            .await
            .map_err(|_| ApiError::internal("client address unavailable"))?;
        Ok(ClientIp(addr.ip()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_up_to_max_then_rejects() {
        let limiter = RateLimiter::new();
        let ip: IpAddr = "127.0.0.1".parse().unwrap();
        for _ in 0..5 {
            limiter.check("test", ip, 5, Duration::from_secs(60)).unwrap();
        }
        assert!(limiter.check("test", ip, 5, Duration::from_secs(60)).is_err());
    }

    #[test]
    fn buckets_and_ips_are_independent() {
        let limiter = RateLimiter::new();
        let a: IpAddr = "127.0.0.1".parse().unwrap();
        let b: IpAddr = "127.0.0.2".parse().unwrap();
        for _ in 0..3 {
            limiter.check("login", a, 3, Duration::from_secs(60)).unwrap();
        }
        assert!(limiter.check("login", a, 3, Duration::from_secs(60)).is_err());
        // A different IP, and a different bucket for the same IP, are
        // untouched by `a`'s "login" usage.
        limiter.check("login", b, 3, Duration::from_secs(60)).unwrap();
        limiter.check("join", a, 3, Duration::from_secs(60)).unwrap();
    }

    #[test]
    fn window_resets_after_it_elapses() {
        let limiter = RateLimiter::new();
        let ip: IpAddr = "127.0.0.1".parse().unwrap();
        limiter.check("test", ip, 1, Duration::from_millis(20)).unwrap();
        assert!(limiter.check("test", ip, 1, Duration::from_millis(20)).is_err());
        std::thread::sleep(Duration::from_millis(30));
        limiter.check("test", ip, 1, Duration::from_millis(20)).unwrap();
    }
}
