"""Score an agent run against the NTR evaluation set.

Usage: python score.py eval_set.csv run.json [run2.json ...]
run.json: {"label": "skill on", "results": [{"project_number": "36008", "ps5": true, "ps6": true,
           "ps7": false, "ps8": true, "category": "A"}, ...]}
Only projects with usable_for_eval == True are scored. Missing answers count as disagreement.
"""
import csv, json, sys

PS = ["ps5", "ps6", "ps7", "ps8"]

def load_truth(path):
    t = {}
    for r in csv.DictReader(open(path)):
        if r["usable_for_eval"] == "True":
            t[r["project_number"]] = {**{k: r[k] == "True" for k in PS}, "category": r["ifc_category"], "name": r["name"]}
    return t

def stats(pairs):
    tp = sum(1 for g, p in pairs if g and p is True)
    tn = sum(1 for g, p in pairs if not g and p is False)
    fp = sum(1 for g, p in pairs if not g and p is True)
    fn = sum(1 for g, p in pairs if g and p is not True)
    miss = sum(1 for g, p in pairs if p is None)
    n = len(pairs)
    po = (tp + tn) / n
    pg, pp = (tp + fn) / n, (tp + fp) / n
    pe = pg * pp + (1 - pg) * (1 - pp)
    kappa = (po - pe) / (1 - pe) if pe < 1 else float("nan")
    prec = tp / (tp + fp) if tp + fp else float("nan")
    rec = tp / (tp + fn) if tp + fn else float("nan")
    return dict(n=n, positives=tp + fn, agree=round(po, 2), precision=round(prec, 2), recall=round(rec, 2),
                kappa=round(kappa, 2), fp=fp, fn=fn, missing=miss)

def score(truth, run):
    res = {r["project_number"]: r for r in run["results"]}
    out = {"label": run.get("label", "run"), "per_ps": {}, "disagreements": []}
    for k in PS:
        pairs = [(truth[pid][k], res.get(pid, {}).get(k)) for pid in truth]
        out["per_ps"][k] = stats(pairs)
    cats = [(truth[pid]["category"], res.get(pid, {}).get("category")) for pid in truth]
    out["category_agree"] = round(sum(g == p for g, p in cats) / len(cats), 2)
    for pid, g in truth.items():
        r = res.get(pid, {})
        diff = [k.upper() + ("+" if r.get(k) else "-") for k in PS if r.get(k) != g[k]]
        if diff:
            out["disagreements"].append({"project_number": pid, "name": g["name"], "agent_vs_ifc": diff})
    return out

def report(o):
    print(f"\n== {o['label']} ==")
    print(f"{'PS':5}{'n':>4}{'pos':>5}{'agree':>7}{'prec':>7}{'recall':>8}{'kappa':>7}{'FP':>4}{'FN':>4}")
    for k, s in o["per_ps"].items():
        print(f"{k.upper():5}{s['n']:>4}{s['positives']:>5}{s['agree']:>7}{s['precision']:>7}{s['recall']:>8}{s['kappa']:>7}{s['fp']:>4}{s['fn']:>4}")
    print("Category agreement:", o["category_agree"], "(reported, not scored hard)")
    print(f"Projects with any PS disagreement: {len(o['disagreements'])}  (PS6+ = agent said yes, IFC no)")

if __name__ == "__main__":
    truth = load_truth(sys.argv[1])
    for p in sys.argv[2:]:
        o = score(truth, json.load(open(p)))
        report(o)
        json.dump(o, open(p.replace(".json", ".score.json"), "w"), indent=1)
