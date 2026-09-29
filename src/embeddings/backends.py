"""Local embedding backends. Independent of the teacher LLM.

The transformer backend runs a small sentence-transformer locally
(CPU). The hash backend is a deterministic, dependency-free fallback
for tests and offline environments — clearly labeled, never silently
substituted in production paths.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = REPO_ROOT / "config" / "pipeline.yaml"

EMBEDDING_VERSION = "1.0"
DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

_WORD_RE = re.compile(r"[a-z0-9]+")


def load_embedding_config() -> dict:
    defaults = {"model": DEFAULT_MODEL, "version": EMBEDDING_VERSION}
    try:
        import yaml  # type: ignore
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        emb = cfg.get("embedding", {}) or {}
        return {"model": emb.get("model", defaults["model"]),
                "version": str(emb.get("version", defaults["version"]))}
    except Exception:
        return defaults


class EmbeddingBackend:
    """Interface: texts in, L2-normalized float32 matrix out."""

    name = "base"
    model_id = ""
    version = EMBEDDING_VERSION
    dim: int | None = None

    def encode(self, texts: list[str]):
        raise NotImplementedError


class HashEmbeddingBackend(EmbeddingBackend):
    """Deterministic hashed bag-of-words. For tests/offline only."""

    name = "hash"

    def __init__(self, dim: int = 256):
        cfg = load_embedding_config()
        self.model_id = "hash-bow-v1"
        self.version = cfg["version"]
        self.dim = dim

    def encode(self, texts: list[str]):
        mat = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, text in enumerate(texts):
            for word in _WORD_RE.findall(text.lower()):
                h = int(hashlib.sha256(word.encode()).hexdigest(), 16)
                mat[i, h % self.dim] += 1.0
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return mat / norms


class TransformerEmbeddingBackend(EmbeddingBackend):
    """all-MiniLM-L6-v2 via sentence-transformers, lazy-loaded on CPU."""

    name = "transformer"

    def __init__(self, model: str | None = None):
        cfg = load_embedding_config()
        self.model_id = model or cfg["model"]
        self.version = cfg["version"]
        self._model = None

    def _load(self):
        if self._model is not None:
            return
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as e:
            raise RuntimeError(f"sentence-transformers not installed: {e}")
        try:
            self._model = SentenceTransformer(self.model_id,
                                              device="cpu")
        except Exception as e:
            raise RuntimeError(
                f"could not load embedding model {self.model_id!r}: {e}")
        self.dim = self._model.get_sentence_embedding_dimension()

    def encode(self, texts: list[str]):
        self._load()
        vecs = self._model.encode(texts, normalize_embeddings=True,
                                  show_progress_bar=False)
        return np.asarray(vecs, dtype=np.float32)
