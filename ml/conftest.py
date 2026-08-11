"""Put `ml/` on the import path so tests import modules the same way scripts do."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
