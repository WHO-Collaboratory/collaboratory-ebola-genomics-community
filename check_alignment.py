#!/usr/bin/env python3
"""
Check our alignment against the one Pathoplexus publishes.

We align independently rather than consuming Pathoplexus's alignment, so that
the analysis does not depend on a single upstream source and can cover genomes
they have not aligned. The cost of that independence is that alignment errors
are ours to find: a progressive alignment previously placed the 3' trailer of
three Nanopore genomes ~224 positions early, which put them on a long branch
and fed artefactual sites into the convergence analysis.

Both alignments are in reference coordinates (18940 columns, NC_014373), so
they compare column by column with no mapping. Disagreement at a scattered
position is an ordinary basecalling difference; disagreement concentrated in
one genome, or at one run of positions, is the signature of misplacement.

Usage:
  check_alignment.py <our_alignment.fasta> [--max-report 15] [--fail-over 2.0]
"""

import argparse
import sys
import urllib.request
from collections import Counter

LAPIS = "https://lapis.pathoplexus.org/ebola-bdbv/sample"
MISSING = set("N-?")


def load_fasta(path_or_handle):
    seqs, name, buf = {}, None, []
    handle = (open(path_or_handle) if isinstance(path_or_handle, str)
              else path_or_handle)
    for raw in handle:
        line = raw.decode() if isinstance(raw, bytes) else raw
        line = line.rstrip()
        if line.startswith(">"):
            if name is not None:
                seqs[name] = "".join(buf)
            name = line[1:].split()[0]
            buf = []
        elif line:
            buf.append(line)
    if name is not None:
        seqs[name] = "".join(buf)
    return seqs


def fetch_reference_alignment():
    url = (f"{LAPIS}/alignedNucleotideSequences"
           "?outbreak=Bdbv-2026&versionStatus=LATEST_VERSION")
    print(f"Fetching Pathoplexus alignment ...")
    with urllib.request.urlopen(url, timeout=600) as resp:
        seqs = load_fasta(resp)
    print(f"  {len(seqs)} aligned sequences")
    return seqs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("alignment")
    ap.add_argument("--max-report", type=int, default=15)
    ap.add_argument("--fail-over", type=float, default=2.0,
                    help="Exit non-zero if any genome disagrees at more than "
                         "this percent of comparable positions (default 2.0)")
    args = ap.parse_args()

    ours = load_fasta(args.alignment)
    lengths = {len(q) for q in ours.values()}
    print(f"Our alignment: {len(ours)} sequences, lengths {sorted(lengths)}")
    if lengths != {18940}:
        sys.exit("Our alignment is not in reference coordinates (expected "
                 "18940 columns) - cannot compare column by column")

    theirs = fetch_reference_alignment()
    # strip version suffixes so PP_X.1 and PP_X.2 compare by accession
    def bare(n):
        return n.split(".")[0]
    theirs_by_acc = {bare(n): q for n, q in theirs.items()}

    shared, only_ours = [], []
    for n in ours:
        if bare(n) in theirs_by_acc:
            shared.append(n)
        elif not n.startswith("NC_"):
            only_ours.append(n)
    print(f"Comparable genomes: {len(shared)}")
    if only_ours:
        print(f"  not in the Pathoplexus set: {len(only_ours)}")

    per_genome = {}
    per_position = Counter()
    for n in shared:
        a, b = ours[n].upper(), theirs_by_acc[bare(n)].upper()
        comparable = mismatch = 0
        positions = []
        for i, (x, y) in enumerate(zip(a, b)):
            if x in MISSING or y in MISSING:
                continue
            comparable += 1
            if x != y:
                mismatch += 1
                positions.append(i + 1)
                per_position[i + 1] += 1
        if comparable:
            per_genome[n] = (mismatch, comparable, positions)

    worst = sorted(per_genome.items(),
                   key=lambda kv: -(kv[1][0] / max(1, kv[1][1])))
    total_mm = sum(v[0] for v in per_genome.values())
    total_cmp = sum(v[1] for v in per_genome.values())
    print()
    print(f"Overall disagreement: {total_mm} of {total_cmp} compared bases "
          f"({100 * total_mm / max(1, total_cmp):.4f}%)")
    print()
    print(f"{'genome':18s} {'mismatch':>9s} {'compared':>9s} {'pct':>7s}  span")
    flagged = []
    for n, (mm, cmpd, pos) in worst[:args.max_report]:
        pct = 100 * mm / max(1, cmpd)
        span = f"{pos[0]}-{pos[-1]}" if pos else "-"
        print(f"{n:18s} {mm:9d} {cmpd:9d} {pct:6.3f}%  {span}")
        if pct > args.fail_over:
            flagged.append((n, pct))

    print()
    print("Positions where many genomes disagree (possible systematic issue):")
    for pos, cnt in per_position.most_common(10):
        if cnt < 3:
            break
        print(f"  position {pos}: {cnt} genomes")

    if flagged:
        print()
        print(f"FAIL: {len(flagged)} genome(s) disagree at more than "
              f"{args.fail_over}% of comparable positions:")
        for n, pct in flagged:
            print(f"  {n}  {pct:.2f}%")
        sys.exit(1)
    print()
    print(f"OK: no genome disagrees at more than {args.fail_over}% of "
          f"comparable positions")


if __name__ == "__main__":
    main()
