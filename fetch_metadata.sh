#!/bin/bash
# Fetch Pathoplexus metadata - includes contextual sequences for local tree

echo "Fetching ALL BDBV metadata from Pathoplexus (including contextual sequences)..."
# Fetch all BDBV sequences, not just 2026 outbreak
curl -s "https://lapis.pathoplexus.org/ebola-bdbv/sample/details?versionStatus=LATEST_VERSION" > pathoplexus_metadata.json

if [ -f pathoplexus_metadata.json ] && [ -s pathoplexus_metadata.json ]; then
    COUNT=$(grep -o '"accession"' pathoplexus_metadata.json | wc -l)
    BDBV_2026=$(grep -o '"outbreak":"Bdbv-2026"' pathoplexus_metadata.json | wc -l)
    echo "✓ Fetched metadata for $COUNT sequences"
    echo "  Including $BDBV_2026 from 2026 outbreak"

    # Reapply the declared corrections. Pathoplexus is the source of truth and
    # this file is overwritten on every fetch, so a value fixed by hand lasts
    # until the next run. See metadata_corrections.json for what is corrected
    # and why. Never fails the fetch: a metadata correction is not worth
    # losing the data over, and anything unresolved is printed.
    python3 apply_metadata_corrections.py pathoplexus_metadata.json || true
else
    echo "✗ Failed to fetch metadata"
    exit 1
fi
