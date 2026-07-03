//! API error responses: every error is a status code plus a
//! machine-readable code and human-readable message, as
//! `{"error": {"code": ..., "message": ...}}`.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use serde_json::json;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl ApiError {
    pub fn unauthorized(code: &'static str, message: impl Into<String>) -> Self {
        ApiError { status: StatusCode::UNAUTHORIZED, code, message: message.into() }
    }

    pub fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        ApiError { status: StatusCode::BAD_REQUEST, code, message: message.into() }
    }

    pub fn forbidden(code: &'static str, message: impl Into<String>) -> Self {
        ApiError { status: StatusCode::FORBIDDEN, code, message: message.into() }
    }

    pub fn not_found(code: &'static str, message: impl Into<String>) -> Self {
        ApiError { status: StatusCode::NOT_FOUND, code, message: message.into() }
    }

    pub fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        ApiError { status: StatusCode::CONFLICT, code, message: message.into() }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        ApiError { status: StatusCode::INTERNAL_SERVER_ERROR, code: "internal", message: message.into() }
    }
}

/// Database failures are never the client's fault: log the detail, return
/// an opaque 500.
impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(%error, "database error");
        ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "internal",
            message: "internal server error".to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(json!({ "error": { "code": self.code, "message": self.message } }));
        (self.status, body).into_response()
    }
}
