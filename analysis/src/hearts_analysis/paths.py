"""Output-path validation for the experiment CLIs."""

from __future__ import annotations

import os
from pathlib import Path


def safe_out_dir(path: str | os.PathLike[str]) -> Path:
    """Resolve an ``--out`` directory, refusing one outside the working
    directory.

    The experiment CLIs are run by people and by coding agents, so a
    mistyped or injected ``--out`` (``../..``, an absolute path elsewhere,
    a symlink that points out) must not let a run write files anywhere on
    disk. Every documented invocation writes under ``data/`` from
    ``analysis/``, which this allows. Call it straight after argument
    parsing, so a bad path fails before the experiment runs, not after.

    Returns the canonical path; raises ``ValueError`` if it escapes.
    """
    resolved = os.path.realpath(path)
    base_dir = os.path.realpath(os.getcwd())
    if resolved != base_dir and not resolved.startswith(base_dir + os.sep):
        raise ValueError(
            f"--out {os.fspath(path)!r} resolves to {resolved}, "
            f"outside the working directory {base_dir}"
        )
    return Path(resolved)
