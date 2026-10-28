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

The tree walk alone is not enough. It can only see a run the topology keeps
on one branch, and a hypermutated genome is pulled toward the root by the
very divergence its tract creates - which splits the tract across the basal
branches, drops each piece below min_count, and leaves most of it unmasked.
Two Bundibugyo genomes reached the root of the published tree that way. So
each genome is also swept against the consensus, independently of the tree,
which finds the tract wherever the genome has landed. Use --no-genome-pass
to run the tree walk alone.

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
    ap.add_argument("--min-fraction", type=float, default=0.5,
                    help="A run is only called on a branch where T>C changes "
                         "are at least this fraction of the branch's "
                         "substitutions (default 0.5).")
    ap.add_argument("--max-run-span", type=int, default=1000,
                    help="Maximum nt from the first to the last edit of a run "
                         "(default 1000).")
    ap.add_argument("--no-genome-pass", action="store_true",
                    help="Skip the per-genome sweep and mask only what the "
                         "tree walk found.")
    ap.add_argument("--max-edit-frequency", type=float, default=0.10,
                    help="The genome sweep ignores a position where more than "
                         "this fraction of genomes differ from the consensus, "
                         "so common variation is never mistaken for an edit "
                         "(default 0.10).")
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
        total_subs = 0
        if parent is not None:
            for site in variable:
                a, b = state_at(parent, site), state_at(node, site)
                if a is None or b is None or a == b:
                    continue
                total_subs += 1
                if site in surviving:
                    if b == "N":
                        continue             # ambiguous, keep inherited edit
                    del surviving[site]      # reverted, edit is lost
                elif is_adar(a, b):
                    new_edits[site] = genomic[site]

        # A run is only credible where T>C dominates the branch. ADAR is
        # processive, so an editing event leaves a branch whose changes are
        # almost all T>C within a short span. A long branch carrying many
        # substitutions of every kind will have some T>C falling close
        # together by chance: the stem from the 2007 outgroup to this outbreak
        # has 190 substitutions, only 21% of them T>C and spread over the
        # whole genome, and was being called a run and then inherited by every
        # genome below it. Requiring T>C to be a majority of the branch
        # separates the two cases.
        if new_edits and total_subs:
            tc_fraction = len(new_edits) / total_subs
            if tc_fraction < args.min_fraction:
                new_edits = {}

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
        runs = [r for r in runs
                if r[-1][1] - r[0][1] <= args.max_run_span]

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

    # ---- second pass: the same runs, found without the tree ----------
    #
    # The tree walk counts a run shared by a clade as one event, which is
    # right, but it can only see a run that the topology keeps on one branch.
    # When a tract is split across branches - which is what happens to a
    # hypermutated genome drawn toward the root by the very divergence the
    # tract creates - each piece falls below min_count and most of the tract
    # survives. That is circular: incomplete masking moves the genome, and
    # moving it breaks the tract up further.
    #
    # So sweep each genome against the consensus as well. A tract is a tract
    # wherever the genome sits, and this pass does not depend on the tree at
    # all. It keeps the first edit of each run per genome, so a tract shared
    # by two genomes costs one extra retained edit compared with the tree
    # walk - against roughly eight left unmasked when a split goes unnoticed.
    genome_pass_bases = 0
    genome_pass_genomes = set()
    if not args.no_genome_pass:
        names = list(seqs)
        n_genomes = len(names)

        consensus = {}
        edit_freq = {}
        for site in variable:
            counts = defaultdict(int)
            for nm in names:
                b = seqs[nm][site - 1].upper()
                if b not in MISSING:
                    counts[b] += 1
            if not counts:
                continue
            base = max(counts, key=counts.get)
            consensus[site] = base
            called = sum(counts.values())
            edit_freq[site] = (called - counts[base]) / called if called else 1.0

        for nm in names:
            seq = seqs[nm]
            edits = []
            total_diffs = 0
            for site in variable:
                anc = consensus.get(site)
                if anc is None or edit_freq.get(site, 1.0) > args.max_edit_frequency:
                    # Carried by many genomes, so it is variation the outbreak
                    # shares, not a private editing tract.
                    continue
                b = seq[site - 1].upper()
                if b in MISSING or b == anc:
                    continue
                total_diffs += 1
                if is_adar(anc, b):
                    edits.append((site, genomic[site]))

            # The same test the tree walk applies to a branch, applied to a
            # genome. A sequence that is simply distant from the consensus -
            # the 2007 rooting outgroups are 193 differences away - has enough
            # T>C changes among the rest for a few to fall within max_gap by
            # chance, and masking those would damage the sequences that root
            # the tree. Editing is not like that: it dominates. Measured here,
            # the outgroups are 31% T>C and every hypermutated genome is
            # 80-86%, so a simple majority separates them.
            if not edits or len(edits) / total_diffs < args.min_fraction:
                continue
            edits.sort(key=lambda sg: sg[1])

            runs, current = [], []
            for site, gpos in edits:
                if current and gpos - current[-1][1] > args.max_gap:
                    if len(current) >= args.min_count:
                        runs.append(current)
                    current = []
                current.append((site, gpos))
            if len(current) >= args.min_count:
                runs.append(current)
            runs = [r for r in runs
                    if r[-1][1] - r[0][1] <= args.max_run_span]

            for r in runs:
                for site, _ in r[1:]:
                    if site not in to_mask[nm]:
                        to_mask[nm].add(site)
                        genome_pass_bases += 1
                        genome_pass_genomes.add(nm)

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
        f"Added by the per-genome sweep: {genome_pass_bases} base(s) in "
        f"{len(genome_pass_genomes)} genome(s)",
        "",
        "Runs are detected on the tree, so a run inherited by a clade is one",
        "event; the first edit of each run is kept and the rest masked to N.",
        "",
        "Each genome is then swept against the consensus independently of the",
        "tree, which catches a tract the topology had split across branches.",
        "",
        "Most-edited genomes:",
    ]
    for name, sites in sorted(to_mask.items(), key=lambda kv: -len(kv[1]))[:15]:
        gpos = sorted(genomic[s] for s in sites)
        lines.append(f"  {name:18s} {len(sites):4d} masked  "
                     f"({gpos[0]}-{gpos[-1]})")
    with open(args.report, "w") as fh:
        fh.write("\n".join(lines) + "\n")

    # Machine-readable summary, so the dashboard can describe the masking in
    # its method note from what actually ran rather than from fixed prose.
    summary = {
        "max_gap": args.max_gap,
        "min_count": args.min_count,
        "n_genomes": len(seqs),
        "genomes_affected": affected,
        "bases_masked": masked_bases,
        "branches_with_runs": len(runs_found),
        "genome_pass_bases": genome_pass_bases,
        "genome_pass_genomes": len(genome_pass_genomes),
        "max_edit_frequency": args.max_edit_frequency,
        # Per-genome detail, so the dashboard can name which isolates carry
        # masked positions. These genomes are analysed, not excluded: only the
        # edited positions are set to N.
        "masked_per_genome": {
            name: len(sites)
            for name, sites in sorted(to_mask.items(),
                                      key=lambda kv: (-len(kv[1]), kv[0]))
            if sites
        },
    }
    summary_path = os.path.splitext(args.report)[0] + ".json"
    with open(summary_path, "w") as fh:
        json.dump(summary, fh, indent=1)

    print("\n".join(lines))
    print(f"\nWrote {args.out_alignment} and {args.report}")


if __name__ == "__main__":
    main()
