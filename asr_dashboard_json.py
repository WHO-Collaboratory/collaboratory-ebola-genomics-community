#!/usr/bin/env python3
"""
Convert ASR convergence results into the JSON the dashboard consumes.

Reads asr_homoplasy.json (from asr_homoplasy.py) and writes homoplasy_data.json
in the schema dashboard.html expects, with the evidence fields added so the
page can distinguish defensible convergence from weak signal.

Evidence tiers (`evidence` field):
  internal  the same substitution arose on >=2 internal branches, so each
            origin left >=2 descendants. This is convergence proper.
  terminal  recurrence is carried wholly or partly by terminal branches.
            A terminal-branch change is private to one sequence and cannot
            be distinguished from a sequencing or consensus-calling error.

Only sites with recurrence >=2 are emitted; a site with a single origin is
not convergent and has no place in this panel.

Usage:
  asr_dashboard_json.py [--in asr_homoplasy.json] [--out homoplasy_data.json]
                        [--min-recurrence 2]
"""

import argparse
import datetime
import json
from collections import Counter

TRANSITIONS = {("A", "G"), ("G", "A"), ("C", "T"), ("T", "C")}

# Phylogenetic outliers dropped from the displayed tree. Keep in step with
# TREE_EXCLUSIONS in dashboard.html and QC_EXCLUSIONS in generate_local_tree.py.
TREE_EXCLUSIONS = {
    "PP_00764QW": "Nextclade QC: bad; clock outlier "
                  "(probable Nanopore GP2 sequencing artefacts)",
    "PP_0075Z66": "Nextclade QC: mediocre; clock outlier; VP35 frameshift",
}


def exclusions(meta):
    """
    Group every genome left out of the displayed results, with the reason.

    Three distinct things get left out and the dashboard previously named only
    the second, which understated it by two orders of magnitude.
    """
    dropped = meta.get("dropped_sequences") or []
    pct = meta.get("max_seq_missing")
    groups = []
    adar = meta.get("excluded_sequences") or []
    if adar:
        groups.append({
            "reason": "ADAR editing signatures (excluded upstream by "
                      "Nextstrain)",
            "count": len(adar),
            "accessions": sorted(adar),
            "stage": "analysis",
        })
    if dropped:
        groups.append({
            "reason": "Failed sequence QC"
                      + (f" (>{pct:.0%} missing data)" if pct else ""),
            "count": len(dropped),
            "accessions": sorted(dropped),
            "stage": "analysis",
        })
    groups.append({
        "reason": "Phylogenetic outliers excluded from the tree",
        "count": len(TREE_EXCLUSIONS),
        "accessions": sorted(TREE_EXCLUSIONS),
        "detail": TREE_EXCLUSIONS,
        "stage": "display",
    })
    outgroup = meta.get("outgroup")
    roots = sorted({a for a in ([outgroup] if outgroup else []) + ["PP_006X68B.1"]})
    groups.append({
        "reason": "Rooting outgroups (used to root the tree, not displayed)",
        "count": len(roots),
        "accessions": roots,
        "stage": "display",
    })
    return {
        "total": sum(g["count"] for g in groups),
        # Genomes kept out of the analysis itself, as opposed to those analysed
        # but not drawn on the tree.
        "total_from_analysis": sum(g["count"] for g in groups
                                   if g.get("stage") == "analysis"),
        "groups": groups,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", default="asr_homoplasy.json")
    ap.add_argument("--out", dest="outfile", default="homoplasy_data.json")
    ap.add_argument("--min-recurrence", type=int, default=2)
    args = ap.parse_args()

    src = json.load(open(args.infile))
    meta = src["metadata"]

    events = []
    for site in src["sites"]:
        for sub in site["substitutions"]:
            if sub["recurrence"] < args.min_recurrence:
                continue
            internal = sub["recurrence_internal"]
            events.append({
                # --- fields dashboard.html already reads ---
                "position": site["genomic_position"],
                "ref_base": sub["from"],
                "alt_base": sub["to"],
                "mutation": f"{sub['from']}→{sub['to']}",
                "gene": sub["gene"],
                "protein": sub["product"],
                "protein_change": sub["aa_change"],
                "mutation_type": sub["effect"],
                "num_sequences": sub["n_carriers"],
                "all_carriers": sub["carriers"],
                # --- evidence for the convergence claim ---
                "recurrence": sub["recurrence"],
                "recurrence_internal": internal,
                "num_clades": internal if internal >= 2 else sub["recurrence"],
                "consistency_index": site["consistency_index"],
                "terminal_changes": site["terminal_changes"],
                "internal_changes": site["internal_changes"],
                "evidence": "internal" if internal >= 2 else "terminal",
                "alignment_column": site["alignment_column"],
            })

    # strongest evidence first, then most recurrent
    events.sort(key=lambda e: (e["evidence"] != "internal",
                               -e["recurrence_internal"],
                               -e["recurrence"]))

    n_internal = sum(1 for e in events if e["evidence"] == "internal")
    eff = Counter(e["mutation_type"] for e in events
                  if e["evidence"] == "internal")
    n_tr = sum(1 for e in events if (e["ref_base"], e["alt_base"]) in TRANSITIONS)

    out = {
        "metadata": {
            "method": ("IQ-TREE ancestral state reconstruction (--ancestral); "
                       "substitutions counted per branch, parent state vs "
                       "child state"),
            "description": (
                "Sites where an identical substitution arose on more than one "
                "branch of the tree. Events tagged evidence=internal arose on "
                ">=2 internal branches, so each origin left >=2 descendants; "
                "those tagged evidence=terminal rest on changes private to "
                "single sequences and are not distinguishable from sequencing "
                "error."),
            "tree": meta["tree"],
            "alignment": meta["alignment"],
            "n_sequences_before_filter": meta.get("n_sequences_before_filter"),
            "masked_sites": meta.get("masked_sites") or [],
            "excluded": exclusions(meta),
            "max_seq_missing": meta.get("max_seq_missing"),
            "max_site_missing": meta.get("max_site_missing"),
            "outgroup": meta["outgroup"],
            "n_sequences": meta["n_sequences"],
            "n_columns": meta["n_columns"],
            "min_state_prob": meta["min_state_prob"],
            "variable_sites": meta["variable_sites"],
            "total_events": len(events),
            "unique_positions": len({e["position"] for e in events}),
            "events_internal_evidence": n_internal,
            "events_terminal_only": len(events) - n_internal,
            "transition_fraction": (round(n_tr / len(events), 3)
                                    if events else None),
            "effect_counts_internal_evidence": dict(eff),
            "caveat": (
                "Most recurrence in this dataset is carried by terminal "
                "branches and is concentrated in transitions, consistent with "
                "mutational hotspots and sequencing error rather than "
                "selection. Recurrent substitutions are depleted, not "
                "enriched, for protein-changing changes. Branch support was "
                "not estimated, and the tree is heavily polytomised, so the "
                "number of independent origins is an upper bound."),
            "timestamp": datetime.date.today().isoformat(),
        },
        "events": events,
    }

    with open(args.outfile, "w") as fh:
        json.dump(out, fh, indent=1)

    print(f"Wrote {args.outfile}")
    print(f"  events                  : {len(events)}")
    print(f"  evidence=internal       : {n_internal}")
    print(f"  evidence=terminal only  : {len(events) - n_internal}")
    print(f"  transitions             : {n_tr}/{len(events)}")
    print(f"  effects (internal tier) : {dict(eff)}")


if __name__ == "__main__":
    main()
