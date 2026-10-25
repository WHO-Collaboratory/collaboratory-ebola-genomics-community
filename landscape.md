![IPSN logo](img/ipsn.png)

[← Community home](README.md) · [📊 Live Dashboard](https://who-collaboratory.github.io/collaboratory-ebola-genomics-community/dashboard.html)

# Landscape Analysis: BDBV Genomic Sequencing

Genome sequence data can provide valuable information to support surveillance and public health response during Ebola outbreaks. Genomic surveillance can support outbreak investigation by helping assess relatedness between cases, identify possible transmission chains, distinguish between single and multiple zoonotic spillover events, investigate cross-border transmission, and assess potential viral persistence in individuals who have recovered from infection. Genome sequence data are also important for monitoring viral evolution and for supporting the evaluation and ongoing performance of diagnostics, therapeutics and vaccines.

In an effort to help countries navigate the available wet-lab and dry-lab approaches for Bundibugyo virus (BDBV) genomics during the 2026 outbreak in DRC and Uganda, IPSN is collating a landscape analysis of current methods.

We welcome updates either through pull-requests or via issues to this repository.

> **Last updated:** 2026-10-25  
> *Based on the [ARTIC BDBV Sequencing Guide v1.0.0](https://artic.network/viruses/bdbv/bdbv-sequencing-guide.html), the [Virological posts](#references) from INRB Kinshasa and partners, and the methods deployed in the [community dashboard pipeline](https://github.com/WHO-Collaboratory/collaboratory-ebola-genomics-community). See [References](#references) for the full list.*

> **Scale.** At the time of writing Pathoplexus holds **1,055 genomes** for the 2026 outbreak (`Bdbv-2026`), up from a handful when this document was first written. Methods below have moved from "under evaluation" to routine use accordingly.

---

## Sequencing Approaches

 Sequencing strategies should be defined according to the epidemiological context, public health objectives, laboratory capacity and available resources, with integration of genome sequence data into routine surveillance and outbreak investigation wherever feasible. The selection of sequencing approaches should be guided by the target virus, intended public health objective, specimen type, expected viral load, available infrastructure and required genomic resolution.

The ability to recover complete or near-complete viral genomes is influenced by specimen type, specimen quality, viral load, sequencing methodology and bioinformatic workflows. In general, samples with lower Ct values are more likely to yield high-quality genome coverage, whereas samples with higher Ct values may result in partial genome recovery or reduced sequencing sensitivity. 

Three broad approaches are currently in use or under evaluation for BDBV genomic sequencing. These differ in cost, coverage, required infrastructure, and suitability across sample Ct ranges.

### 1. Bait Capture Sequencing

Bait capture (target capture or probe enrichment) uses probes that hybridise to the target viral genome, capturing and enriching viral nucleic acid from a sample prior to sequencing. Because enrichment is probe-driven rather than primer-driven, this approach is less susceptible to the amplification dropouts and coverage gaps that can arise from mutations at primer binding sites. It also typically provides more even genome coverage and higher sensitivity than untargeted metagenomic approaches, making it well suited to both routine surveillance and situations where genetic divergence from reference sequences is suspected.

Bait capture has generated the initial genomes from this outbreak and appears a robust approach. Initial sequencing by INRB (DRC) and CPHL (Uganda) achieved >99% genome coverage from samples with Cts ranging between 17–25; this reflects the Ct values of the first batch of samples sequenced rather than an upper or lower limit of what the method can achieve.

| Kit | Platform | Coverage (Ct 17–25) | Notes |
|---|---|---|---|
| [Twist Comprehensive Viral Research Panel](https://www.twistbioscience.com/products/ngs/fixed-panels/comprehensive-viral-research-panel) | Illumina | >99% | Used by INRB (DRC); includes BDBV probes |
| [Illumina Viral Surveillance Panel V2](https://www.illumina.com/products/by-type/sequencing-kits/library-prep-kits/viral-surveillance-panel.html) | Illumina | >99% | Used by CPHL (Uganda); BDBV added in V2 |

> ⚠️ Not all viral bait capture panels include BDBV probes. Confirm panel content before use — notably, earlier versions of some panels do not include BDBV.


---

### 2. Amplicon Sequencing

Amplicon-based sequencing works by amplifying overlapping fragments of the viral genome using sets of tiled PCR primers. The resulting amplicons can then be sequenced on short- or long-read platforms. The approach is highly sensitive due to targeted amplification of viral RNA (following reverse transcription), making it suitable for samples with lower viral loads, and is valued for its multiplexing capability, cost-effectiveness and scalability in routine genomic surveillance. The main limitation is dependence on primer performance: as genetic divergence between the circulating virus and the reference genome used for primer design increases, particularly through mutations at primer binding sites, amplification of specific genomic regions can fail, resulting in coverage gaps. Shorter amplicon schemes generally offer greater sensitivity for degraded or low-quality samples, while larger amplicon schemes require higher viral loads but use fewer primer pairs.

Amplicon-based approaches offer lower per-sample cost and higher throughput than bait capture, making them more scalable for routine genomic surveillance.

#### Primer Schemes

| Primer scheme | Amplicon (bp) | Reference | Scheme status | Genomes recorded | Notes |
| --- | --- | --- | --- | --- | --- |
| [artic-bdbv-2026/400/v1.0.0](https://labs.primalscheme.com/?q=bdbv) | 400 | 2026 epidemic strain | **draft** | 194 | Designed for the 2026 epidemic strain by ARTIC and INRB. In field use despite draft status |
| [artic-pan-ebola/1000/v2.0.0](https://labs.primalscheme.com/?q=ebola) | 1000 | Pan-Ebolavirus | **tested** | 130 | Supersedes v1.0.0. A `v2.0.0-bundibugyo` variant is also published |
| [artic-pan-ebola/1000/v1.0.0](https://labs.primalscheme.com/?q=ebola) | 1000 | Pan-Ebolavirus | **validated** | — | Gave only ~50–70% coverage on 2026 samples; superseded by v2.0.0 |

> **Scheme status vs field use are not the same thing.** The "status" column is the label in [Primal Scheme Labs](https://labs.primalscheme.com); "genomes recorded" counts Pathoplexus records naming that protocol. The BDBV-specific 400 bp scheme is still marked *draft* in the repository while being used for ~194 deposited genomes — worth knowing when deciding what to adopt, and worth checking the status again before you do.

> The BDBV-specific scheme is designed against the 2026 epidemic strain and is expected to perform best across a broad range of Ct values. Schemes can be requested directly from ARTIC at no cost including shipping via the [ARTIC Primer Foundry](https://artic.network).

**What is actually being used.** Of the 1,055 genomes deposited for this outbreak, the sequencing protocol recorded in Pathoplexus metadata is amplicon-based for the majority — `Amplicon_ArticPanEbola` (302), `Amplicon_Artic_bdbv/400` (194) and `Amplicon_Artic_pan-ebola/1000/v2.0.0` (130) — with the remainder split across rapid barcoding and Illumina DNA prep. **996 of 1,055 were sequenced on Oxford Nanopore GridION**, with the rest on Illumina platforms. Amplicon sequencing on Nanopore has become the dominant approach for this outbreak, rather than the bait capture that produced the first genomes.

> ⚠️ Protocol metadata is sparsely populated: `ampliconPcrPrimerScheme` is recorded for only 1 of 1,055 records, and `sequencedByOrganization` for 20. Completing these fields at submission materially improves the ability to interpret coverage differences between batches.

---

### 3. Metagenomics

Metagenomic sequencing involves the untargeted sequencing of nucleic acids directly from a sample without pathogen-specific amplification, enabling de novo genome assembly without reliance on a closely related reference sequence. Because it requires no primer design or probe development, it is inherently unbiased and resilient to mutations, deletions and genomic rearrangements in the target genome. This makes it particularly valuable for identifying genetically divergent variants, novel viruses, and for generating reference genomes during the early phases of an outbreak before targeted assays have been developed or validated. It can also serve as a cross-validation tool for amplicon-based approaches, and can help characterise co-infections or unexpected pathogens when there is diagnostic uncertainty. The primary limitation is sensitivity: high levels of host or environmental nucleic acids typically require samples with high viral loads (Ct &lt;20) to yield sufficient viral reads for complete genome recovery, and metagenomic approaches are generally not cost-effective for large-scale routine surveillance where targeted methods are more practical.

There are several enrichment protocols that can be utilised to increase the coverage of viral RNA including the [SMART-9N](https://www.protocols.io/view/viral-metagenomics-using-smart-9n-amplification-an-j8nlke5wwl5r/v1) method.

> Metagenomics is particularly valuable when there is diagnostic uncertainty about the causative agent, or when new strains of Ebolavirus or other haemorrhagic fevers may be co-circulating.

---

## Bioinformatic Workflows for Consensus Generation

Generating a BDBV consensus sequence requires multiple bioinformatic steps including host read removal, quality trimming, primer trimming (for amplicon data), mapping to a reference genome, and variant calling. End-to-end pipelines that integrate these steps are listed below, grouped by sequencing approach. Pipelines typically use a workflow management system (Nextflow or WDL) and containerisation (Docker or Singularity) to enable reproducible deployment across different environments.

| **Pipeline**                                                              | **Approach** | **Platform**   | **Workflow** | **Containerised**    | **Host removal** | **Trimming**      | **Primer removal** | **Mapping**    | **Variant calling**        | **Used in 2026 outbreak**                       |
| ------------------------------------------------------------------------- | ------------ | -------------- | ------------ | -------------------- | ---------------- | ----------------- | ------------------ | -------------- | -------------------------- | ----------------------------------------------- |
| [nf-core/viralrecon](https://github.com/nf-core/viralrecon)               | Bait capture | Illumina       | Nextflow     | Docker / Singularity | Kraken2          | fastp             | —                  | bowtie2        | ivar / samtools / bcftools | INRB (DRC) — Twist panel data                   |
| [artic-network/amplicon-nf](https://github.com/artic-network/amplicon-nf) | Amplicon     | Illumina / ONT | Nextflow     | Docker / Singularity | Hostile          | fastp / guppyplex | ivar / artic       | bwa / minimap2 | ivar / medaka              | Recommended for artic-bdbv-2026 amplicon scheme |


---

## Phylogenetic Analysis

The comparison of viral sequences and reconstruction of phylogenetic relationships can support identification of zoonotic spillover events, characterisation of human-to-human transmission dynamics, and detection of emerging variants. For the 2026 BDBV outbreak, early phylogenetic analysis has already indicated a single new spillover event and provided initial estimates of the time to most recent common ancestor (tMRCA). These insights can refine understanding of outbreak epidemiology and inform public health action.

Careful consideration is needed when interpreting sequence relatedness. Genetic proximity between sequences may be consistent with, but cannot be used as evidence for, direct transmission. Phylogenetic results must always be interpreted alongside epidemiological data such as timing, location and contact history. Current limitations include the small number of genomes available and significant geographic bias.

### Alignment

Analyses have used [MAFFT](https://mafft.cbrc.jp/alignment/software/) whole-genome alignment, via the [raccoon](https://github.com/artic-network/raccoon) / [raccoon-nf](https://github.com/artic-network/raccoon-nf) pipeline for QC and masking. [Pathoplexus](https://pathoplexus.org/) also publishes sequences already aligned to the NC_014373 reference, which several groups now use directly.

> ⚠️ **Align each sequence against the reference, not against each other.** A progressive multiple alignment has nothing anchoring a sequence to the reference, so a genome with a ragged, N-heavy end can have its terminal sequence placed in the wrong columns. In this outbreak that produced a clade of three Nanopore genomes whose 3′ trailers were placed ~224 positions early, registering as ~57 differences each and a long branch that looked like real divergence. Adding a batch of sequences in one call is not sufficient — MAFFT aligns the added set as a group, so genomes that fail the same way slide together. Aligning each sequence to the reference individually (`mafft --add --keeplength`, one sequence at a time) resolves it, and has the side benefit that an alignment column is a genomic position.

### Masking

Three kinds of masking are now standard for this outbreak, and independent groups have converged on them.

**ADAR editing.** ADAR is a host enzyme that converts adenosine to inosine in double-stranded RNA; inosine reads as guanosine, surfacing in these genomes as runs of T→C. Because ADAR is processive, a single editing event leaves a run of changes across tens to hundreds of bases. Counted per site, one event looks like many independent mutations — inflating branch lengths and creating apparent convergent evolution that never happened.

The approach that has emerged is to **keep the first edit of each run and mask the rest to N**, rather than discard the genome:

| Source | Criterion | Scope |
|---|---|---|
| [INRB and partners](https://virological.org/t/reproduction-number-of-the-2026-bundibugyo-virus-disease-outbreak-over-time-phylodynamic-estimates-from-genomes-collected-up-to-5-october-2026/1051) | ≥3 T→C (or A→G) from the majority base, each within 300 nt | 96 of 838 genomes, 342 positions |
| [Nextstrain BDBV build](https://github.com/nextstrain/ebola) | ≥3 T→C, each within 200 nt, detected on the phylogeny | Replaced an earlier policy of excluding edited genomes (2026-10-19) |

Keeping the first edit records that the event occurred and leaves the branch supported; masking the rest stops one event being counted many times. N is used rather than reverting to the ancestral base, because the unedited state is not observed.

> ⚠️ If detecting runs **on the tree** rather than per genome, require that T→C changes are a majority of the branch's substitutions. A long branch carrying many substitutions of every kind — for example the ~19-year stem connecting this outbreak to the 2007 reference — will have some T→C falling close together by chance. Without that constraint the stem is called an editing event and the mask propagates to every descendant.

**Genome termini.** The last ~40 positions carry sequencing artefacts and are where ragged ends get misplaced. INRB and partners mask the last 40 positions; an earlier analysis trimmed the alignment to 18,900. The Nextstrain build masks 50 from each end.

**Site 7461.** The Nextstrain BDBV build masks this position, described as a polymorphic site in a variable region in GP that conflicts with outgroup rooting.

### Rooting

Two approaches are in use, and they are not equivalent:

- **Outgroup rooting** on the 2007 BDBV reference (NC_014373) or another pre-2026 genome.
- **Residual minimisation** — rooting to minimise residuals from the root-to-tip regression, as used by [INRB and partners](https://virological.org/t/phylodynamics-and-evolution-of-the-2026-bundibugyo-virus-circulating-in-the-democratic-republic-of-the-congo-insights-from-a-100-day-window-of-genomic-sequencing/1046), who then iteratively removed genomes outside ±2 SD of the residuals.
- The published [Nextstrain BDBV build](https://nextstrain.org/ebola/bdbv) uses **midpoint rooting** (`augur refine --root mid_point`).

The 2026 clade is monophyletic relative to 2007 under all of these, so the MRCA of the outbreak is not in question. What differs is the branching order *within* the outbreak, which rests on one or two substitutions and is not resolved — different pipelines will disagree about which lineage branches first, and that disagreement should not be over-interpreted.

### Temporal inference

Early analyses used a fixed substitution rate of 1.2–1.9 × 10⁻³ substitutions/site/year borrowed from the 2014–2016 EBOV epidemic. **This is no longer necessary**: the rate has now been estimated from BDBV data directly.

| Estimate | Value | Source |
|---|---|---|
| Evolutionary rate | 8.5 × 10⁻⁴ subs/site/year (95% HPD 7.3–9.8 × 10⁻⁴) | [100-day window analysis](https://virological.org/t/phylodynamics-and-evolution-of-the-2026-bundibugyo-virus-circulating-in-the-democratic-republic-of-the-congo-insights-from-a-100-day-window-of-genomic-sequencing/1046), SkyGrid |
| tMRCA | 22 February 2026 (95% HPD 16 Jan – 24 Mar 2026) | as above |
| Root-to-tip slope | 7.9 × 10⁻⁴ | as above |

Note this is roughly **half** the EBOV-derived rate previously assumed, so tMRCA estimates based on the older figure will have been too recent.

Reproduction number estimates are now available over the course of the outbreak, from [Delphy](https://github.com/broadinstitute/delphy) and BEAST X analyses: R ≈ 1.94 (95% HPD 1.57–2.31) before the outbreak was declared, falling to 1.27 (1.00–1.56) for 15 May – 15 June and 0.86 (0.73–0.99) for 15 June – 27 September. See the [October post](https://virological.org/t/reproduction-number-of-the-2026-bundibugyo-virus-disease-outbreak-over-time-phylodynamic-estimates-from-genomes-collected-up-to-5-october-2026/1051) for the caveats, which are substantial.

### Convergent mutations and selection

Recurrent mutations are sometimes read as evidence of adaptation. For this outbreak the evidence does not support that, and the analysis is easy to get wrong.

Counting homoplasy by asking whether carriers of an allele are monophyletic is **rooting-dependent and conflates several things**: convergence, reversion, tree error and missing data all produce non-monophyly. Reconstructing ancestral states and counting substitutions per branch is more direct. On that basis, and after ADAR masking, the dashboard analysis finds that most recurrence sits on **terminal branches** — private to a single genome and indistinguishable from a sequencing or consensus-calling error — and that recurrent substitutions are ~94% transitions against a ~33% chance expectation, and are *depleted* rather than enriched for protein-changing changes.

This is consistent with the independent conclusion from the [100-day window analysis](https://virological.org/t/phylodynamics-and-evolution-of-the-2026-bundibugyo-virus-circulating-in-the-democratic-republic-of-the-congo-insights-from-a-100-day-window-of-genomic-sequencing/1046), which reported no indication of fitness-altering mutations or of any lineage beginning to dominate.

> ⚠️ Mutational hotspots and RNA editing are the main confounders. Recurrence alone is not evidence of selection; an explicit test such as [HyPhy MEME](https://www.hyphy.org/methods/selection-methods/) is required before any such claim.

## Data Sharing

WHO strongly encourages countries and laboratories to share genome sequence data and associated metadata, and where appropriate and feasible, raw sequence data, through publicly accessible databases in a timely manner to support global surveillance and risk assessment.

All BDBV genomes from the 2026 outbreak are being deposited in [Pathoplexus](https://pathoplexus.org/), which now supports BDBV sequences. A phylogenetic representation is maintained by [Nextstrain](https://nextstrain.org/ebola/bdbv) and curated by INRB colleagues.

**Citing the data.** Pathoplexus SeqSets give a citable, versioned snapshot of the genomes used in an analysis, and should be cited rather than "downloaded from Pathoplexus on date X":

| SeqSet | Contents | DOI |
|---|---|---|
| `BDBV_DRC_20260820` | 626 genomes, DRC, sampled 2026-05-02 to 2026-08-09 | [PP_SS_3400.1](https://pathoplexus.org/seqsets/PP_SS_3400.1) |
| `BDBV_DRC_20260831` | Genomes underlying the medRxiv preprint below | [10.62599/PP_SS_4291.1](https://doi.org/10.62599/PP_SS_4291.1) |

Use of the data is governed by the [Pathoplexus Data Use Terms](https://pathoplexus.org/about/terms-of-use/data-use-terms). Note that the great majority of 2026 BDBV genomes are currently under **Restricted Use** terms, which carry obligations on how they may be analysed and published.

> ⚠️ **The Nextstrain `ebola/bdbv` build is now subsampled.** Since 2026-09-30 it takes 25 genomes per month (`group_by: [year, month]`, `sequences_per_group: 25`) and excludes genomes failing Nextclade QC. It is a representative subsample, not the full dataset — at the time of writing it contains ~130 of the 1,055 available 2026 genomes. Use it for an overview; build from Pathoplexus directly for analyses that need every genome.

---

## References

### Preprint

- Wawina-Bokalanga T, Akilimali P, Pekar JE, *et al.* (69 authors; senior authors Kraemer MUG, Rambaut A, Mbala-Kingebeni P). **Temporal and Phylodynamic analyses of the 2026 Bundibugyo virus disease outbreak in the Democratic Republic of the Congo.** *medRxiv*, 7 October 2026. [doi:10.64898/2026.10.07.26365001](https://doi.org/10.64898/2026.10.07.26365001)
  Covers 686 PCR-confirmed individuals across 22 health zones, May–August 2026 — background, sample collection, sequencing and analysis. **The primary citation for this outbreak's genomic epidemiology.**

### Virological posts

From INRB Kinshasa and partners unless noted. Listed most recent first.

| Date | Post |
|---|---|
| Oct 2026 | [Reproduction number over time — genomes to 5 October 2026](https://virological.org/t/reproduction-number-of-the-2026-bundibugyo-virus-disease-outbreak-over-time-phylodynamic-estimates-from-genomes-collected-up-to-5-october-2026/1051) — Delphy and BEAST X; ADAR masking criteria; terminal masking |
| Oct 2026 | [Reproduction number over time — genomes to 6 September 2026](https://virological.org/t/reproduction-number-of-the-2026-bundibugyo-virus-disease-outbreak-over-time-phylodynamic-estimates-from-genomes-collected-up-to-6-september-2026/1047) |
| Oct 2026 | [Temporal and Phylodynamic analyses of the 2026 BVD outbreak in the DRC](https://virological.org/t/temporal-and-phylodynamic-analyses-of-the-2026-bundibugyo-virus-disease-outbreak-in-the-democratic-republic-of-the-congo/1048) — announces the preprint above |
| Oct 2026 | [Phylodynamics and evolution: insights from a 100-day window](https://virological.org/t/phylodynamics-and-evolution-of-the-2026-bundibugyo-virus-circulating-in-the-democratic-republic-of-the-congo-insights-from-a-100-day-window-of-genomic-sequencing/1046) — evolutionary rate, tMRCA, ADAR handling, rooting by residual minimisation |
| Jul 2026 | [Genomic epidemiology of the ongoing 2026 BVD outbreak in the DRC](https://virological.org/t/genomic-epidemiology-of-the-ongoing-2026-bundibugyo-virus-disease-outbreak-in-the-democratic-republic-of-the-congo/1045) — laboratory and sequencing methods |
| Jul 2026 | [Molecular evolutionary analysis of the current BVD outbreak in DRC and Uganda](https://virological.org/t/molecular-evolutionary-analysis-of-the-current-bundibugyo-virus-disease-outbreak-in-drc-and-uganda/1042) |
| Jun 2026 | [Initial genomes from the May 2026 BVD outbreak in the DRC and Uganda](https://virological.org/t/initial-genomes-from-may-2026-bundibugyo-virus-disease-outbreak-in-the-democratic-republic-of-the-congo-and-uganda/1032) |

### Tools and resources

- [ARTIC BDBV Sequencing Guide](https://artic.network/viruses/bdbv/bdbv-sequencing-guide.html) · [Primal Scheme Labs](https://labs.primalscheme.com) · [ARTIC Primer Foundry](https://artic.network)
- [amplicon-nf](https://github.com/artic-network/amplicon-nf) — consensus generation; v2 used for the genomes in the posts above
- [raccoon](https://github.com/artic-network/raccoon) — alignment QC and masking
- [nextstrain/ebola](https://github.com/nextstrain/ebola) — build definitions, including the ADAR detection script and masking configuration
- [IQ-TREE 3](http://www.iqtree.org/) · [BEAST X](https://beast.community/) · [Delphy](https://github.com/broadinstitute/delphy) · [MAFFT](https://mafft.cbrc.jp/alignment/software/)
- [This repository](https://github.com/WHO-Collaboratory/collaboratory-ebola-genomics-community) — the dashboard pipeline, including the ADAR masking and convergence analysis described above

---

[← Community home](README.md) · [📊 Live Dashboard](https://who-collaboratory.github.io/collaboratory-ebola-genomics-community/dashboard.html)
