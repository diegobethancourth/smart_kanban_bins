"""Validate an EPCIS document against the official GS1 EPCIS 2.0 JSON schema (T3.7).

Usage:
    python tools/validate_epcis.py [document.json] [schema.json]

document defaults to docs/epcis_example.json. The schema is the official one from
https://github.com/gs1/EPCIS (EPCIS-JSON-Schema.json); if no path is given it is
downloaded from https://gs1.github.io/EPCIS/EPCIS-JSON-Schema.json.
Needs: pip install jsonschema
"""

import json
import sys
import urllib.request
from pathlib import Path

from jsonschema import Draft7Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_URL = "https://gs1.github.io/EPCIS/EPCIS-JSON-Schema.json"


def main():
    doc_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "epcis_example.json"
    if len(sys.argv) > 2:
        schema = json.loads(Path(sys.argv[2]).read_text())
    else:
        with urllib.request.urlopen(SCHEMA_URL) as r:
            schema = json.load(r)
    doc = json.loads(doc_path.read_text())
    errors = sorted(Draft7Validator(schema, format_checker=FormatChecker()).iter_errors(doc),
                    key=lambda e: list(e.path))
    for e in errors:
        print("ERROR", "/".join(map(str, e.path)), e.message)
    if errors:
        sys.exit(1)
    print(f"{doc_path.name} is valid EPCIS 2.0")


if __name__ == "__main__":
    main()
