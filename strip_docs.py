# Helper script to clean up the html in the p5 reference docs

import json
import html

with open('p5-ref.json', encoding='utf8') as f:
    full = json.load(f)

slim = {}

for k, v in full.items():
    desc = v.get('description', '')
    desc = html.unescape(
        desc.replace('<p>', ' ')
            .replace('</p>', ' ')
            .replace('<code>', '`')
            .replace('</code>', '`')
    )
    slim[k] = {
        "description": " ".join(desc.split()),
        "params": v.get("params", []),
        "return": v.get("return", {})
    }

with open('p5-ref-slim.json', 'w', encoding='utf8') as f:
    json.dump(slim, f, separators=(',', ':'))
