"""Concurrent teacher calls must serialize on one GPU.

Regression test: mlx-lm's Metal backend aborts the whole process
(SIGABRT, "A command encoder is already encoding to this command
buffer") if two generations encode concurrently — e.g. Extract
evidence still running when the user presses Generate synthesis.
MLXTeacherBackend.extract/repair hold _METAL_LOCK so only one MLX
call runs at a time, whatever thread or endpoint initiates it.
"""
import sys
import threading
import time
import types


class _FakeTokenizer:
    def apply_chat_template(self, messages, **kwargs):
        return "PROMPT"


def test_concurrent_teacher_calls_serialize(monkeypatch):
    state = {"active": 0, "max_active": 0}
    guard = threading.Lock()

    mlx_lm = types.ModuleType("mlx_lm")
    sample_utils = types.ModuleType("mlx_lm.sample_utils")

    def load(model_id):
        return object(), _FakeTokenizer()

    def generate(model, tokenizer, prompt, max_tokens=0, sampler=None):
        with guard:
            state["active"] += 1
            state["max_active"] = max(state["max_active"], state["active"])
            first = state["active"] == 1
        if first:
            # Hold the GPU long enough that any unlocked concurrent
            # caller would overlap (and would be counted).
            time.sleep(0.3)
        with guard:
            state["active"] -= 1
        return '{"ok": true}'

    def make_sampler(temp=0.0):
        return None

    mlx_lm.load = load
    mlx_lm.generate = generate
    sample_utils.make_sampler = make_sampler
    monkeypatch.setitem(sys.modules, "mlx_lm", mlx_lm)
    monkeypatch.setitem(sys.modules, "mlx_lm.sample_utils", sample_utils)

    from src.teacher.backend import MLXTeacherBackend
    teacher = MLXTeacherBackend()
    results = []
    results_lock = threading.Lock()

    def call():
        out = teacher.extract("hi")
        with results_lock:
            results.append(out)

    threads = [threading.Thread(target=call) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results == ['{"ok": true}'] * 4, (
        f"only {len(results)}/4 calls returned (a thread raised)")
    assert state["max_active"] == 1, (
        f"MLX calls overlapped: max {state['max_active']} concurrent")

    # repair() takes the same lock.
    state["active"] = 0
    state["max_active"] = 0
    assert teacher.repair('{"bad"') == '{"ok": true}'
    assert state["max_active"] == 1
