"""Teacher model backends. Local-only; lazy-loaded on demand.

The default backend runs Qwen3-1.7B-MLX-8bit via mlx-lm (Apple Silicon),
one chunk at a time. No cloud calls, no paper content leaves the machine.
"""
from __future__ import annotations

import threading
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = REPO_ROOT / "config" / "pipeline.yaml"

# One GPU, one encoder. mlx-lm's Metal backend cannot encode two
# generations at once: overlapping calls (e.g. Extract evidence still
# running when Generate synthesis is pressed) hit the driver assertion
# "A command encoder is already encoding to this command buffer" and
# the OS aborts the whole process (SIGABRT, no Python traceback).
# MLX runs are therefore serialized process-wide, regardless of which
# endpoint or thread initiates them.
_METAL_LOCK = threading.Lock()


class ModelUnavailable(Exception):
    """Raised when the local teacher model cannot run."""


def load_teacher_config() -> dict:
    defaults = {"model": "Qwen/Qwen3-1.7B-MLX-8bit",
                "max_tokens": 2500, "temperature": 0.0}
    try:
        import yaml  # type: ignore
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        teacher = cfg.get("teacher", {}) or {}
        return {"model": teacher.get("model", defaults["model"]),
                "max_tokens": int(teacher.get("max_tokens",
                                              defaults["max_tokens"])),
                "temperature": float(teacher.get("temperature",
                                                 defaults["temperature"]))}
    except Exception:
        return defaults


class TeacherBackend:
    """Interface: prompt string in, raw model string out.

    `system` optionally replaces the default extraction system message so
    other callers (the contextual tutor) get instruction-appropriate chat
    framing; omitting it preserves extraction behavior exactly.
    """

    name = "base"
    DEFAULT_SYSTEM = ("You extract structured evidence and return JSON"
                      " only. No prose, no commentary.")

    def extract(self, prompt: str, system: str | None = None) -> str:
        raise NotImplementedError


class MLXTeacherBackend(TeacherBackend):
    """Qwen3-1.7B-MLX-8bit via mlx-lm. Loaded lazily, kept for reuse."""

    name = "mlx"

    def __init__(self, model: str | None = None, max_tokens: int | None = None,
                 temperature: float | None = None,
                 enable_thinking: bool = False):
        cfg = load_teacher_config()
        self.model_id = model or cfg["model"]
        self.max_tokens = max_tokens or cfg["max_tokens"]
        self.temperature = temperature if temperature is not None \
            else cfg["temperature"]
        self.enable_thinking = enable_thinking
        self._model = None
        self._tokenizer = None

    def _load(self):
        if self._model is not None:
            return
        try:
            from mlx_lm import load
        except ImportError as e:
            raise ModelUnavailable(
                f"mlx-lm not installed in this environment: {e}")
        try:
            self._model, self._tokenizer = load(self.model_id)
        except Exception as e:
            raise ModelUnavailable(
                f"could not load teacher model {self.model_id!r}: {e}")

    def extract(self, prompt: str, system: str | None = None) -> str:
        # Serialize all GPU work; see _METAL_LOCK.
        with _METAL_LOCK:
            return self._extract_locked(prompt, system)

    def _extract_locked(self, prompt: str, system: str | None = None) -> str:
        self._load()
        try:
            from mlx_lm import generate
            from mlx_lm.sample_utils import make_sampler
        except ImportError as e:
            raise ModelUnavailable(f"mlx-lm not installed: {e}")
        # Qwen3 needs its chat template for instruction following; raw
        # completion just continues the chunk prose. enable_thinking=False
        # keeps the model from spending its token budget on <think>
        # reasoning traces instead of the JSON payload (Qwen3 template
        # renders an immediately-closed think block).
        try:
            kwargs = {}
            try:
                prompt_str = self._tokenizer.apply_chat_template(
                    [{"role": "system",
                      "content": system or self.DEFAULT_SYSTEM},
                     {"role": "user", "content": prompt}],
                    tokenize=False, add_generation_prompt=True,
                    enable_thinking=self.enable_thinking)
            except TypeError:
                prompt_str = self._tokenizer.apply_chat_template(
                    [{"role": "system",
                      "content": system or self.DEFAULT_SYSTEM},
                     {"role": "user", "content": prompt}],
                    tokenize=False, add_generation_prompt=True)
        except Exception:
            prompt_str = prompt
        try:
            return generate(self._model, self._tokenizer, prompt_str,
                            max_tokens=self.max_tokens,
                            sampler=make_sampler(temp=self.temperature))
        except Exception as e:
            raise ModelUnavailable(f"teacher generation failed: {e}")

    def repair(self, previous_output: str,
               instruction: str | None = None,
               system: str | None = None) -> str:
        """One constrained retry for invalid output."""
        # Serialize all GPU work; see _METAL_LOCK.
        with _METAL_LOCK:
            return self._repair_locked(previous_output, instruction, system)

    def _repair_locked(self, previous_output: str,
                       instruction: str | None = None,
                       system: str | None = None) -> str:
        self._load()
        from mlx_lm import generate
        from mlx_lm.sample_utils import make_sampler
        if instruction is None:
            instruction = ("Your previous response was not valid JSON."
                           " Output ONLY the corrected JSON object, no"
                           " other text.")
        if system is None:
            system = "You output valid JSON only. No other text."
        try:
            prompt_str = self._tokenizer.apply_chat_template(
                [{"role": "system", "content": system},
                 {"role": "user",
                  "content": instruction + "\n\nPrevious response:\n"
                             + previous_output[:4000]}],
                tokenize=False, add_generation_prompt=True)
        except Exception:
            prompt_str = previous_output[:4000]
        try:
            return generate(self._model, self._tokenizer, prompt_str,
                            max_tokens=self.max_tokens,
                            sampler=make_sampler(temp=self.temperature))
        except Exception as e:
            raise ModelUnavailable(f"teacher repair failed: {e}")
