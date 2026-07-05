//! Maps the core `GameError` onto a Python exception.
//!
//! Every rule the engine refuses (spec §9) surfaces in Python as a
//! `pyhearts.GameError`, carrying the core `Display` message. Fallible
//! wrapper methods convert via [`to_pyerr`].

use pyo3::create_exception;
use pyo3::exceptions::PyException;
use pyo3::PyErr;

use hearts_core::GameError as CoreGameError;

create_exception!(
    pyhearts,
    GameError,
    PyException,
    "Raised when the engine refuses an action (invalid seat, forbidden bid, must follow suit, ...)."
);

/// Convert a core `GameError` into the Python `GameError` exception.
pub fn to_pyerr(err: CoreGameError) -> PyErr {
    GameError::new_err(err.to_string())
}
