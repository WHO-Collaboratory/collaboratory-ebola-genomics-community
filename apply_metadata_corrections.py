#!/usr/bin/env python3
"""
Apply metadata_corrections.json to a fetched Pathoplexus metadata file.

Pathoplexus is the source of truth and the pipeline refetches it on every run,
so a value edited in place is gone by the next morning. Corrections therefore
live in metadata_corrections.json and are reapplied after each fetch. The
dashboard applies the same file to its live LAPIS query, so the local tree and
the panels a reader sees cannot disagree about a date.

A correction is applied ONLY where the record still holds the value recorded
in "published". That guard is the point of the design, not a detail:

  - When the submitter revises the record, the correction stops matching. It
    is reported as superseded and should then be deleted, so a local override
    can never outlive the error it was written for.
  - If the field changes to some third value, the correction does not fire and
    says so, rather than overwriting a value nobody has looked at.

These are other laboratories' Restricted Use records. Nothing here amends a
submission; only Pathoplexus can do that, at the submitter's request. Every
entry must carry its evidence and be reported upstream, and the dashboard
states on the page that a value has been corrected locally.

Usage:
  apply_metadata_corrections.py <metadata.json> [--corrections FILE]
                               [--check] [--strict] [--quiet]

By default this NEVER fails the caller. It runs inside the data pipeline,
immediately after a fetch, and a metadata correction is not worth aborting a
three-hour rebuild over. Anything that needs a human is printed plainly.

An accession that is absent is reported but is not an error: a fetch made
before the record was released, or a narrower query, legitimately will not
contain it.

The same file also carries admin2_aliases: health-zone spellings that denote
one place, folded to one name. Those are not corrections - the submitter's
value is not wrong, the zone is simply spelled several ways - so they have no
"published" guard, are reapplied on every run, and are not reported upstream.
A value that resembles a listed name without being listed is reported and
left alone.

--strict exits non-zero on anything unresolved, for running this as a
deliberate audit rather than as a pipeline step.
"""

import argparse
import json
import re
import sys
import unicodedata


def load_corrections(path):
    with open(path) as fh:
        return json.load(fh).get("corrections", [])


MARKER = "_metadata_corrections_applied"


def load_admin2_aliases(path):
    """{casefolded spelling: canonical name} from the admin2_aliases block.

    Both the canonical name and each listed variant are keys, so a value that
    differs only in case - MUNGWALU for Mungwalu, MONGBWALU for Mongbwalu -
    folds without having to be written out.
    """
    with open(path) as fh:
        block = json.load(fh).get("admin2_aliases") or {}
    table = {}
    for canonical, variants in (block.get("canonical") or {}).items():
        for spelling in [canonical, *variants]:
            table[spelling.strip().casefold()] = canonical
    return block.get("field", "geoLocAdmin2"), table


def _letters(value):
    """Accent- and punctuation-free letters, for spotting an unlisted variant."""
    decomposed = unicodedata.normalize("NFKD", value or "")
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^a-z]", "", stripped.lower())


def apply_admin2_aliases(records, field, table, verbose=True):
    """Returns (folded, suspects).

    `folded` counts each rewrite. `suspects` are values close enough to a
    canonical name to look like the same zone but not listed, which are left
    exactly as submitted and reported: folding one on a guess would move
    genomes between health zones.
    """
    canonical_letters = {_letters(c): c for c in set(table.values())}
    folded, suspects = {}, {}
    for row in records:
        raw = row.get(field)
        if not raw or not isinstance(raw, str):
            continue
        canonical = table.get(raw.strip().casefold())
        if canonical:
            if canonical != raw:
                row[field] = canonical
                folded[(raw, canonical)] = folded.get((raw, canonical), 0) + 1
            continue
        near = canonical_letters.get(_letters(raw))
        if near:
            suspects[(raw, near)] = suspects.get((raw, near), 0) + 1
    if verbose:
        for (raw, canonical), n in sorted(folded.items()):
            print(f"  folded     {field} {raw!r} -> {canonical!r} ({n})")
        for (raw, canonical), n in sorted(suspects.items()):
            print(f"  UNLISTED   {field} {raw!r} ({n}) resembles {canonical!r} "
                  f"but is not listed - left as submitted; add it to "
                  f"admin2_aliases if it is the same zone")
    return folded, suspects


def apply_to_records(records, corrections, already, verbose=True):
    """Returns (applied, superseded, problems, absent).

    `already` holds the corrections this file has had applied to it before,
    which is what separates "upstream fixed it" from "we fixed it, twice".
    Without that distinction a second run on the same file reports the
    correction as superseded and invites someone to delete one that is still
    needed.
    """
    by_accession = {}
    for row in records:
        acc = row.get("accession")
        if acc:
            by_accession.setdefault(acc, []).append(row)

    applied, superseded, problems, absent = [], [], [], []
    for c in corrections:
        acc, field = c["accession"], c["field"]
        rows = by_accession.get(acc)
        if not rows:
            absent.append(
                f"{acc}: not in this metadata - nothing to correct "
                f"(a fetch predating its release, or a narrower query)")
            continue
        for row in rows:
            current = row.get(field)
            key = f"{acc}.{field}"
            if current == c["corrected"] and key in already:
                absent.append(
                    f"{key}: already corrected in this file; nothing to do")
            elif current == c["corrected"]:
                superseded.append(
                    f"{key} already reads {c['corrected']!r} in the fetched "
                    f"data - upstream has been revised; delete this "
                    f"correction")
            elif current == c["published"]:
                row[field] = c["corrected"]
                applied.append(
                    f"{key}: {c['published']!r} -> {c['corrected']!r}")
            else:
                problems.append(
                    f"{key} reads {current!r}, which is neither the "
                    f"recorded published value {c['published']!r} nor the "
                    f"correction {c['corrected']!r} - do not guess, check it")
    if verbose:
        for m in applied:
            print(f"  corrected  {m}")
        for m in superseded:
            print(f"  SUPERSEDED {m}")
        for m in absent:
            print(f"  absent     {m}")
        for m in problems:
            print(f"  PROBLEM    {m}")
    return applied, superseded, problems, absent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("metadata")
    ap.add_argument("--corrections", default="metadata_corrections.json")
    ap.add_argument("--check", action="store_true",
                    help="Report what would change without writing.")
    ap.add_argument("--strict", action="store_true",
                    help="Exit non-zero on anything unresolved. For a "
                         "deliberate audit; the pipeline does not use it.")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    try:
        corrections = load_corrections(args.corrections)
        admin2_field, admin2_table = load_admin2_aliases(args.corrections)
    except FileNotFoundError:
        if not args.quiet:
            print(f"No corrections file ({args.corrections}); nothing to do.")
        return 0

    if not corrections and not admin2_table:
        if not args.quiet:
            print("No corrections recorded.")
        return 0

    with open(args.metadata) as fh:
        payload = json.load(fh)
    records = payload.get("data", payload.get("results"))
    if records is None:
        sys.exit(f"{args.metadata}: no 'data' or 'results' array")

    if not args.quiet:
        print(f"Applying {len(corrections)} correction(s) to {args.metadata}")
    already = set(payload.get(MARKER) or [])
    applied, superseded, problems, absent = apply_to_records(
        records, corrections, already, verbose=not args.quiet)

    # Spelling folds are idempotent and carry no "published" guard, so they
    # are reapplied on every run and need no marker: the canonical name is
    # already canonical the second time round.
    folded, suspects = apply_admin2_aliases(
        records, admin2_field, admin2_table, verbose=not args.quiet)

    if (applied or folded) and not args.check:
        # Record what this file has had done to it, so a second run can tell
        # its own earlier edit from a genuine upstream revision.
        payload[MARKER] = sorted(already | {m.split(":")[0] for m in applied})
        with open(args.metadata, "w") as fh:
            json.dump(payload, fh)

    if superseded and not args.quiet:
        print("  -> upstream has been revised; delete the superseded "
              "entries from the corrections file.")
    if args.strict and (problems or superseded or absent or suspects):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
