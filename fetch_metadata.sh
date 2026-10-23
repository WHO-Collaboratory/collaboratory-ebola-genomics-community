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
else
    echo "✗ Failed to fetch metadata"
    exit 1
fi
