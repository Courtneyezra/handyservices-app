"""
Apply sku-pricing-audit-v1.csv changes to sku-catalog-v3.json → sku-catalog-v4.json
Verdicts: RAISE and LOWER → update price. HOLD and FLAG → keep existing price.
"""
import json, csv, copy, sys
from pathlib import Path

BASE = Path(__file__).parent / "data"
V3   = BASE / "sku-catalog-v3.json"
AUDIT = BASE / "sku-pricing-audit-v1.csv"
V4   = BASE / "sku-catalog-v4.json"

# ── load catalog ────────────────────────────────────────────────────────────
catalog = json.loads(V3.read_text())
by_code = {s["sku_code"]: s for s in catalog}

# ── load audit ──────────────────────────────────────────────────────────────
changes: dict[str, dict] = {}   # sku_code (or sku_code:Tier) → row
with open(AUDIT, newline="") as f:
    for row in csv.DictReader(f):
        changes[row["sku_code"]] = row

# ── apply ───────────────────────────────────────────────────────────────────
tier_label_index = {"Small": 0, "Medium": 1, "Large": 2}
applied = skipped = unchanged = 0

for sku in catalog:
    code = sku["sku_code"]
    shape = sku["shape"]

    if shape == "tiered":
        for tier in sku.get("tiers") or []:
            key = f"{code}:{tier['label']}"
            row = changes.get(key)
            if row and row["verdict"] in ("RAISE", "LOWER"):
                new_p = round(float(row["new_price_gbp"]) * 100)
                old_p = tier["pricePence"]
                tier["pricePence"] = new_p
                print(f"  {key}: £{old_p//100} → £{new_p//100}  ({row['verdict']})")
                applied += 1
            elif row:
                unchanged += 1
            else:
                print(f"  WARN no audit row for {key}", file=sys.stderr)
                skipped += 1

    elif shape == "fixed":
        row = changes.get(code)
        if row and row["verdict"] in ("RAISE", "LOWER"):
            new_p = round(float(row["new_price_gbp"]) * 100)
            old_p = sku["price_pence"]
            sku["price_pence"] = new_p
            print(f"  {code}: £{old_p//100} → £{new_p//100}  ({row['verdict']})")
            applied += 1
        elif row:
            unchanged += 1
        else:
            print(f"  WARN no audit row for {code}", file=sys.stderr)
            skipped += 1

    elif shape == "per_unit":
        row = changes.get(code)
        if row and row["verdict"] in ("RAISE", "LOWER"):
            new_p = round(float(row["new_price_gbp"]) * 100)
            old_p = sku["price_per_unit_pence"]
            sku["price_per_unit_pence"] = new_p
            print(f"  {code}: £{old_p//100}/unit → £{new_p//100}/unit  ({row['verdict']})")
            applied += 1
        elif row:
            unchanged += 1
        else:
            print(f"  WARN no audit row for {code}", file=sys.stderr)
            skipped += 1

# ── write v4 ────────────────────────────────────────────────────────────────
V4.write_text(json.dumps(catalog, indent=2, ensure_ascii=False))

print()
print(f"✓  v4 written → {V4}")
print(f"   applied={applied}  held/flagged={unchanged}  missing={skipped}")
