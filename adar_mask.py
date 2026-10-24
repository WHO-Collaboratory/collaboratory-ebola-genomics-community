#!/usr/bin/env python3
"""
Detect ADAR editing clusters on a phylogeny and mask them in the alignment.

ADAR is a host enzyme that deaminates adenosine to inosine in double-stranded
RNA; inosine reads as guanosine, and in these genomes the edit surfaces as
T>C. ADAR is processive, so one encounter with a duplex leaves a *run* of
edits across tens to hundreds of bases.

That breaks mutation counting. Phylogenetics treats each substitution as an
independent event, which is what makes a recurrent one evidence of
convergence. A run of six edits from a single editing event is one event with
six outcomes, and counting it as six inflates branch lengths and mints
spurious homoplasies wherever a similar run occurs in another lineage.

So: walk the tree, find runs of T>C edits (>= min_count, each within max_gap
of the last), and mask all but the first edit of each run to N. Keeping one
edit records that the event happened and leaves the branch supported;
masking the rest stops one event being counted many times. N is used rather
than reverting to the ancestral base because the unedited state is not
observed - N is honest, and downstream phylogenetics treats it as missing
rather than as evidence.

Follows the approach taken by the Nextstrain BDBV build
(nextstrain/ebola, phylogenetic/scripts/adar-mutations.py), which replaced an
earlier policy of discarding ADAR-edited genomes outright.

Usage:
  adar_mask.py --prefix asr_run --out-alignment asr_run_input.adar.fasta
               [--max-gap 200] [--min-count 3] [--report adar_report.txt]
"""

import argparse
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asr_homoplasy import parse_newick, load_fasta, load_state_file  # noqa: E402

MISSING = set("N-?")


def is_adar(frm, to):
    """ADAR A-to-I editing, observed as T>C in these genomes."""
    return frm == "T" and to == "C"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix", default="asr_run")
    ap.add_argument("--alignment")
    ap.add_argument("--out-alignment", required=True)
    ap.add_argument("--max-gap", type=int, default=200,
                    help="Max nt between consecutive edits in a run "
                         "(default 200, matching upstream)")
    ap.add_argument("--min-count", type=int, default=3,
                    help="Minimum edits to call a run (default 3)")
    ap.add_argument("--report", default="adar_report.txt")
    args = ap.parse_args()

    aln = args.alignment or f"{args.prefix}_input.fasta"
    posmap_path = f"{args.prefix}_input.posmap.json"
    for p in (f"{args.prefix}.treefile", f"{args.prefix}.state", aln, posmap_path):
        if not os.path.exists(p):
            sys.exit(f"Missing {p} - run the ASR step first")

    root = parse_newick(open(f"{args.prefix}.treefile").read())
    seqs = load_fasta(aln)
    states, _ = load_state_file(f"{args.prefix}.state", 0.9)
    posmap = json.load(open(posmap_path))
    cols = {int(k): v for k, v in posmap["columns"].items()}
    n_sites = posmap["n_columns"]
    genomic = {site: cols[site][1] for site in cols}

    # Only variable sites can carry a mutation, so restrict the walk to them.
    variable = []
    for site in range(1, n_sites + 1):
        seen = set()
        for s in seqs.values():
            b = s[site - 1].upper()
            if b not in MISSING:
                seen.add(b)
                if len(seen) > 1:
                    break
        if len(seen) > 1:
            variable.append(site)
    print(f"Variable sites: {len(variable)}")

    def state_at(node, site):
        if not node.children:
            s = seqs.get(node.name, "")
            if site > len(s):
                return None
            b = s[site - 1].upper()
            return None if b in MISSING else b
        return states.get(node.name, {}).get(site)

    # ---- walk the tree carrying surviving edits down each lineage ----
    # edit = (site, genomic_pos). Inherited edits persist unless the base
    # moves away from C; a change to N is an ambiguous call, not a reversion.
    to_mask = defaultdict(set)      # tip name -> {alignment column}
    runs_found = []                 # (node, [genomic positions])

    def walk(node, parent, inherited):
        surviving = dict(inherited)          # site -> genomic pos
        new_edits = {}
        if parent is not None:
            for site in variable:
                a, b = state_at(parent, site), state_at(node, site)
                if a is None or b is None or a == b:
                    continue
                if site in surviving:
                    if b == "N":
                        continue             # ambiguous, keep inherited edit
                    del surviving[site]      # reverted, edit is lost
                elif is_adar(a, b):
                    new_edits[site] = genomic[site]

        edits = sorted({**surviving, **new_edits}.items(),
                       key=lambda kv: kv[1])

        # group into runs by genomic distance
        runs, current = [], []
        for site, gpos in edits:
            if current and gpos - current[-1][1] > args.max_gap:
                if len(current) >= args.min_count:
                    runs.append(current)
                current = []
            current.append((site, gpos))
        if len(current) >= args.min_count:
            runs.append(current)

        if runs and any(s in new_edits for r in runs for s, _ in r):
            runs_found.append((node.name or "internal",
                               [g for r in runs for _, g in r]))

        if not node.children:
            # Mask every edit in a run except the first.
            for r in runs:
                for site, _ in r[1:]:
                    to_mask[node.name].add(site)
        else:
            carried = {s: g for r in runs for s, g in r}
            for c in node.children:
                walk(c, node, carried)

    walk(root, None, {})

    # ---- apply the mask ----
    masked_bases = 0
    out = {}
    for name, seq in seqs.items():
        cols_to_mask = to_mask.get(name)
        if not cols_to_mask:
            out[name] = seq
            continue
        chars = list(seq)
        for site in cols_to_mask:
            base = chars[site - 1].upper()
            # Every position masked should carry the edited base. Anything
            # else means the inheritance tracking has gone wrong - a position
            # was carried down a lineage that had actually reverted - so fail
            # loudly rather than quietly corrupting the alignment.
            if base not in MISSING and base != "C":
                sys.exit(f"{name}: expected C or missing at column {site}, "
                         f"found {base} - ADAR cluster tracking is wrong")
            if base not in MISSING:
                chars[site - 1] = "N"
                masked_bases += 1
        out[name] = "".join(chars)

    with open(args.out_alignment, "w") as fh:
        for name, seq in out.items():
            fh.write(f">{name}\n")
            for i in range(0, len(seq), 60):
                fh.write(seq[i:i + 60] + "\n")

    affected = sum(1 for v in to_mask.values() if v)
    lines = [
        "ADAR EDITING CLUSTERS",
        "=" * 60,
        f"Parameters      : runs of >={args.min_count} T>C edits, "
        f"max {args.max_gap} nt apart",
        f"Genomes         : {len(seqs)}",
        f"Genomes affected: {affected}",
        f"Bases masked    : {masked_bases}",
        f"Branches with a new or extended run: {len(runs_found)}",
        "",
        "Runs are detected on the tree, so a run inherited by a clade is one",
        "event; the first edit of each run is kept and the rest masked to N.",
        "",
        "Most-edited genomes:",
    ]
    for name, sites in sorted(to_mask.items(), key=lambda kv: -len(kv[1]))[:15]:
        gpos = sorted(genomic[s] for s in sites)
        lines.append(f"  {name:18s} {len(sites):4d} masked  "
                     f"({gpos[0]}-{gpos[-1]})")
    with open(args.report, "w") as fh:
        fh.write("\n".join(lines) + "\n")

    print("\n".join(lines))
    print(f"\nWrote {args.out_alignment} and {args.report}")


if __name__ == "__main__":
    main()
