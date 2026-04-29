#!/usr/bin/env python3
import argparse
import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Start BFF server with selected persistence store."
    )
    parser.add_argument(
        "--store",
        choices=["sqlite", "json"],
        default="sqlite",
        help="Persistence backend. Default: sqlite",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=3001,
        help="BFF port. Default: 3001",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    bff_dir = root / "bff"
    if not bff_dir.exists():
        print(f"Missing bff directory: {bff_dir}", file=sys.stderr)
        return 1

    env = os.environ.copy()
    env["BOT_STORE"] = args.store
    env["PORT"] = str(args.port)

    print(f"Starting BFF with BOT_STORE={args.store}, PORT={args.port}")
    print("SQLite mode auto-creates and auto-migrates state on first run.")

    npm_executable = "npm.cmd" if os.name == "nt" else "npm"

    try:
        completed = subprocess.run(
            [npm_executable, "run", "dev"],
            cwd=str(bff_dir),
            env=env,
            check=False,
        )
        return int(completed.returncode)
    except FileNotFoundError:
        print("npm not found in PATH. Please install Node.js/npm first.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
