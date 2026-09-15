#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install pypdf pyyaml psutil pandas matplotlib
python -m pip install mlx mlx-lm
python scripts/check_environment.py
