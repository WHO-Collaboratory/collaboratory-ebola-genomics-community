#!/usr/bin/env python3
"""
Convergent-mutation analysis from IQ-TREE ancestral state reconstruction.

Replaces the previous monophyly-heuristic approach. Instead of asking
"are the carriers monophyletic?" (which is rooting-dependent and conflates
reversion, tree error and missing data with convergence), this walks every
branch of the rooted tree and compares the reconstructed state at the parent
to the state at the child. A substitution is counted only where both states
are called with adequate posterior support.

For each site it reports:
  observed_changes  number of branches carrying a state change
  min_changes       minimum possible given the observed tip states
                    (n_distinct_states - 1)
  CI                consistency index = min_changes / observed_changes
                    CI = 1 means the site is consistent with the tree
                    (one origin); CI < 1 means homoplasy.

The question "is the same mutation appearing multiple times" is answered by
`recurrence`: the number of independent branches on which one identical
substitution (e.g. C->T) arose. recurrence >= 2 is convergence proper, as
distinct from a single origin followed by reversion.

Usage:
  asr_homoplasy.py --prefix asr_run --posmap asr_input.posmap.json
                   --alignment asr_input.fasta --genbank NC_014373.1.gb
                   [--min-state-prob 0.9] [--out asr_homoplasy_report.txt]
"""

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict

MISSING = set("N-?")
CODON_TABLE = {
    "TTT": "F", "TTC": "F", "TTA": "L", "TTG": "L", "CTT": "L", "CTC": "L",
    "CTA": "L", "CTG": "L", "ATT": "I", "ATC": "I", "ATA": "I", "ATG": "M",
    "GTT": "V", "GTC": "V", "GTA": "V", "GTG": "V", "TCT": "S", "TCC": "S",
    "TCA": "S", "TCG": "S", "CCT": "P", "CCC": "P", "CCA": "P", "CCG": "P",
    "ACT": "T", "ACC": "T", "ACA": "T", "ACG": "T", "GCT": "A", "GCC": "A",
    "GCA": "A", "GCG": "A", "TAT": "Y", "TAC": "Y", "TAA": "*", "TAG": "*",
    "CAT": "H", "CAC": "H", "CAA": "Q", "CAG": "Q", "AAT": "N", "AAC": "N",
    "AAA": "K", "AAG": "K", "GAT": "D", "GAC": "D", "GAA": "E", "GAG": "E",
    "TGT": "C", "TGC": "C", "TGA": "*", "TGG": "W", "CGT": "R", "CGC": "R",
    "CGA": "R", "CGG": "R", "AGT": "S", "AGC": "S", "AGA": "R", "AGG": "R",
    "GGT": "G", "GGC": "G", "GGA": "G", "GGG": "G",
}


# --------------------------------------------------------------------------
# tree
# --------------------------------------------------------------------------

class Node:
    __slots__ = ("name", "children", "parent")

    def __init__(self, name=None):
        self.name = name
        self.children = []
        self.parent = None

    def is_leaf(self):
        return not self.children


def parse_newick(text):
    """Parse Newick, retaining internal node labels (e.g. IQ-TREE NodeN)."""
    text = text.strip()
    if not text.endswith(";"):
        text += ";"
    pos = 0

    def parse_node():
        nonlocal pos
        node = Node()
        if text[pos] == "(":
            pos += 1
            while True:
                child = parse_node()
                child.parent = node
                node.children.append(child)
                if text[pos] == ",":
                    pos += 1
                    continue
                if text[pos] == ")":
                    pos += 1
                    break
                raise ValueError(f"Unexpected {text[pos]!r} at {pos}")
        # label (may be a tip name or an internal node label)
        m = re.match(r"[^,:;()\[\]]+", text[pos:])
        if m:
            node.name = m.group(0).strip().strip("'\"")
            pos += m.end()
        # discard comments/branch length
        if pos < len(text) and text[pos] == "[":
            pos = text.index("]", pos) + 1
        if pos < len(text) and text[pos] == ":":
            m = re.match(r":[-0-9.eE+]+", text[pos:])
            pos += m.end()
        if pos < len(text) and text[pos] == "[":
            pos = text.index("]", pos) + 1
        return node

    root = parse_node()
    return root


def iter_branches(root):
    """Yield (parent, child) for every branch, parent-to-child."""
    stack = [root]
    while stack:
        node = stack.pop()
        for child in node.children:
            yield node, child
            stack.append(child)


# --------------------------------------------------------------------------
# inputs
# --------------------------------------------------------------------------

def load_fasta(path):
    seqs, name, buf = {}, None, []
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


def load_state_file(path, min_prob):
    """
    Parse IQ-TREE .state into {node: {site(1-based): base}}.

    States whose posterior probability is below min_prob are left out, so
    uncertain ancestral calls do not generate phantom substitutions.
    """
    states = defaultdict(dict)
    low_conf = 0
    with open(path) as fh:
        header = None
        for line in fh:
            if line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if header is None:
                if parts[0] == "Node":
                    header = parts
                continue
            if len(parts) < 3:
                continue
            node, site, state = parts[0], int(parts[1]), parts[2].upper()
            probs = [float(x) for x in parts[3:] if x]
            if probs and max(probs) < min_prob:
                low_conf += 1
                continue
            if state in MISSING:
                continue
            states[node][site] = state
    return states, low_conf


def parse_genbank(path):
    """Minimal CDS extractor: [(name, product, start, end)] 1-based inclusive."""
    genes = []
    with open(path) as fh:
        content = fh.read()
    # sequence
    seq = ""
    m = re.search(r"ORIGIN(.*?)//", content, re.S)
    if m:
        seq = re.sub(r"[^acgtnACGTN]", "", m.group(1)).upper()
    for block in re.finditer(
        r"^     CDS             (\S+)\n((?:^ {21}.*\n)*)", content, re.M
    ):
        loc, qual = block.group(1), block.group(2)
        rng = re.match(r"(\d+)\.\.(\d+)$", loc)
        if not rng:
            continue  # skip joins/complements - BDBV CDSs are simple ranges
        start, end = int(rng.group(1)), int(rng.group(2))
        gene = re.search(r'/gene="([^"]+)"', qual)
        prod = re.search(r'/product="([^"]+)"', qual)
        genes.append((
            gene.group(1) if gene else "?",
            prod.group(1) if prod else "?",
            start, end,
        ))
    return genes, seq


def annotate(genomic_pos, ref_base, alt_base, genes, ref_seq):
    """Return (gene, product, codon, aa_change, effect) for a substitution."""
    for name, product, start, end in genes:
        if start <= genomic_pos <= end:
            offset = genomic_pos - start
            codon_num = offset // 3
            frame = offset % 3
            cs = start + codon_num * 3
            if cs + 2 > len(ref_seq) or cs < 1:
                return name, product, None, None, "coding"
            ref_codon = ref_seq[cs - 1:cs + 2]
            if len(ref_codon) != 3 or any(b not in "ACGT" for b in ref_codon):
                return name, product, None, None, "coding"
            alt_codon = (ref_codon[:frame] + alt_base + ref_codon[frame + 1:])
            ref_aa = CODON_TABLE.get(ref_codon, "?")
            alt_aa = CODON_TABLE.get(alt_codon, "?")
            if ref_aa == alt_aa:
                effect = "synonymous"
            elif alt_aa == "*":
                effect = "nonsense"
            else:
                effect = "non-synonymous"
            return (name, product, codon_num + 1,
                    f"{ref_aa}{codon_num + 1}{alt_aa}", effect)
    return None, None, None, None, "intergenic"


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--posmap", required=True)
    ap.add_argument("--alignment", required=True)
    ap.add_argument("--genbank")
    ap.add_argument("--min-state-prob", type=float, default=0.9)
    ap.add_argument("--out", default="asr_homoplasy_report.txt")
    ap.add_argument("--json-out", default="asr_homoplasy.json")
    args = ap.parse_args()

    # tree with internal node labels
    tree_path = None
    for cand in (f"{args.prefix}.asr.tree", f"{args.prefix}.treefile"):
        if os.path.exists(cand):
            tree_path = cand
            break
    if not tree_path:
        sys.exit(f"No tree found for prefix {args.prefix}")
    root = parse_newick(open(tree_path).read())
    print(f"Tree: {tree_path}")

    states, low_conf = load_state_file(f"{args.prefix}.state",
                                       args.min_state_prob)
    print(f"ASR: {len(states)} internal nodes; dropped {low_conf} "
          f"site-states below p={args.min_state_prob}")

    seqs = load_fasta(args.alignment)
    posmap = json.load(open(args.posmap))
    columns = {int(k): v for k, v in posmap["columns"].items()}
    n_sites = posmap["n_columns"]

    genes, ref_seq = ([], "")
    if args.genbank:
        genes, ref_seq = parse_genbank(args.genbank)
        print(f"Annotation: {len(genes)} CDSs, reference {len(ref_seq)} nt")

    branches = list(iter_branches(root))
    print(f"Branches: {len(branches)}")

    def state_at(node, site):
        """Reconstructed or observed base at a node for a 1-based site."""
        if node.is_leaf():
            seq = seqs.get(node.name)
            if seq is None or site > len(seq):
                return None
            b = seq[site - 1].upper()
            return None if b in MISSING else b
        return states.get(node.name, {}).get(site)

    # which sites are variable among tips
    tip_names = [n.name for n in
                 (c for _, c in branches) if n.is_leaf()] if branches else []
    tip_names = [n for n in seqs]
    variable = []
    tip_states_by_site = {}
    for site in range(1, n_sites + 1):
        obs = Counter()
        for name in tip_names:
            b = seqs[name][site - 1].upper()
            if b not in MISSING:
                obs[b] += 1
        if len(obs) > 1:
            variable.append(site)
            tip_states_by_site[site] = obs
    print(f"Variable sites among tips: {len(variable)}")

    results = []
    for site in variable:
        changes = []
        for parent, child in branches:
            ps = state_at(parent, site)
            cs = state_at(child, site)
            if ps is None or cs is None or ps == cs:
                continue
            changes.append((ps, cs, bool(child.children)))
        if not changes:
            continue
        obs_states = tip_states_by_site[site]
        min_changes = max(1, len(obs_states) - 1)
        observed = len(changes)
        ci = min_changes / observed

        # recurrence: identical substitution on independent branches
        by_sub = Counter((a, b) for a, b, _ in changes)
        # internal-branch recurrence: the same substitution arising on
        # branches that are ancestral to >=2 tips. A change on a terminal
        # branch is a private difference in one sequence and cannot by
        # itself demonstrate convergence, so it is counted separately.
        by_sub_internal = Counter((a, b) for a, b, internal in changes
                                  if internal)
        orig_col, genomic = columns[site]

        subs = []
        for (a, b), count in by_sub.most_common():
            gene, product, codon, aa, effect = (
                annotate(genomic, a, b, genes, ref_seq)
                if genes else (None, None, None, None, "unannotated"))
            # tips carrying the derived base, for tree highlighting
            carriers = [n for n in tip_names
                        if seqs[n][site - 1].upper() == b]
            subs.append({
                "from": a, "to": b, "recurrence": count,
                "recurrence_internal": by_sub_internal.get((a, b), 0),
                "gene": gene, "product": product, "codon": codon,
                "aa_change": aa, "effect": effect,
                "n_carriers": len(carriers),
                "carriers": carriers,
            })

        results.append({
            "filtered_site": site,
            "alignment_column": orig_col,
            "genomic_position": genomic,
            "observed_changes": observed,
            "min_changes": min_changes,
            "consistency_index": round(ci, 4),
            "homoplastic": observed > min_changes,
            "n_alleles": len(obs_states),
            "allele_counts": dict(obs_states),
            "substitutions": subs,
            "max_recurrence": max(by_sub.values()),
            "max_recurrence_internal": (max(by_sub_internal.values())
                                        if by_sub_internal else 0),
            "terminal_changes": sum(1 for _, _, i in changes if not i),
            "internal_changes": sum(1 for _, _, i in changes if i),
        })

    # ---------------- summary ----------------
    homoplastic = [r for r in results if r["homoplastic"]]
    recurrent = [r for r in results if r["max_recurrence"] >= 2]
    recurrent_internal = [r for r in results
                          if r["max_recurrence_internal"] >= 2]

    lines = []
    w = lines.append
    w("=" * 78)
    w("CONVERGENT MUTATION ANALYSIS - ASR-BASED")
    w("=" * 78)
    w("")
    w(f"Alignment            : {args.alignment}")
    w(f"Tree                 : {tree_path}")
    w(f"Outgroup / root      : {posmap['outgroup']}")
    w(f"Sequences            : {posmap['n_sequences']}")
    w(f"Columns analysed     : {posmap['n_columns']}")
    w(f"Min ancestral state p: {args.min_state_prob}")
    w(f"Seq missing cutoff   : {posmap['max_seq_missing']:.0%}")
    w(f"Site missing cutoff  : {posmap['max_site_missing']:.0%}")
    w("")
    w(f"Variable sites                      : {len(results)}")
    w(f"Sites with homoplasy (CI < 1)       : {len(homoplastic)}")
    w(f"Sites where one identical mutation")
    w(f"  arose on >=2 independent branches : {len(recurrent)}")
    w(f"  ... of which on >=2 INTERNAL")
    w(f"      branches (each origin leaving")
    w(f"      >=2 descendants)             : {len(recurrent_internal)}")
    w("")
    tc = sum(r["terminal_changes"] for r in recurrent)
    ic = sum(r["internal_changes"] for r in recurrent)
    if tc + ic:
        w(f"Changes at recurrent sites on terminal branches: {tc}/{tc + ic} "
          f"({100 * tc / (tc + ic):.0f}%)")
        w("  A terminal-branch change is private to one sequence and is")
        w("  indistinguishable from a sequencing or consensus-calling error.")
    w("")

    if recurrent:
        eff = Counter()
        for r in recurrent:
            for s in r["substitutions"]:
                if s["recurrence"] >= 2:
                    eff[s["effect"]] += 1
        w("Effect of recurrent substitutions:")
        for k, v in eff.most_common():
            w(f"  {k:18s} {v:4d}")
        ns = eff.get("non-synonymous", 0)
        sy = eff.get("synonymous", 0)
        if sy:
            w(f"  non-synonymous : synonymous = {ns / sy:.2f} "
              f"(neutral expectation ~2.5-3.0)")
        w("")

        trans = {("A", "G"), ("G", "A"), ("C", "T"), ("T", "C")}
        n_tr = sum(1 for r in recurrent for s in r["substitutions"]
                   if s["recurrence"] >= 2 and (s["from"], s["to"]) in trans)
        n_all = sum(1 for r in recurrent for s in r["substitutions"]
                    if s["recurrence"] >= 2)
        w(f"Transitions among recurrent substitutions: {n_tr}/{n_all} "
          f"({100 * n_tr / n_all:.0f}%) - random expectation ~33%")
        w("")

    w("-" * 78)
    w("CONVERGENCE SET (same substitution on >=2 internal branches)")
    w("-" * 78)
    if not recurrent_internal:
        w("  none")
    else:
        w(f"{'genomic':>8} {'sub':>6} {'n':>3} {'CI':>6} {'gene':<8} "
          f"{'aa':<10} {'effect':<16}")
        for r in sorted(recurrent_internal,
                        key=lambda x: -x["max_recurrence_internal"]):
            for sb in r["substitutions"]:
                if sb["recurrence_internal"] < 2:
                    continue
                w(f"{r['genomic_position']:>8} "
                  f"{sb['from']}>{sb['to']:<4} {sb['recurrence_internal']:>3} "
                  f"{r['consistency_index']:>6.3f} {(sb['gene'] or '-'):<8} "
                  f"{(sb['aa_change'] or '-'):<10} {sb['effect']:<16}")
    w("")

    w("-" * 78)
    w("ALL RECURRENT MUTATIONS (incl. terminal branches - weaker evidence)")
    w("-" * 78)
    w(f"{'genomic':>8} {'sub':>6} {'n':>4} {'CI':>6} {'gene':<10} "
      f"{'aa':<10} {'effect':<16}")
    for r in sorted(recurrent, key=lambda x: -x["max_recurrence"])[:40]:
        for s in r["substitutions"]:
            if s["recurrence"] < 2:
                continue
            w(f"{r['genomic_position']:>8} "
              f"{s['from']}>{s['to']:<4} {s['recurrence']:>4} "
              f"{r['consistency_index']:>6.3f} {(s['gene'] or '-'):<10} "
              f"{(s['aa_change'] or '-'):<10} {s['effect']:<16}")
    w("")

    with open(args.out, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    with open(args.json_out, "w") as fh:
        json.dump({
            "metadata": {
                "method": "IQ-TREE ancestral state reconstruction (--ancestral)",
                "alignment": posmap.get("alignment", args.alignment),
                "filtered_alignment": args.alignment,
                "max_seq_missing": posmap["max_seq_missing"],
                "max_site_missing": posmap["max_site_missing"],
                "n_sequences_before_filter": posmap.get("n_input") or (
                    posmap["n_sequences"] + len(posmap["dropped_sequences"])),
                # Sequences the QC filter removed, so the dashboard can say
                # which genomes are not represented in these results.
                "dropped_sequences": posmap["dropped_sequences"],
                "excluded_sequences": posmap.get("excluded_sequences", []),
                "masked_sites": posmap.get("masked_sites", []),
                "n_input": posmap.get("n_input"),
                "tree": tree_path,
                "outgroup": posmap["outgroup"],
                "n_sequences": posmap["n_sequences"],
                "n_columns": posmap["n_columns"],
                "min_state_prob": args.min_state_prob,
                "variable_sites": len(results),
                "homoplastic_sites": len(homoplastic),
                "recurrent_sites": len(recurrent),
                "recurrent_internal_sites": len(recurrent_internal),
            },
            "sites": results,
        }, fh, indent=1)

    print("\n".join(lines))
    print(f"Wrote {args.out} and {args.json_out}")


if __name__ == "__main__":
    main()
