#!/usr/bin/env python3
"""
Remove genomes revoked by their submitters from the published artefacts.

A Pathoplexus revocation withdraws a submission: the revoked version keeps its
metadata and is marked REVOKED, and a new latest version is created with every
field stripped, the outbreak tag included. The dashboard's Pathoplexus panel
queries LATEST_VERSION live and so drops a revoked genome immediately, but the
tree and the convergence figures are a snapshot from the last rebuild and keep
showing it until the next one. That gap was a day in the case that prompted
this script, and these are Restricted Use data that a submitter has asked to
withdraw, so it should not wait on the schedule.

Removes a revoked accession from:
  - local_tree.nwk        the tip, with its parent collapsed if that leaves
                          a single child
  - homoplasy_data.json   carrier lists, the per-genome ADAR masking counts,
                          and the counts that follow directly from them

Aggregate figures (total_events, the per-site recurrence counts) are left
alone: they come from a tree walk that cannot be redone here, and the next
rebuild recomputes them from an alignment the revoked genome is no longer in.
What is removed is the withdrawn genome's identity and everything derived from
its sequence.

Usage:
  prune_revoked.py [--tree local_tree.nwk] [--data homoplasy_data.json]
                   [--dry-run]
"""

import argparse
import io
import json
import re
import sys
import urllib.request

LAPIS = "https://lapis.pathoplexus.org/ebola-bdbv/sample/details"


def revoked_accessions(timeout=60):
    """Accessions whose submission has been revoked, version suffix stripped."""
    url = (f"{LAPIS}?versionStatus=REVOKED&dataFormat=JSON"
           "&fields=accession,accessionVersion")
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        rows = json.loads(r.read())["data"]
    return {row["accession"] for row in rows if row.get("accession")}


def prune_tree(text, revoked):
    """Drop revoked tips from a newick string, collapsing single-child parents.

    Operates on the text rather than a parsed tree so the tip annotations
    ([&accession=...]) and every branch length survive untouched: the point is
    to remove one tip, not to rewrite the tree.
    """
    removed = []
    for acc in sorted(revoked):
        # a tip entry: 'LABEL'[&...]:LENGTH, optionally preceded/followed by a
        # comma depending on its position among its siblings
        pat = re.compile(
            r"(,)?'" + re.escape(acc) + r"[^']*'\[&[^\]]*\]:[0-9.eE+-]+(,)?")
        m = pat.search(text)
        if not m:
            continue
        lead, trail = m.group(1), m.group(2)
        if lead and trail:          # middle of a list: keep one separator
            text = text[:m.start()] + "," + text[m.end():]
        else:                       # first or last child: drop its separator
            text = text[:m.start()] + text[m.end():]
        removed.append(acc)

    # A parent left with one child asserts a split that no longer exists.
    # Splice it out, adding its length to the surviving child so no tip moves.
    single = re.compile(r"\((('[^']*'\[&[^\]]*\]|[^(),]*)" r":([0-9.eE+-]+))\)"
                        r"([^(),:;]*):([0-9.eE+-]+)")
    while True:
        m = single.search(text)
        if not m:
            break
        child, _, child_len, _parent_name, parent_len = m.groups()
        merged = float(child_len) + float(parent_len)
        head = child[:child.rindex(":")]
        text = text[:m.start()] + f"{head}:{merged:.10f}" + text[m.end():]
    return text, removed


def prune_data(data, revoked):
    """Strip revoked accessions from the dashboard JSON. Returns a change log."""
    log = []
    bare = lambda a: re.sub(r"\.\d+$", "", a)

    for ev in data.get("events", []):
        for key in ("all_carriers", "examples", "non_carriers_example"):
            if key not in ev or not isinstance(ev[key], list):
                continue
            kept = [c for c in ev[key] if bare(c) not in revoked]
            if len(kept) != len(ev[key]):
                dropped = len(ev[key]) - len(kept)
                ev[key] = kept
                if key == "all_carriers" and isinstance(ev.get("num_sequences"), int):
                    ev["num_sequences"] = max(0, ev["num_sequences"] - dropped)
                log.append(f"position {ev.get('position')}: dropped {dropped} "
                           f"from {key}")

    meta = data.get("metadata", {})
    adar = meta.get("adar") or {}
    per = adar.get("masked_per_genome")
    if isinstance(per, dict):
        hits = [k for k in per if bare(k) in revoked]
        for k in hits:
            del per[k]
        if hits:
            adar["genomes_affected"] = max(0, adar.get("genomes_affected", 0) - len(hits))
            adar["n_genomes"] = max(0, adar.get("n_genomes", 0) - len(hits))
            log.append(f"ADAR: removed {len(hits)} genome(s) from "
                       f"masked_per_genome")

    return log


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tree", default="local_tree.nwk")
    ap.add_argument("--data", default="homoplasy_data.json")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    try:
        revoked = revoked_accessions()
    except Exception as exc:
        sys.exit(f"Could not read the revoked list from Pathoplexus: {exc}")
    print(f"Pathoplexus reports {len(revoked)} revoked record(s)")

    tree_text = open(args.tree).read()
    data = json.load(open(args.data))
    # Exclude our own audit record, which names every accession already
    # removed - otherwise the check reports them as present for ever.
    scan = json.loads(json.dumps(data))
    scan.get("metadata", {}).pop("revoked_removed", None)
    raw = json.dumps(scan)

    in_tree = sorted(a for a in revoked if a in tree_text)
    in_data = sorted(a for a in revoked if a in raw)
    # Checked separately: the tree can already be clean while the figures still
    # name the genome, which is how this was missed the first time.
    print(f"  on the tree: {', '.join(in_tree) or 'none'}")
    print(f"  in {args.data}: {', '.join(in_data) or 'none'}")
    if not in_tree and not in_data:
        print("Nothing to do.")
        return 0

    new_tree, removed = prune_tree(tree_text, revoked)
    tips_before = tree_text.count("[&accession=")
    tips_after = new_tree.count("[&accession=")
    if tips_before != tips_after:
        print(f"  tips {tips_before} -> {tips_after}")
    if tips_before - tips_after != len(removed):
        sys.exit("Refusing to write: tip count fell by "
                 f"{tips_before - tips_after} but {len(removed)} were removed")

    log = prune_data(data, set(in_tree) | set(in_data))
    for line in log[:10]:
        print(f"  {line}")
    if len(log) > 10:
        print(f"  ... and {len(log) - 10} more")
    if not log:
        print(f"  no references in {args.data}")

    meta = data.setdefault("metadata", {})
    note = meta.setdefault("revoked_removed", [])
    for acc in sorted(set(removed) | set(in_data)):
        if acc not in note:
            note.append(acc)

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0

    with open(args.tree, "w") as fh:
        fh.write(new_tree)
    with open(args.data, "w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    print(f"\nWrote {args.tree} and {args.data}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
