#!/usr/bin/env python3
"""
Collapse internal branches too short to be supported by an observed
substitution, turning them into polytomies.

IQ-TREE's --polytomy only collapses branches that are effectively zero, at or
below the minimum branch length (1e-6 subs/site, about 0.02 substitutions on
this genome). It leaves branches of a fraction of a substitution alone, so a
tree can carry bifurcations that no observed change supports: in the 958-genome
BDBV tree, 37 of 308 internal branches were shorter than one substitution and
the shortest was 0.038.

Those branches are not neutral for the convergence analysis. A recurrence is
counted as internal evidence when it falls on an internal branch, on the
premise that the change was inherited by two or more tips rather than being a
one-off in a single sequence. A branch of 0.04 substitutions does not carry
that premise, and the fraction of such branches grows as genomes accumulate
without diversity.

A maximum-likelihood branch length is an expectation, not a count, so a single
substitution ambiguous between two adjacent branches is spread across both and
sites with missing data contribute partial likelihood. Collapsing restores the
honest statement: these tips descend from a common ancestor, and the data do
not resolve the order in which they split.

The collapsed branch's length is added to each child, so root-to-tip distances
are preserved and the time axis and root-to-tip regression are unchanged.

Usage:
  collapse_short_branches.py <tree.treefile> --out <collapsed.tree>
                             [--min-substitutions 0.5] [--sites 18940]
"""

import argparse
import re
import sys


class Node:
    __slots__ = ("name", "length", "children", "parent")

    def __init__(self, name="", length=0.0):
        self.name = name
        self.length = length
        self.children = []
        self.parent = None


def parse_newick(text):
    """Parse a newick string into a Node tree, keeping internal labels."""
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
    yield node
    for c in node.children:
        yield from walk(c)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tree")
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-substitutions", type=float, default=0.5,
                    help="Collapse an internal branch carrying fewer than this "
                         "many expected substitutions (default 0.5).")
    ap.add_argument("--sites", type=int, default=18940,
                    help="Alignment length used to convert branch lengths from "
                         "substitutions per site to substitutions.")
    args = ap.parse_args()

    if args.min_substitutions > 1.0:
        sys.exit(
            "Refusing to collapse above 1 substitution.\n"
            "Collapsing a branch that did carry a substitution forces that\n"
            "change to be re-derived on each child, so the analysis sees one\n"
            "event as several and manufactures the homoplasy it is meant to\n"
            "measure. Measured on the 914-genome tree: collapsing below 2\n"
            "substitutions took recurrent sites from 104 to 166 and internal\n"
            "origins from 21 to 25, and re-running the ancestral\n"
            "reconstruction on the collapsed topology did not remove the\n"
            "effect - it is intrinsic, not an artefact of reusing states.\n"
            "Below 1 substitution the collapse is inert for the counts and\n"
            "only removes bifurcations the data cannot support.")

    root = parse_newick(open(args.tree).read())
    threshold = args.min_substitutions / args.sites

    internal = [n for n in walk(root) if n.children and n.parent is not None]
    total_internal = len(internal)

    # Collapse deepest-first so a chain of short branches resolves in one pass.
    collapsed = []
    for node in sorted(internal, key=lambda n: -len(list(walk(n)))):
        if node.parent is None or not node.children:
            continue
        if node.length >= threshold:
            continue
        parent = node.parent
        # The removed branch's length goes to each child, so no tip moves.
        for child in node.children:
            child.length += node.length
            child.parent = parent
        i = parent.children.index(node)
        parent.children[i:i + 1] = node.children
        collapsed.append((node.name or "unnamed", node.length * args.sites))

    with open(args.out, "w") as fh:
        fh.write(write_newick(root) + ";\n")

    tips = sum(1 for n in walk(root) if not n.children)
    left = sum(1 for n in walk(root) if n.children and n.parent is not None)
    print(f"Collapsed {len(collapsed)} of {total_internal} internal branches "
          f"below {args.min_substitutions} substitutions "
          f"({threshold:.3e} subs/site)")
    for name, snps in sorted(collapsed, key=lambda x: x[1])[:10]:
        print(f"    {name:12s} {snps:.3f} substitutions")
    if len(collapsed) > 10:
        print(f"    ... and {len(collapsed) - 10} more")
    print(f"Internal branches remaining: {left}; tips unchanged at {tips}")
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
