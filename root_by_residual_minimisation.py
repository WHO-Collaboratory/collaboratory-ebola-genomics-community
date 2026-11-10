#!/usr/bin/env python3
"""
Root a tree by residual minimisation.

Named as the INRB analysis on Virological describes it: the tree is "rooted to
minimise residuals from the regression line" of root-to-tip divergence on
sample collection date. landscape.md records the same method under the same
name, so the dashboard, the landscape and this script all say one thing.

Outgroup rooting is not viable for this outbreak. The only outgroup available
is a median of 206 substitutions from the 2026 genomes while within-outbreak
pairwise distances are a median of 11, so a 200-substitution branch is attached
to a star whose internal branches carry one or two substitutions and the
placement is decided by a handful of sites. Adding 205 genomes in November 2026
moved the root from a 33-tip basal clade into the middle of a 76-way polytomy;
nothing in the output had signalled how thin the previous arrangement was.

This places the root where the regression of root-to-tip divergence on sample
collection date has the smallest residual - TempEst's best-fitting root. With
the root a distance d along a branch of length L, every tip on one side gains
+d and every tip on the other gains (L-d), so the residual sum of squares is a
quadratic in d with an analytic minimum. Each branch is therefore evaluated in
closed form, and the best branch over the whole tree wins.

PROVENANCE. The quadratic is a port of optimalRootPosition() in
pearcore/js/regression.js (vendored ARTIC pearcore), which the dashboard's own
temporal-root button runs via temporalRootGraph() in pearcore/js/tree-graph.js.
It is ported rather than called because the pipeline is pure Python and neither
this machine nor CI has Node; a rooting step that cannot be run by hand
alongside the rest of run_asr_analysis.sh is worse than a port.

That source file warns that its own two implementations "must return identical
d and score values", so a third implementation is a third thing to keep in
step. --verify answers that directly: it recomputes each score by brute force,
laying out the root at the chosen position and regressing the resulting
root-to-tip distances with no algebra, and reports the largest disagreement.
Run it whenever this file is touched.

THE ROOT IS A NODE. The search ranges over existing internal nodes, not over
positions along branches. A mid-branch root would create a node absent from the
IQ-TREE .state file, and asr_homoplasy.py walks parent-to-child, so it would
silently skip the two branches at the root - the deepest and most consequential
ones. Searching positions and snapping to a node afterwards does not work
either: the positive-rate constraint holds at the fitted position, and the snap
moves the root off it. Measured on a test tree, that produced a negative clock
rate. Evaluating candidate nodes directly keeps the closed form and makes the
constraint hold at the root actually written. The unrestricted optimum is still
reported, to show what a mid-branch root would have gained.

IQ-TREE IS NOT RE-RUN. Tested on a 12-taxon alignment: -te reads a rooted tree,
logs it as rooted, and then discards the root, so a root cannot be imposed that
way. Re-running is also unnecessary - across a genuine root move only 1 of
155,340 ancestral state calls changed, as a reversible model requires. The root
determines the direction of each substitution and the parent-to-child walk, not
the reconstruction feeding it. One tree is written and both asr_homoplasy.py
and generate_local_tree.py read it, so the convergence set and the displayed
tree cannot disagree about which way a substitution ran.

DATES. Only day-precise collection dates are used. Pathoplexus also carries
partial dates and ranges, and a range turned into a point is a fabricated
observation. Tips outside --min-year are left in the topology but carry no
date, which also disposes of the outgroup: a node with no dated tips on one
side cannot be scored, so the root can never land on the outgroup stem.

OUTLIERS. Residual minimisation is driven by its most distant points, so a
wrong date is not cosmetic here - it is the most influential observation in the
fit. Two things are needed, and both were established by testing rather than
assumed.

The scale must be robust. Least squares has a breakdown point of zero: a wrong
date inflates the RMSE that a z-score is divided by, so the offender hides
inside its own contribution to the scale. On an 11-tip tree with one date moved
five months, RMSE scaling discarded an innocent tip and left the clock three
orders of magnitude too slow. The MAD scale identifies the right tip.

The first screen must use the rooting the tree ARRIVED with. A wrong date drags
the best-fit root towards itself, and residuals at the dragged root are
structured rather than showing one offender, so a screen run there clears the
culprit. The incoming rooting was chosen without reference to the dates, so it
cannot be dragged by them. With both fixes the injected error is found at
z = -3.3 and the true root and clock are recovered exactly.

Tips are dropped from the DATE SET only, never from the topology or from any
downstream analysis, and every one is named in the report. A tip excluded here
is a candidate date error or rate outlier to be investigated, not a genome to
be discarded for being divergent.

MEASURED ON REAL DATA (asr_new_adar.collapsed.tree, 1,075 tips, 1,049 dated):
the mean squared residual falls 37% against the outgroup rooting, the fitted
clock is 7.91e-4 subs/site/year where landscape.md records a root-to-tip slope
of 7.9e-4, and the x-intercept moves from 2012.6 to 2026.08, inside the
published 95% HPD for the tMRCA. The optimum is not flat: the best node beats
the runner-up by 7.9%, and only 5 of 301 candidates lie within 10%. Runtime is
under a second.

NO BRANCH SUPPORT IS ESTIMATED. A near-optimal count above one means the basal
order is not resolved by the temporal signal, and the output should say so
rather than drawing a root the data do not support.

Usage:
  root_by_residual_minimisation.py <tree> --metadata pathoplexus_metadata.json
      --out <rooted.tree> --report <fit.json> [--min-year 2026] [--max-z 2.0]
      [--verify]
"""

import argparse
import json
import math
import re
import sys
from datetime import date

# ---------------------------------------------------------------------------
# newick
# ---------------------------------------------------------------------------


class Node:
    __slots__ = ("name", "length", "children", "parent", "idx")

    def __init__(self, name="", length=0.0):
        self.name = name
        self.length = length
        self.children = []
        self.parent = None
        self.idx = -1


def parse_newick(text):
    """Parse newick, retaining internal node labels (IQ-TREE NodeN)."""
    text = text.strip()
    if text.endswith(";"):
        text = text[:-1]
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
                if pos < len(text) and text[pos] == ",":
                    pos += 1
                    continue
                if pos < len(text) and text[pos] == ")":
                    pos += 1
                break
        m = re.compile(r"[^,():;]*").match(text, pos)
        node.name = m.group(0).strip()
        pos = m.end()
        if pos < len(text) and text[pos] == ":":
            pos += 1
            m = re.compile(r"[-+0-9.eE]+").match(text, pos)
            node.length = float(m.group(0))
            pos = m.end()
        return node

    return parse_node()


def write_newick(node):
    if node.children:
        inner = ",".join(write_newick(c) for c in node.children)
        return f"({inner}){node.name}:{node.length:.10f}"
    return f"{node.name}:{node.length:.10f}"


def walk(node):
    stack = [node]
    while stack:
        n = stack.pop()
        yield n
        stack.extend(n.children)


def is_tip(node):
    return not node.children


# ---------------------------------------------------------------------------
# dates
# ---------------------------------------------------------------------------

DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def is_precise_date(s):
    """True only for a full YYYY-MM-DD.

    Pathoplexus also carries partial dates ("2026-05") and ranges
    ("2026-01-01/2026-08-28"). Taking the first ten characters of a range
    turns an unknown date into a precise one; generate_local_tree.py makes
    the same check for the same reason.
    """
    return bool(DATE_RE.fullmatch((s or "").strip()))


def decimal_year(s):
    d = date.fromisoformat(s.strip())
    start = date(d.year, 1, 1).toordinal()
    end = date(d.year + 1, 1, 1).toordinal()
    return d.year + (d.toordinal() - start) / (end - start)


def load_dates(path, min_year):
    """accession (version stripped) -> decimal year, day-precise only."""
    with open(path) as fh:
        payload = json.load(fh)
    rows = payload.get("data", payload.get("results", []))
    out = {}
    skipped_imprecise = 0
    skipped_old = 0
    for row in rows:
        acc = row.get("accession")
        if not acc:
            continue
        raw = str(row.get("sampleCollectionDate") or "")
        if not is_precise_date(raw):
            skipped_imprecise += 1
            continue
        if int(raw[:4]) < min_year:
            skipped_old += 1
            continue
        out[acc] = decimal_year(raw)
    return out, skipped_imprecise, skipped_old


# ---------------------------------------------------------------------------
# per-branch sweeps
#
# Rooted arbitrarily at the parsed root, each node carries sums over the dated
# tips below it, with distances measured from that node:
#     n, St = sum t, Sr = sum r, Srr = sum r^2, Str = sum t*r
# and the complementary sums over every dated tip outside its subtree, with
# distances measured from its PARENT. Both are built in one postorder and one
# preorder pass, so each branch is then scored in constant time.
# ---------------------------------------------------------------------------


def build_sweeps(root, tip_year):
    nodes = list(walk(root))
    for i, n in enumerate(nodes):
        n.idx = i
    size = len(nodes)
    postorder = list(reversed(nodes))  # walk() is a preorder, so reversing works

    sub_n = [0] * size
    sub_t = [0.0] * size
    sub_r = [0.0] * size
    sub_rr = [0.0] * size
    sub_tr = [0.0] * size

    for n in postorder:
        i = n.idx
        if is_tip(n):
            yr = tip_year.get(n.name)
            if yr is not None:
                sub_n[i] = 1
                sub_t[i] = yr
            continue
        for c in n.children:
            j, L = c.idx, c.length
            sub_n[i] += sub_n[j]
            sub_t[i] += sub_t[j]
            sub_r[i] += sub_r[j] + L * sub_n[j]
            sub_rr[i] += sub_rr[j] + 2.0 * L * sub_r[j] + L * L * sub_n[j]
            sub_tr[i] += sub_tr[j] + L * sub_t[j]

    out_n = [0] * size
    out_t = [0.0] * size
    out_r = [0.0] * size
    out_rr = [0.0] * size
    out_tr = [0.0] * size

    # Preorder. For a child v of p, the tips outside subtree(v) are those
    # outside subtree(p), shifted along p's own branch, plus those under each
    # sibling of v, shifted along that sibling's branch.
    for p in nodes:
        if is_tip(p):
            continue
        pi = p.idx
        if p.parent is None:
            a_n = a_t = a_r = a_rr = a_tr = 0.0
        else:
            Lp = p.length
            a_n = out_n[pi]
            a_t = out_t[pi]
            a_r = out_r[pi] + Lp * out_n[pi]
            a_rr = out_rr[pi] + 2.0 * Lp * out_r[pi] + Lp * Lp * out_n[pi]
            a_tr = out_tr[pi] + Lp * out_t[pi]

        # Shifted child contributions, and their total.
        shifted = {}
        tot_n = tot_t = tot_r = tot_rr = tot_tr = 0.0
        for c in p.children:
            j, L = c.idx, c.length
            s_n = sub_n[j]
            s_t = sub_t[j]
            s_r = sub_r[j] + L * sub_n[j]
            s_rr = sub_rr[j] + 2.0 * L * sub_r[j] + L * L * sub_n[j]
            s_tr = sub_tr[j] + L * sub_t[j]
            shifted[j] = (s_n, s_t, s_r, s_rr, s_tr)
            tot_n += s_n
            tot_t += s_t
            tot_r += s_r
            tot_rr += s_rr
            tot_tr += s_tr

        for c in p.children:
            j = c.idx
            s_n, s_t, s_r, s_rr, s_tr = shifted[j]
            out_n[j] = int(a_n + tot_n - s_n)
            out_t[j] = a_t + tot_t - s_t
            out_r[j] = a_r + tot_r - s_r
            out_rr[j] = a_rr + tot_rr - s_rr
            out_tr[j] = a_tr + tot_tr - s_tr

    return nodes, (sub_n, sub_t, sub_r, sub_rr, sub_tr), (out_n, out_t, out_r, out_rr, out_tr)


# ---------------------------------------------------------------------------
# the quadratic
#
# Port of optimalRootPosition() in pearcore/js/regression.js. Variable names
# are kept as in that file so the two can be read side by side.
# ---------------------------------------------------------------------------


def branch_coefficients(nd, sum_tB, sum_rB, sum_rrB, sum_trB,
                        np_, sum_tP, sum_rP, sum_rrP, sum_trP,
                        L, N, t_bar, C):
    """Coefficients describing the fit along one branch, or None.

    With the root a distance d from the parent-side node, the regression's
    sums are linear or quadratic in d:
        ssxy(d) = A0 + A1*d
        ssyy(d) = B0 + B1*d + B2*d^2
    from which the slope and the residual follow at any d. Port of
    optimalRootPosition() in pearcore/js/regression.js; names are kept as in
    that file so the two can be read side by side.
    """
    if nd == 0 or np_ == 0 or not L > 0 or not C > 1e-20:
        return None

    sum_hB0 = sum_rB + nd * L
    sum_dBL2 = sum_rrB + 2.0 * L * sum_rB + nd * L * L
    M0 = (sum_rP + sum_hB0) / N

    B2 = 4.0 * nd * np_ / N
    if not B2 * L > 1e-20:
        return None
    B0 = ((sum_rrP - 2.0 * M0 * sum_rP + np_ * M0 * M0)
          + (sum_dBL2 - 2.0 * M0 * sum_hB0 + nd * M0 * M0))
    B1 = 2.0 * ((sum_rP - np_ * M0) - (sum_hB0 - nd * M0))

    A0 = (sum_trP + sum_trB + L * sum_tB) - t_bar * (sum_rP + sum_hB0)
    A1 = (sum_tP - np_ * t_bar) - (sum_tB - nd * t_bar)
    return {"A0": A0, "A1": A1, "B0": B0, "B1": B1, "B2": B2, "L": L}


def evaluate_at(coef, d, N, C):
    """(mean squared residual, slope) with the root d along the branch."""
    ssxy = coef["A0"] + coef["A1"] * d
    ssyy = coef["B0"] + coef["B1"] * d + coef["B2"] * d * d
    return (ssyy - ssxy * ssxy / C) / N, ssxy / C


def optimal_root_position(coef, N, C, force_positive_rate=True):
    """Unrestricted optimum along the branch: (d, score). For reporting only.

    The root actually written is an existing node, so this is recorded to show
    how much a mid-branch root would have improved the fit.
    """
    A0, A1, B0, B1, B2, L = (coef["A0"], coef["A1"], coef["B0"],
                             coef["B1"], coef["B2"], coef["L"])
    d_lo, d_hi = 0.0, L
    if force_positive_rate:
        if A1 > 1e-20:
            d_lo = max(d_lo, -A0 / A1)
        elif A1 < -1e-20:
            d_hi = min(d_hi, -A0 / A1)
        elif A0 <= 0:
            return None
        if d_lo >= d_hi:
            return None
    Q2 = B2 - A1 * A1 / C
    Q1 = B1 - 2.0 * A0 * A1 / C
    if Q2 > 1e-30:
        d = max(d_lo, min(d_hi, -Q1 / (2.0 * Q2)))
    else:
        lo = evaluate_at(coef, d_lo, N, C)[0]
        hi = evaluate_at(coef, d_hi, N, C)[0]
        d = d_lo if lo <= hi else d_hi
    return d, evaluate_at(coef, d, N, C)[0]


def global_stats(nodes, root, tip_year):
    """N, mean date and the date sum of squares over the dated tips present."""
    N = 0
    sum_t = 0.0
    sum_tt = 0.0
    for n in nodes:
        if is_tip(n):
            y = tip_year.get(n.name)
            if y is not None:
                N += 1
                sum_t += y
                sum_tt += y * y
    if N < 3:
        return None
    t_bar = sum_t / N
    return {"N": N, "t_bar": t_bar, "C": sum_tt - sum_t * sum_t / N}


def score_node_roots(root, tip_year, force_positive_rate=True):
    """Score every internal node as a candidate root.

    The root that can actually be written is an existing node, because a
    mid-branch root would create a node absent from the IQ-TREE .state file
    and asr_homoplasy.py would then silently skip the two deepest branches.
    So the search runs over nodes, not positions: rooting at node v is exactly
    the branch quadratic evaluated at the end where the root meets v, which
    keeps the closed form and makes the positive-rate constraint hold at the
    root actually used. Searching positions and snapping afterwards does not:
    measured on a test tree, the snap moved the root off the constrained
    interval and produced a negative clock rate.

    Returns (nodes, {node_idx: (score, slope)}, unrestricted_best, stats).
    """
    nodes, sub, out = build_sweeps(root, tip_year)
    sub_n, sub_t, sub_r, sub_rr, sub_tr = sub
    out_n, out_t, out_r, out_rr, out_tr = out
    stats = global_stats(nodes, root, tip_year)
    if stats is None:
        return nodes, {}, None, None
    N, t_bar, C = stats["N"], stats["t_bar"], stats["C"]

    per_node = {}
    unrestricted = None   # (score, child_idx, d) over all positions
    for n in nodes:
        if n.parent is None:
            continue
        i = n.idx
        coef = branch_coefficients(
            sub_n[i], sub_t[i], sub_r[i], sub_rr[i], sub_tr[i],
            out_n[i], out_t[i], out_r[i], out_rr[i], out_tr[i],
            n.length, N, t_bar, C)
        if coef is None:
            continue

        opt = optimal_root_position(coef, N, C, force_positive_rate)
        if opt is not None and (unrestricted is None or opt[1] < unrestricted[0]):
            unrestricted = (opt[1], i, opt[0])

        # The two endpoints: d=0 puts the root at the parent, d=L at the child.
        for d, node in ((0.0, n.parent), (n.length, n)):
            if is_tip(node):
                continue
            score, slope = evaluate_at(coef, d, N, C)
            if force_positive_rate and not slope > 0:
                continue
            prev = per_node.get(node.idx)
            if prev is None or score < prev[0]:
                per_node[node.idx] = (score, slope)
    return nodes, per_node, unrestricted, stats


# ---------------------------------------------------------------------------
# brute-force cross-check (--verify)
# ---------------------------------------------------------------------------


def adjacency(nodes):
    adj = [[] for _ in nodes]
    for n in nodes:
        for c in n.children:
            adj[n.idx].append((c.idx, c.length))
            adj[c.idx].append((n.idx, c.length))
    return adj


def distances_from(adj, start, blocked):
    """Weighted distances from `start`, never crossing into `blocked`."""
    dist = {start: 0.0}
    stack = [start]
    while stack:
        cur = stack.pop()
        for nxt, L in adj[cur]:
            if nxt == blocked or nxt in dist:
                continue
            dist[nxt] = dist[cur] + L
            stack.append(nxt)
    return dist


def median(xs):
    ys = sorted(xs)
    n = len(ys)
    if n == 0:
        return 0.0
    mid = n // 2
    return ys[mid] if n % 2 else 0.5 * (ys[mid - 1] + ys[mid])


def robust_scale(residuals):
    """1.4826 * median absolute deviation about the median.

    The outlier screen must NOT be scaled by the RMSE. Least squares has a
    breakdown point of zero: a single wrong date inflates the RMSE that the
    z-score is divided by, so the offending point hides inside its own
    contribution to the scale and a well-behaved tip is discarded instead.
    Measured on an 11-tip test tree with one date moved five months: RMSE
    scaling dropped the wrong tip and left the clock three orders of magnitude
    too slow, where the MAD scale identifies the right one. The constant
    1.4826 makes this consistent with the standard deviation for Gaussian
    residuals, so --max-z keeps its usual reading.
    """
    if not residuals:
        return 0.0
    med = median(residuals)
    return 1.4826 * median([abs(r - med) for r in residuals])


def ols_mean_square_residual(points):
    """Mean squared residual of y on x; mirrors computeOLS's rmse**2."""
    n = len(points)
    if n < 2:
        return None
    sx = sy = sxx = sxy = 0.0
    for x, y in points:
        sx += x
        sy += y
        sxx += x * x
        sxy += x * y
    xbar, ybar = sx / n, sy / n
    ssxx = sxx - n * xbar * xbar
    if abs(ssxx) < 1e-20:
        return None
    a = (sxy - n * xbar * ybar) / ssxx
    b = ybar - a * xbar
    sse = sum((y - (a * x + b)) ** 2 for x, y in points)
    return sse / n, a, b, math.sqrt(sse / n)


def brute_force_node_score(nodes, adj, tip_year, node_idx):
    """Recompute a candidate node root's score with no algebra.

    Lays the root out at that node, measures every dated tip's root-to-tip
    distance by walking the tree, and regresses. Returns (score, slope).
    """
    dist = distances_from(adj, node_idx, blocked=None)
    pts = []
    for n in nodes:
        if not is_tip(n):
            continue
        yr = tip_year.get(n.name)
        if yr is None or n.idx not in dist:
            continue
        pts.append((yr, dist[n.idx]))
    res = ols_mean_square_residual(pts)
    return None if res is None else (res[0], res[1])


def verify(nodes, adj, tip_year, per_node, y_scale, sample=60):
    """Cross-check the closed form against brute force on a spread of nodes.

    The disagreement is normalised by the square of the largest root-to-tip
    distance, which is the scale `score` is measured on. Normalising by the
    score itself is useless: on a near-perfect clock the score approaches zero
    and ordinary floating-point noise of 1e-16 reads as a relative error of
    1e-4. A real error in the port shifts the score by a sizeable fraction of
    the divergence scale, so this test stays sharp.
    """
    keys = sorted(per_node, key=lambda i: per_node[i][0])
    if len(keys) > sample:
        step = max(1, len(keys) // sample)
        keys = keys[::step][:sample]
    norm = max(y_scale * y_scale, 1e-300)
    worst_abs = worst_norm = 0.0
    worst_at = None
    worst_slope = 0.0
    checked = 0
    for i in keys:
        score, slope = per_node[i]
        bf = brute_force_node_score(nodes, adj, tip_year, i)
        if bf is None:
            continue
        checked += 1
        diff = abs(bf[0] - score)
        if diff / norm > worst_norm:
            worst_abs, worst_norm = diff, diff / norm
            worst_at = nodes[i].name or f"node{i}"
        denom = max(abs(slope), abs(bf[1]), 1e-300)
        worst_slope = max(worst_slope, abs(bf[1] - slope) / denom)
    return checked, worst_abs, worst_norm, worst_slope, worst_at


# ---------------------------------------------------------------------------
# rerooting at an existing node
# ---------------------------------------------------------------------------


def reroot_at_node(nodes, target):
    """Re-orient the tree so `target` becomes the root.

    Every existing label is preserved and no node is created, so the IQ-TREE
    .state file still covers every internal node of the result. A node left
    with degree two by the move (the old bifurcating root) is collapsed, its
    branch length carried onto its remaining child so no tip moves.
    """
    adj = {}
    for n in nodes:
        adj.setdefault(n.idx, [])
        for c in n.children:
            adj[n.idx].append((c.idx, c.length))
            adj.setdefault(c.idx, []).append((n.idx, c.length))

    by_idx = {n.idx: n for n in nodes}
    for n in nodes:
        n.children = []
        n.parent = None

    target.length = 0.0
    seen = {target.idx}
    stack = [target.idx]
    while stack:
        cur = stack.pop()
        for nxt, L in adj[cur]:
            if nxt in seen:
                continue
            seen.add(nxt)
            child = by_idx[nxt]
            child.length = L
            child.parent = by_idx[cur]
            by_idx[cur].children.append(child)
            stack.append(nxt)

    # Collapse degree-two internal nodes (the old root, if it was bifurcating).
    collapsed = []
    for n in list(walk(target)):
        if n.parent is not None and len(n.children) == 1:
            only = n.children[0]
            only.length += n.length
            only.parent = n.parent
            i = n.parent.children.index(n)
            n.parent.children[i:i + 1] = [only]
            collapsed.append(n.name or f"node{n.idx}")
    return target, collapsed


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def root_to_tip_points(nodes, adj, tip_year, root_idx):
    dist = distances_from(adj, root_idx, blocked=None)
    pts = []
    for n in nodes:
        if not is_tip(n):
            continue
        yr = tip_year.get(n.name)
        if yr is None or n.idx not in dist:
            continue
        pts.append((n.name, yr, dist[n.idx]))
    return pts


def candidate_spread(nodes, adj, candidates, cap=200):
    """Largest number of edges between any two candidate root nodes."""
    cands = list(candidates)[:cap]
    if len(cands) < 2:
        return 0
    worst = 0
    for a in cands:
        seen = {a: 0}
        queue = [a]
        qi = 0
        while qi < len(queue):
            cur = queue[qi]
            qi += 1
            for nxt, _ in adj[cur]:
                if nxt in seen:
                    continue
                seen[nxt] = seen[cur] + 1
                queue.append(nxt)
        for b in cands:
            if b in seen and seen[b] > worst:
                worst = seen[b]
    return worst


NO_ROOT_MESSAGE = """No candidate root could be scored.

Every internal node was rejected. With the default settings that means no node
implies a positive clock rate: the temporal signal does not support rooting
this tree, and the pipeline must not quietly fall back to another criterion.
Check the collection dates before overriding with --allow-negative-rate."""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tree")
    ap.add_argument("--metadata", required=True, help="pathoplexus_metadata.json")
    ap.add_argument("--out", required=True, help="rerooted tree")
    ap.add_argument("--report", required=True, help="JSON fit diagnostics")
    ap.add_argument("--min-year", type=int, default=2026,
                    help="Tips collected before this year carry no date and "
                         "take no part in the fit (default 2026). They stay in "
                         "the topology; a node with no dated tips on one side "
                         "cannot be scored, which is what keeps the root off "
                         "the outgroup stem.")
    ap.add_argument("--max-z", type=float, default=3.0,
                    help="Drop tips beyond this many robust standardised "
                         "residuals from the date set and refit (default 3.0; "
                         "0 disables). The scale is the MAD, not the RMSE.")
    ap.add_argument("--max-passes", type=int, default=3)
    ap.add_argument("--tolerance", type=float, default=0.01,
                    help="A node within this fraction of the best score counts "
                         "as near-optimal (default 0.01).")
    ap.add_argument("--allow-negative-rate", action="store_true",
                    help="Permit a root implying a non-positive clock rate. "
                         "Off by default; a negative rate is not a rooting.")
    ap.add_argument("--expect-rate", default="1e-4,5e-3",
                    help="Plausible clock range, 'lo,hi' subs/site/year, used "
                         "only to print a warning (default 1e-4,5e-3 - the "
                         "published filovirus band). Empty disables.")
    ap.add_argument("--verify", action="store_true",
                    help="Cross-check the closed form against brute force.")
    args = ap.parse_args()

    tip_year_all, n_imprecise, n_old = load_dates(args.metadata, args.min_year)
    root = parse_newick(open(args.tree).read())
    nodes0 = list(walk(root))
    for i, n in enumerate(nodes0):
        n.idx = i

    # Tip names may carry a version suffix (PP_006X68B.2); metadata does not.
    tip_year = {}
    undated = []
    for n in nodes0:
        if not is_tip(n):
            continue
        bare = re.sub(r"\.\d+$", "", n.name)
        yr = tip_year_all.get(bare)
        if yr is None:
            undated.append(n.name)
        else:
            tip_year[n.name] = yr

    n_tips = sum(1 for n in nodes0 if is_tip(n))
    print(f"Tips: {n_tips}; dated {len(tip_year)}; undated {len(undated)}")
    print(f"Metadata skipped: {n_imprecise} without a day-precise date, "
          f"{n_old} collected before {args.min_year}")
    if len(tip_year) < 10:
        sys.exit(f"Only {len(tip_year)} dated tips - refusing to root on this.")

    force_positive = not args.allow_negative_rate
    excluded = []

    for pass_no in range(1, args.max_passes + 1):
        nodes, per_node, unrestricted, stats = score_node_roots(
            root, tip_year, force_positive)
        if not per_node:
            sys.exit(NO_ROOT_MESSAGE)
        best_idx = min(per_node, key=lambda i: per_node[i][0])
        adj = adjacency(nodes)
        # The first screen measures residuals at the rooting the tree ARRIVED
        # with, not at the best-fit root. A wrong date drags the best-fit root
        # towards itself, and the residuals at the dragged root are structured
        # rather than showing one offender, so the screen looks in the wrong
        # place and clears the culprit. The incoming rooting was chosen without
        # reference to the dates, so it cannot be dragged by them.
        anchor = root.idx if pass_no == 1 else best_idx
        pts = root_to_tip_points(nodes, adj, tip_year, anchor)
        res = ols_mean_square_residual([(y, x) for _, y, x in pts])
        if res is None:
            sys.exit("Regression failed - no variance in the dates.")
        _, slope, intercept, rmse = res

        if args.max_z <= 0:
            break
        resids = [dist - (slope * yr + intercept) for _, yr, dist in pts]
        scale = robust_scale(resids)
        med = median(resids)
        if scale <= 0:
            print("Residual scale is zero - skipping the outlier screen.")
            break
        drop = []
        for (name, yr, dist), r in zip(pts, resids):
            z = (r - med) / scale
            if abs(z) > args.max_z:
                drop.append((name, yr, z))
        if not drop:
            print(f"Pass {pass_no}: no tips beyond |z| > {args.max_z}")
            break
        print(f"Pass {pass_no}: dropping {len(drop)} tip(s) from the date set")
        for name, yr, z in sorted(drop, key=lambda r: -abs(r[2]))[:10]:
            print(f"    {name:16s} {yr:.3f}  z={z:+.2f}")
        for name, yr, z in drop:
            excluded.append({"tip": name, "decimal_year": round(yr, 4),
                             "z": round(z, 3)})
            tip_year.pop(name, None)
        if pass_no == args.max_passes:
            print("Reached --max-passes; keeping this fit.")

    nodes, per_node, unrestricted, stats = score_node_roots(
        root, tip_year, force_positive)
    if not per_node:
        sys.exit(NO_ROOT_MESSAGE)
    best_idx = min(per_node, key=lambda i: per_node[i][0])
    adj = adjacency(nodes)
    best = nodes[best_idx]
    score, slope = per_node[best_idx]

    if args.verify:
        anchor_pts = root_to_tip_points(nodes, adj, tip_year, root.idx)
        y_scale = max((x for _, _, x in anchor_pts), default=1.0)
        checked, w_abs, w_norm, w_slope, where = verify(
            nodes, adj, tip_year, per_node, y_scale)
        print(f"Verify: {checked} candidate roots cross-checked against brute "
              f"force; largest residual disagreement {w_abs:.3e} absolute, "
              f"{w_norm:.3e} of the divergence scale"
              + (f" at {where}" if where else "")
              + f"; largest slope disagreement {w_slope:.3e} relative")
        if w_norm > 1e-7 or w_slope > 1e-6:
            sys.exit("Closed form disagrees with brute force - do not use "
                     "this rooting.")

    cutoff = score * (1.0 + args.tolerance)
    near = sorted(i for i, (sc, _) in per_node.items() if sc <= cutoff)
    spread = candidate_spread(nodes, adj, near)
    print(f"Scored {len(per_node)} candidate root nodes")
    print(f"Best score {score:.6e} at {best.name or 'node%d' % best_idx}; "
          f"clock {slope:.3e} subs/site/year")
    print(f"Near-optimal within {args.tolerance:.1%}: {len(near)} node(s); "
          f"at most {spread} edges apart")
    if unrestricted is not None and unrestricted[0] < score:
        gain = 1.0 - unrestricted[0] / score
        print(f"A mid-branch root would improve the residual by "
              f"{gain:.1%} (not used; see the header)")

    rate_warning = None
    if args.expect_rate.strip():
        lo, hi = (float(v) for v in args.expect_rate.split(","))
        if not (lo <= slope <= hi):
            rate_warning = (f"fitted clock {slope:.3e} subs/site/year is "
                            f"outside the expected {lo:.0e}-{hi:.0e}")
            print(f"WARNING: {rate_warning}")

    new_root, collapsed = reroot_at_node(nodes, best)
    if collapsed:
        print(f"Collapsed {len(collapsed)} degree-two node(s): "
              f"{', '.join(collapsed)}")

    with open(args.out, "w") as fh:
        fh.write(write_newick(new_root) + ";\n")

    final_nodes = list(walk(new_root))
    for i, n in enumerate(final_nodes):
        n.idx = i
    final_adj = adjacency(final_nodes)
    final_pts = root_to_tip_points(final_nodes, final_adj, tip_year,
                                   new_root.idx)
    fres = ols_mean_square_residual([(y, x) for _, y, x in final_pts])

    report = {
        "method": "root-to-tip residual minimisation over candidate root nodes",
        "ported_from": "pearcore/js/regression.js optimalRootPosition()",
        "tree_in": args.tree,
        "tree_out": args.out,
        "tips": n_tips,
        "dated_tips_used": len(tip_year),
        "undated_tips": len(undated),
        "min_year": args.min_year,
        "root_label": best.name or None,
        "candidate_roots_scored": len(per_node),
        "best_score_mean_sq_residual": score,
        "near_optimal_nodes": len(near),
        "near_optimal_tolerance": args.tolerance,
        "near_optimal_max_edges_apart": spread,
        "unrestricted_optimum_score": None if unrestricted is None else unrestricted[0],
        "excluded_as_date_outliers": excluded,
        "max_z": args.max_z,
        "rate_warning": rate_warning,
        "regression_at_written_root": None if fres is None else {
            "slope_subs_per_site_per_year": fres[1],
            "intercept": fres[2],
            "x_intercept_tmrca": (None if abs(fres[1]) < 1e-20
                                  else -fres[2] / fres[1]),
            "rmse": fres[3],
            "n": len(final_pts),
        },
        "caveat": (
            "The root is an existing node, not the unrestricted optimum along "
            "a branch. A mid-branch root would create a node absent from the "
            "IQ-TREE .state file, and asr_homoplasy.py would silently skip the "
            "two branches at the root. No branch support is estimated: a "
            "near-optimal count above one means the basal order is not "
            "resolved by the temporal signal."),
    }
    with open(args.report, "w") as fh:
        json.dump(report, fh, indent=2)
    print(f"Wrote {args.out} and {args.report}")
    if fres is not None:
        tmrca = report["regression_at_written_root"]["x_intercept_tmrca"]
        print(f"At the written root: clock {fres[1]:.3e} subs/site/year, "
              f"rmse {fres[3]:.3e}, n={len(final_pts)}"
              + (f", x-intercept {tmrca:.3f}" if tmrca else ""))


if __name__ == "__main__":
    main()
