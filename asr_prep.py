#!/usr/bin/env python3
"""
Prepare a BDBV alignment for ancestral-state-reconstruction (ASR) based
convergent-mutation analysis.

Applies the quality filters that must precede any homoplasy claim:
  1. Drops sequences with excessive missing data (default >10% N/gap/?).
     The outgroup is always retained.
  2. Rewrites IUPAC ambiguity codes (RYSWKMBDHV) and '?' to N, so they are
     never treated as alleles. Ambiguity codes are low-coverage or mixed
     bases, not mutations.
  3. Drops alignment columns with excessive missing data (default >10%),
     where ancestral states cannot be reconstructed reliably.

Writes the filtered alignment plus a JSON position map so that filtered
column indices can be traced back to original alignment columns and to
genomic coordinates on the reference.

Usage:
  asr_prep.py <alignment.fasta> <outgroup_id> [--out PREFIX]
              [--max-seq-missing 0.10] [--max-site-missing 0.10]
"""

import argparse
import json
import re
import sys
from collections import Counter

MISSING = set("N-?")
AMBIGUITY = set("RYSWKMBDHV")


def load_fasta(path):
    """Read a FASTA file into an ordered {id: sequence} dict."""
    seqs = {}
    name = None
    buf = []
    with open(path) as fh:
        for line in fh:
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


def normalise(seq):
    """Uppercase, and collapse ambiguity codes and '?' to N."""
    out = []
    for c in seq.upper():
        if c in AMBIGUITY or c == "?":
            out.append("N")
        else:
            out.append(c)
    return "".join(out)


def read_exclusions(paths):
    """Accessions to drop, from files of one-per-line ids with # comments."""
    out = set()
    for path in paths:
        try:
            with open(path) as fh:
                for line in fh:
                    line = line.split("#", 1)[0].strip()
                    if line:
                        out.add(re.sub(r"\.\d+$", "", line))
        except OSError as exc:
            sys.exit(f"Could not read exclusion file {path}: {exc}")
    return out


def genomic_positions(ref):
    """Map each alignment column to a 1-based genomic coordinate on `ref`."""
    coord = []
    g = 0
    for base in ref:
        if base != "-":
            g += 1
        coord.append(g)
    return coord


def missing_fraction(seq):
    return sum(1 for c in seq if c in MISSING) / len(seq) if seq else 1.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("alignment")
    ap.add_argument("outgroup")
    ap.add_argument("--out", default="asr_input")
    ap.add_argument("--max-seq-missing", type=float, default=0.10)
    ap.add_argument("--max-site-missing", type=float, default=0.10)
    ap.add_argument(
        "--mask-sites", default="7461",
        help="Comma-separated genomic positions (1-based, on the outgroup "
             "reference) to mask to N in every sequence. Default 7461, which "
             "the Nextstrain BDBV build masks as 'a polymorphic site in a "
             "variable region in GP that conflicts with outgroup rooting'. "
             "Pass an empty string to mask nothing.")
    ap.add_argument(
        "--exclude", action="append", default=[],
        help="File of accessions to drop, one per line, '#' for comments. "
             "Repeatable. Matching ignores version suffixes.")
    args = ap.parse_args()

    seqs = load_fasta(args.alignment)
    if not seqs:
        sys.exit(f"No sequences read from {args.alignment}")
    if args.outgroup not in seqs:
        sys.exit(f"Outgroup {args.outgroup} not found in {args.alignment}")

    align_len = len(next(iter(seqs.values())))
    if any(len(s) != align_len for s in seqs.values()):
        sys.exit("Sequences are not all the same length - is this aligned?")

    n_input = len(seqs)
    print(f"Input: {len(seqs)} sequences x {align_len} columns")

    # --- 2. ambiguity -> N (done first so it counts toward missingness) ---
    amb_before = sum(1 for s in seqs.values() for c in s.upper()
                     if c in AMBIGUITY or c == "?")
    seqs = {n: normalise(s) for n, s in seqs.items()}
    print(f"Rewrote {amb_before} ambiguity/'?' characters to N")

    # --- mask specific sites (genomic coords on the reference) ---
    mask_positions = [int(x) for x in args.mask_sites.split(",") if x.strip()]
    if mask_positions:
        coord = genomic_positions(seqs[args.outgroup])
        cols = [i for i, g in enumerate(coord) if g in set(mask_positions)]
        if cols:
            colset = set(cols)
            seqs = {n: "".join("N" if i in colset else c
                               for i, c in enumerate(s))
                    for n, s in seqs.items()}
        print(f"Masked {len(cols)} column(s) for genomic site(s) "
              f"{', '.join(map(str, mask_positions))}")

    # --- drop excluded accessions ---
    excluded = read_exclusions(args.exclude)
    excluded_hits = []
    if excluded:
        excluded_hits = [n for n in seqs
                         if re.sub(r"\.\d+$", "", n) in excluded
                         and n != args.outgroup]
        for n in excluded_hits:
            del seqs[n]
        print(f"Excluded {len(excluded_hits)} of {len(excluded)} listed "
              f"accessions; {len(seqs)} remain")

    # --- 1. sequence-level filter ---
    kept, dropped = {}, []
    for name, seq in seqs.items():
        frac = missing_fraction(seq)
        if name == args.outgroup or frac <= args.max_seq_missing:
            kept[name] = seq
        else:
            dropped.append((name, frac))
    print(f"Dropped {len(dropped)} sequences with >"
          f"{args.max_seq_missing:.0%} missing; {len(kept)} retained")
    for name, frac in sorted(dropped, key=lambda x: -x[1])[:5]:
        print(f"    {name} ({frac:.1%})")
    if len(dropped) > 5:
        print(f"    ... and {len(dropped) - 5} more")

    # --- 3. site-level filter ---
    n = len(kept)
    seq_list = list(kept.values())
    keep_cols = []
    for p in range(align_len):
        miss = sum(1 for s in seq_list if s[p] in MISSING)
        if miss / n <= args.max_site_missing:
            keep_cols.append(p)
    print(f"Dropped {align_len - len(keep_cols)} columns with >"
          f"{args.max_site_missing:.0%} missing; {len(keep_cols)} retained")

    filtered = {name: "".join(seq[p] for p in keep_cols)
                for name, seq in kept.items()}

    # --- position map: filtered col -> original col -> genomic coord ---
    # Genomic coordinate counts non-gap positions in the outgroup reference.
    ref = kept[args.outgroup]
    genomic_of_col = {}
    g = 0
    for p in range(align_len):
        if ref[p] != "-":
            g += 1
        genomic_of_col[p] = g

    pos_map = {
        "alignment": args.alignment,
        "outgroup": args.outgroup,
        "n_sequences": len(filtered),
        "n_columns": len(keep_cols),
        "max_seq_missing": args.max_seq_missing,
        "max_site_missing": args.max_site_missing,
        "dropped_sequences": [name for name, _ in dropped],
        "n_input": n_input,
        "masked_sites": mask_positions,
        "excluded_sequences": sorted(excluded_hits),
        "exclusion_files": args.exclude,
        "n_excluded": len(excluded) if excluded else 0,
        # 1-based filtered column -> [1-based original column, genomic position]
        "columns": {str(i + 1): [p + 1, genomic_of_col[p]]
                    for i, p in enumerate(keep_cols)},
    }

    fasta_out = f"{args.out}.fasta"
    map_out = f"{args.out}.posmap.json"
    with open(fasta_out, "w") as fh:
        for name, seq in filtered.items():
            fh.write(f">{name}\n")
            for i in range(0, len(seq), 60):
                fh.write(seq[i:i + 60] + "\n")
    with open(map_out, "w") as fh:
        json.dump(pos_map, fh)

    # variable sites remaining, for reference
    var = 0
    for i in range(len(keep_cols)):
        alleles = Counter(s[i] for s in filtered.values() if s[i] not in MISSING)
        if len(alleles) > 1:
            var += 1
    print(f"\nVariable sites in filtered alignment: {var}")
    print(f"Wrote {fasta_out} and {map_out}")


if __name__ == "__main__":
    main()
