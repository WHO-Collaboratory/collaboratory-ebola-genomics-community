### Describe the possible issue

`PP_0085EVB` has `sampleCollectionDate` **2025-07-25**. The year looks like a typo for **2026**. It is the only one of the 1,569 records tagged `outbreak=Bdbv-2026` with a collection date before 2026; the next earliest is 2026-05-02.

### Evidence of the problem

- Its own `sampleReceivedDate` is **2026-07-25**, exactly one year later, so as published the sample was received a year before it was taken. It was sequenced on 2026-11-05.
- The genome carries 168 of the 168 outbreak-defining substitutions it has coverage for (substitutions present in ≥95% of the `Bdbv-2026` genomes). The other 42 are positions with no base call; none carries the reference allele. A sample collected in July 2025 would predate the outbreak's tMRCA (19 February 2026, 95% HPD 4 January – 21 March) and could not carry the full defining set.

### Suggested change

Set `sampleCollectionDate` to **2026-07-25**, matching `sampleReceivedDate`. The submitting laboratory should confirm the true date; if it cannot be confirmed, a less precise value such as `2026-07` would still be preferable to the current one. Revocation is not warranted — only the date appears to be wrong.

| Accession | Field | Current value | Suggested value |
|---|---|---|---|
| `PP_0085EVB` | `sampleCollectionDate` | `2025-07-25` | `2026-07-25` |

### Full list of affected sequences

- `PP_0085EVB`

This is the only affected record; no other `Bdbv-2026` record has a collection date before 2026.
