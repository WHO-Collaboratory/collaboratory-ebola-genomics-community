#!/usr/bin/env python3
"""Detect amplicon-level contamination in an outbreak alignment.

Contamination between amplicon pools leaves a characteristic mark. Reads
from one sample carry a stretch of another sample's genome, bounded by the
amplicon the stray reads came from. In the consensus this appears as a run
of positions where the genome disagrees with its own closest relatives and
agrees instead with some other lineage - confined to one amplicon, and, if
a whole pool was affected, to amplicons drawn from the same pool.

Single substitutions do that too, by chance or through sequencing error.
What distinguishes contamination is that the discordant sites cluster inside
one amplicon far more tightly than chance allows, and that the alien alleles
match a genome sequenced in the same run.

The test is therefore in four parts, reported separately per amplicon:

  1. discordance   positions where the genome differs from the unanimous
                   base of its closest relatives, those relatives being
                   chosen from the rest of the genome so that the amplicon
                   under test cannot influence the comparison
  2. clustering    whether those positions fall inside one amplicon more
                   often than a permutation null allows
  3. direction     whether the changes all point one way. A run of three
                   or more that is entirely A->G, or entirely T->C, and
                   matches no other genome is ADAR editing, not stray
                   material, and is set aside
  4. haplotype     whether the discordant alleles exist in another genome
                   at all, and whether those genomes were sequenced in the
                   same run

A call needs 1, 2 and 4, and must not be explained by 3. Note that when
the contaminating material comes from the outbreak's dominant lineage, as
carry-over usually will, the haplotype is shared by most of the dataset
and part 4 cannot identify which sample it came from - only that the
sequence the genome is carrying is somebody else's.
"""

import argparse
import collections
import json
import os
import random
import sys
import urllib.request

import numpy as np

LAPIS = "https://lapis.pathoplexus.org/ebola-bdbv/sample"
BASES = "ACGT"
CODE = {b: i for i, b in enumerate(BASES)}
MISSING = 255


# --------------------------------------------------------------------------
# inputs


def fetch(url, path, timeout=600):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    req = urllib.request.Request(url, headers={"Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r, open(path, "wb") as fh:
        fh.write(r.read())
    return path


def read_fasta(path):
    seqs, name, buf = {}, None, []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line.startswith(">"):
                if name:
                    seqs[name] = "".join(buf)
                name, buf = line[1:].split()[0], []
            elif line:
                buf.append(line.upper())
    if name:
        seqs[name] = "".join(buf)
    return seqs


def encode(seqs):
    names = sorted(seqs)
    n, L = len(names), len(seqs[names[0]])
    arr = np.full((n, L), MISSING, dtype=np.uint8)
    for i, nm in enumerate(names):
        row = np.frombuffer(seqs[nm].encode(), dtype=np.uint8)
        for b, c in CODE.items():
            arr[i][row == ord(b)] = c
    return names, arr


def read_bed(path, offset):
    """Amplicon inserts from a primer BED, shifted into alignment coordinates.

    The insert is what ends up in the consensus: between the primers, not
    including them, so a variant under a primer is not attributed here.
    """
    left, right, pool = {}, {}, {}
    with open(path) as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            f = line.rstrip("\n").split("\t")
            if len(f) < 6:
                continue
            start, end, name, p = int(f[1]), int(f[2]), f[3], f[4]
            parts = name.split("_")
            num = int(parts[-3]) if parts[-2] in ("LEFT", "RIGHT") else int(parts[1])
            pool[num] = p
            if "LEFT" in name:
                left[num] = max(left.get(num, 0), end + offset)
            else:
                right[num] = min(right.get(num, 10 ** 9), start + offset)
    amps = []
    for num in sorted(set(left) & set(right)):
        if right[num] > left[num]:
            amps.append({"amplicon": num, "pool": pool[num],
                         "start": left[num] + 1, "end": right[num]})
    return amps


# --------------------------------------------------------------------------
# the three tests


def indicator(variable, amps):
    """A (sites x amplicons) matrix marking which amplicon each site lies in."""
    ind = np.zeros((len(variable), len(amps)), dtype=np.int32)
    pos = variable + 1
    for col, a in enumerate(amps):
        ind[(pos >= a["start"]) & (pos <= a["end"]), col] = 1
    return ind


def panels_leaving_out(arr, i, variable, ind, k, min_shared, margin):
    """Nearest neighbours of i computed once per amplicon, that amplicon excluded.

    This exclusion is the point of the method. Contamination drags a genome
    towards whatever contaminated it, so neighbours chosen on the whole
    genome are pulled towards the donor by the very sites under test, and
    the alien alleles then look like ordinary shared variation. Scoring an
    amplicon against relatives identified from the rest of the genome
    removes that circularity.
    """
    focal = arr[i][variable]
    panel = arr[:, variable]
    both = (focal != MISSING) & (panel != MISSING)
    diffs = (panel != focal) & both
    d_amp = diffs.astype(np.int32) @ ind
    c_amp = both.astype(np.int32) @ ind
    d_tot = diffs.sum(axis=1).astype(np.int32)
    c_tot = both.sum(axis=1).astype(np.int32)
    sites_in = ind.sum(axis=0)
    out = {}
    for col in range(ind.shape[1]):
        d = d_tot - d_amp[:, col]
        c = c_tot - c_amp[:, col]
        usable = len(variable) - sites_in[col]
        d = np.where(c >= min_shared * usable, d, 10 ** 6)
        d[i] = 10 ** 6
        order = np.argsort(d, kind="stable")[:k]
        order = [int(j) for j in order if d[j] < 10 ** 6]
        if not order:
            out[col] = []
            continue
        # Keep only genuinely close relatives. This outbreak carries so
        # little diversity that the tenth nearest genome can be unrelated,
        # and an unrelated genome in the panel hides exactly the case of
        # interest: a genome that has reverted to the ancestral allele its
        # own clade has moved away from.
        floor = d[order[0]]
        out[col] = [j for j in order if d[j] <= floor + margin]
    return out


def discordant(arr, i, nb, min_support, positions=None):
    """Positions where i is confidently called and every neighbour disagrees."""
    focal = arr[i]
    if not len(nb):
        return np.array([], dtype=int)
    panel = arr[nb]
    called = focal != MISSING
    known = panel != MISSING
    support = known.sum(axis=0)
    agree_other = ((panel != focal) & known).sum(axis=0)
    hit = called & (support >= min_support) & (agree_other == support)
    # and the neighbours must agree among themselves, or this is just a
    # variable site rather than one allele standing against a clean panel
    high = np.where(known, panel, 0).max(axis=0)
    low = np.where(known, panel, 255).min(axis=0)
    hit &= high == low
    if positions is not None:
        keep = np.zeros_like(hit)
        keep[np.asarray(positions) - 1] = True
        hit &= keep
    return np.flatnonzero(hit) + 1


def assign(positions, amps):
    """Amplicons each position falls in; a position may lie in an overlap."""
    out = {}
    for p in positions:
        out[p] = [a["amplicon"] for a in amps if a["start"] <= p <= a["end"]]
    return out


def cluster_pvalue(positions, amps, covered, trials, rng):
    """Permutation test: are the discordant sites unusually concentrated?

    The statistic is the largest number of discordant sites falling in any
    one amplicon. The null redistributes the same number of sites uniformly
    over the positions the genome actually covers, so missing data and the
    genome's own coverage pattern are held fixed.
    """
    if len(positions) < 2:
        return 1.0, 0
    spans = [(a["start"], a["end"], a["amplicon"]) for a in amps]

    def best(ps):
        c = collections.Counter()
        for p in ps:
            for s, e, num in spans:
                if s <= p <= e:
                    c[num] += 1
        return max(c.values()) if c else 0

    obs = best(positions)
    hits = sum(1 for _ in range(trials)
               if best(rng.sample(covered, len(positions))) >= obs)
    return (hits + 1) / (trials + 1), obs


def carriers(arr, i, positions, subset=None):
    """Genomes carrying the focal genome's alleles at every discordant site.

    Run this over the whole dataset and over the sequencing run separately.
    A haplotype that is common everywhere is most likely an ancestral state
    the focal genome has reverted to, or a recurrent one; a haplotype that
    is rare in the dataset yet present in the same run is the signature of
    material carried over from another sample.
    """
    if not len(positions):
        return []
    idx = np.asarray(positions) - 1
    focal = arr[i][idx]
    pool = range(arr.shape[0]) if subset is None else subset
    out = []
    for j in pool:
        if j == i:
            continue
        cand = arr[j][idx]
        if np.any(cand == MISSING):
            continue
        if np.all(cand == focal):
            out.append(int(j))
    return out


def hypergeom_sf(k, N, K, n):
    """P(X >= k) for drawing n from N with K successes, without SciPy."""
    from math import comb
    total = comb(N, n)
    if total == 0:
        return 1.0
    return sum(comb(K, x) * comb(N - K, n - x)
               for x in range(k, min(K, n) + 1)) / total


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--alignment", help="aligned FASTA; fetched from LAPIS if absent")
    ap.add_argument("--metadata", help="LAPIS details JSON; fetched if absent")
    ap.add_argument("--bed", help="primer BED for the scheme")
    ap.add_argument("--window", type=int,
                    help="no BED available: use tiled windows of this width "
                         "instead of amplicons; pool labels are then "
                         "meaningless and only the clustering and donor "
                         "tests apply")
    ap.add_argument("--bed-offset", type=int, default=0,
                    help="add this to BED coordinates to reach alignment coordinates")
    ap.add_argument("--scheme-match", default="",
                    help="only test genomes whose sequencingProtocol contains this")
    ap.add_argument("--cache", default=".", help="directory for downloads")
    ap.add_argument("--neighbours", type=int, default=10)
    ap.add_argument("--min-support", type=int, default=3,
                    help="neighbours that must carry data at a site to score it")
    ap.add_argument("--margin", type=int, default=3,
                    help="keep neighbours within this many differences of the "
                         "closest one")
    ap.add_argument("--min-shared", type=float, default=0.6,
                    help="fraction of variable sites a neighbour must share")
    ap.add_argument("--min-discordant", type=int, default=2,
                    help="minimum discordant sites in one amplicon to consider it")
    ap.add_argument("--trials", type=int, default=2000)
    ap.add_argument("--max-pvalue", type=float, default=0.05)
    ap.add_argument("--seed", type=int, default=20260101)
    ap.add_argument("--out", default="amplicon_contamination.tsv")
    ap.add_argument("--json", dest="json_out")
    args = ap.parse_args()
    if not args.bed and not args.window:
        ap.error("give --bed, or --window to run without a primer scheme")

    os.makedirs(args.cache, exist_ok=True)
    aln = args.alignment or fetch(
        f"{LAPIS}/alignedNucleotideSequences?outbreak=Bdbv-2026"
        "&versionStatus=LATEST_VERSION&dataFormat=FASTA",
        os.path.join(args.cache, "aligned.fasta"))
    meta_path = args.metadata or fetch(
        f"{LAPIS}/details?outbreak=Bdbv-2026&versionStatus=LATEST_VERSION"
        "&dataFormat=JSON&fields=accession,sequencingProtocol,sequencingDate,"
        "geoLocAdmin2,sampleCollectionDate,depthOfCoverage",
        os.path.join(args.cache, "details.json"))

    seqs = read_fasta(aln)
    names, arr = encode(seqs)
    meta = {r["accession"]: r for r in json.load(open(meta_path))["data"]}
    bare = [n.split(".")[0] for n in names]
    print(f"{len(names)} genomes x {arr.shape[1]} columns", file=sys.stderr)

    if args.window:
        step = args.window // 2
        amps = [{"amplicon": n + 1, "pool": str(n % 2 + 1),
                 "start": s0 + 1, "end": min(s0 + args.window, arr.shape[1])}
                for n, s0 in enumerate(range(0, arr.shape[1] - step, step))]
    else:
        amps = read_bed(args.bed, args.bed_offset)
    print(f"{len(amps)} amplicons, pools "
          f"{sorted({a['pool'] for a in amps})}", file=sys.stderr)

    known = arr != MISSING
    first = np.where(known, arr, 255).min(axis=0)
    last = np.where(known, arr, 0).max(axis=0)
    variable = np.flatnonzero((first != last) & known.any(axis=0))
    print(f"{len(variable)} variable sites", file=sys.stderr)

    runs = collections.defaultdict(list)
    for i, acc in enumerate(bare):
        d = (meta.get(acc) or {}).get("sequencingDate")
        if d:
            runs[d].append(i)

    targets = []
    for i, acc in enumerate(bare):
        proto = (meta.get(acc) or {}).get("sequencingProtocol") or ""
        if args.scheme_match and args.scheme_match.lower() not in proto.lower():
            continue
        targets.append(i)
    print(f"{len(targets)} genomes match the scheme filter", file=sys.stderr)

    rng = random.Random(args.seed)
    ind = indicator(variable, amps)
    by_amp = {a["amplicon"]: a for a in amps}
    cols_of = {col: amps[col]["amplicon"] for col in range(len(amps))}

    rows, flagged = [], 0
    for n, i in enumerate(targets, 1):
        if n % 25 == 0:
            print(f"  {n}/{len(targets)}", file=sys.stderr)
        panels = panels_leaving_out(arr, i, variable, ind, args.neighbours,
                                    args.min_shared, args.margin)
        acc = bare[i]
        d = (meta.get(acc) or {}).get("sequencingDate")
        mates = [j for j in runs.get(d, []) if j != i]
        covered = None
        genome_hits = {}
        for col, nb in panels.items():
            if len(nb) < args.min_support:
                continue
            a = cols_of[col]
            amp = by_amp[a]
            inside = [p for p in range(amp["start"], amp["end"] + 1)]
            pos = discordant(arr, i, nb, args.min_support, positions=inside)
            if len(pos) >= args.min_discordant:
                genome_hits[a] = [int(p) for p in pos]
        if not genome_hits:
            continue
        allpos = sorted({p for v in genome_hits.values() for p in v})
        if covered is None:
            covered = [int(p) + 1 for p in np.flatnonzero(arr[i] != MISSING)]
        pval, obs = cluster_pvalue(allpos, amps, covered, args.trials, rng)
        for a in sorted(genome_hits):
            amp = by_amp[a]
            sites = genome_hits[a]
            idx = np.asarray(sites) - 1
            changes = []
            for p_ in idx:
                col_bases = [b for b in arr[panels[next(c for c, num
                             in cols_of.items() if num == a)], p_]
                             if b != MISSING]
                if not col_bases:
                    continue
                parent = collections.Counter(col_bases).most_common(1)[0][0]
                changes.append((BASES[parent], BASES[arr[i][p_]]))
            kinds = collections.Counter(f"{x}>{y}" for x, y in changes)
            dominant, n_dom = (kinds.most_common(1)[0] if kinds else ("", 0))
            # A run of substitutions all in one direction, all of them A->G
            # or all T->C, and matching no other genome, is ADAR editing
            # rather than material from another sample: the enzyme acts
            # processively along one strand, so every outcome points the
            # same way. Contamination copies a haplotype that exists
            # elsewhere and carries whatever changes that haplotype has.
            adar_run = (len(changes) >= 3
                        and len(kinds) == 1
                        and dominant in ("T>C", "A>G"))
            all_car = carriers(arr, i, sites)
            run_car = [j for j in all_car if j in set(mates)]
            enrich = hypergeom_sf(len(run_car), arr.shape[0] - 1,
                                  len(all_car), len(mates)) if mates else 1.0
            rows.append({
                "accession": acc,
                "sequencing_date": d,
                "amplicon": a,
                "pool": amp["pool"],
                "amplicon_start": amp["start"],
                "amplicon_end": amp["end"],
                "n_discordant": len(sites),
                "positions": ";".join(str(p) for p in sites),
                "n_discordant_genome": len(allpos),
                "cluster_p": round(pval, 4),
                "max_in_one_amplicon": obs,
                "changes": ";".join(f"{x}>{y}" for x, y in changes),
                "dominant_change": dominant,
                "n_dominant": n_dom,
                "adar_like_run": "yes" if adar_run else "no",
                "n_carriers_dataset": len(all_car),
                "n_carriers_run": len(run_car),
                "run_size": len(mates),
                "run_enrichment_p": round(enrich, 4),
                "run_carriers": ";".join(bare[j] for j in run_car[:10]),
                "called": "yes" if (pval <= args.max_pvalue
                                    and all_car
                                    and not adar_run) else "no",
            })
        flagged += 1

    cols = list(rows[0]) if rows else []
    with open(args.out, "w") as fh:
        fh.write("\t".join(cols) + "\n")
        for r in rows:
            fh.write("\t".join(str(r[c]) for c in cols) + "\n")
    called = [r for r in rows if r["called"] == "yes"]
    print(f"\n{len(rows)} suspect amplicons in {flagged} genomes; "
          f"{len(called)} meet all three criteria", file=sys.stderr)
    print(f"wrote {args.out}", file=sys.stderr)

    if args.json_out:
        pools = collections.Counter(r["pool"] for r in called)
        with open(args.json_out, "w") as fh:
            json.dump({"rows": rows,
                       "n_tested": len(targets),
                       "n_called": len(called),
                       "pool_counts": dict(pools)}, fh, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
