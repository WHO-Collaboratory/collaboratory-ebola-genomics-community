![IPSN logo](img/ipsn.png)

[← Community home](README.md) · [📊 Live Dashboard](https://who-collaboratory.github.io/collaboratory-ebola-genomics-community/dashboard.html)

# Landscape Analysis: BDBV Genomic Sequencing

Genome sequence data can provide valuable information to support surveillance and public health response during Ebola outbreaks. Genomic surveillance can support outbreak investigation by helping assess relatedness between cases, identify possible transmission chains, distinguish between single and multiple zoonotic spillover events, investigate cross-border transmission, and assess potential viral persistence in individuals who have recovered from infection. Genome sequence data are also important for monitoring viral evolution and for supporting the evaluation and ongoing performance of diagnostics, therapeutics and vaccines.

In an effort to help countries navigate the available wet-lab and dry-lab approaches for Bundibugyo virus (BDBV) genomics during the 2026 outbreak in DRC and Uganda, IPSN is collating a landscape analysis of current methods.

We welcome updates either through pull-requests or via issues to this repository.

> **Last updated:** 2026-10-29  
> *Based on the [ARTIC BDBV Sequencing Guide v1.0.0](https://artic.network/viruses/bdbv/bdbv-sequencing-guide.html), the [medRxiv preprint and Virological posts](#references) from INRB Kinshasa and partners, and the [Nextstrain BDBV build](https://github.com/nextstrain/ebola). See [References](#references) for the full list.*

> **Scale.** At the time of writing Pathoplexus holds **1,224 genomes** for the 2026 outbreak (`Bdbv-2026`), up from a handful when this document was first written. Methods below have moved from "under evaluation" to routine use accordingly.

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

> ⚠️ Not all viral bait capture panels include BDBV probes. Panel content should be confirmed before use; earlier versions of some panels do not include BDBV.


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

> **Scheme status and field use are distinct.** The BDBV-specific 400 bp scheme is still marked *draft* in [Primal Scheme Labs](https://labs.primalscheme.com) while accounting for roughly 194 deposited genomes. Weigh both when selecting a scheme, and confirm the current status at the time of adoption.

> The BDBV-specific scheme is designed against the 2026 epidemic strain and is expected to perform best across a broad range of Ct values. Schemes can be requested directly from ARTIC at no cost including shipping via the [ARTIC Primer Foundry](https://artic.network).

**Methods in current use.** Of the 1,224 genomes deposited for this outbreak, the protocol recorded in Pathoplexus metadata is amplicon-based for 813, with 368 recording only a rapid barcoding library preparation and the remainder split across Illumina DNA prep and hybridisation capture. **1,139 were sequenced on Oxford Nanopore platforms** and 80 on Illumina. Amplicon sequencing on Nanopore has become the dominant approach for this outbreak, rather than the bait capture that produced the first genomes.

> ⚠️ Protocol metadata is sparsely populated: `ampliconPcrPrimerScheme` is recorded for 1 of 1,224 records and `sequencedByOrganization` for 20. Completing these at submission is what makes coverage differences between batches interpretable.

---

### 3. Metagenomics

Metagenomic sequencing involves the untargeted sequencing of nucleic acids directly from a sample without pathogen-specific amplification, enabling de novo genome assembly without reliance on a closely related reference sequence. Because it requires no primer design or probe development, it is inherently unbiased and resilient to mutations, deletions and genomic rearrangements in the target genome. This makes it particularly valuable for identifying genetically divergent variants, novel viruses, and for generating reference genomes during the early phases of an outbreak before targeted assays have been developed or validated. It can also serve as a cross-validation tool for amplicon-based approaches, and can help characterise co-infections or unexpected pathogens when there is diagnostic uncertainty. The primary limitation is sensitivity: high levels of host or environmental nucleic acids typically require samples with high viral loads (Ct &lt;20) to yield sufficient viral reads for complete genome recovery, and metagenomic approaches are generally not cost-effective for large-scale routine surveillance where targeted methods are more practical.

There are several enrichment protocols that can be utilised to increase the coverage of viral RNA including the [SMART-9N](https://www.protocols.io/view/viral-metagenomics-using-smart-9n-amplification-an-j8nlke5wwl5r/v1) method.

> Metagenomics is particularly valuable when there is diagnostic uncertainty about the causative agent, or when new strains of Ebolavirus or other haemorrhagic fevers may be co-circulating.

---

## Bioinformatic Workflows for Consensus Generation

Generating a BDBV consensus sequence requires multiple bioinformatic steps including host read removal, quality trimming, primer trimming (for amplicon data), mapping to a reference genome, and variant calling. End-to-end pipelines that integrate these steps are listed below. Pipelines typically use a workflow management system (Nextflow or WDL) and containerisation (Docker or Singularity) to enable reproducible deployment across different environments.

Two pipelines account for the published genomes of this outbreak, selected by sequencing platform rather than by enrichment approach. The [medRxiv preprint](#references) reports ARTIC `amplicon-nf` v2.0 for Oxford Nanopore reads and nf-core `viralrecon` 2.6.0 for Illumina reads, the latter applied to Illumina DNA Prep with enrichment as well as to probe-based capture data.

| **Pipeline** | **Platform** | **Approach** | **Version reported** | **Workflow** | **Containerised** | **Host removal** | **Trimming** | **Primer removal** | **Mapping** | **Variant calling** | **Use in the 2026 outbreak** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [artic-network/amplicon-nf](https://github.com/artic-network/amplicon-nf) | ONT (also supports Illumina) | Amplicon | 2.0 | Nextflow | Docker / Singularity | Hostile | fastp / guppyplex | ivar / artic | bwa / minimap2 | ivar / medaka | Nanopore reads, accounting for the large majority of deposited genomes; recommended for the artic-bdbv-2026 scheme |
| [nf-core/viralrecon](https://github.com/nf-core/viralrecon) | Illumina | Capture and enrichment | 2.6.0 | Nextflow | Docker / Singularity | Kraken2 | fastp | — | bowtie2 | ivar / samtools / bcftools | Illumina reads at INRB Kinshasa, covering Twist panel data and Illumina DNA Prep with enrichment |

**Usage.** Of the 1,224 genomes deposited for this outbreak, 1,139 (93%) were sequenced on Oxford Nanopore platforms and 80 (7%) on Illumina, so the Nanopore route accounts for the large majority of consensus generation. All 1,139 record the instrument as GridION, but 1,124 come from a single submitting group, so that value reflects one submission template rather than an independently recorded instrument per run; the distinction between Nanopore devices does not affect the analysis, as they share flow cell chemistry and pipeline. A further 368 genomes (30%) record only a rapid barcoding library preparation, which may be applied to either amplicon or metagenomic material, so for these the consensus route cannot be determined from the submitted metadata.

**Post-consensus quality control.** [raccoon](https://github.com/artic-network/raccoon) and its Nextflow wrapper [raccoon-nf](https://github.com/artic-network/raccoon-nf) are applied to consensus genomes rather than to reads, and perform the quality control and ADAR masking described under [Masking](#masking). The preprint reports raccoon run with default parameters.

> ⚠️ `consensusSequenceSoftwareName` is populated for 5 of 1,224 records, so this section draws on the preprint and the ARTIC guide rather than on submitted metadata. Recording the pipeline and its version at submission would let consensus route be related to genome quality.

---

## Phylogenetic Analysis

The comparison of viral sequences and reconstruction of phylogenetic relationships can support identification of zoonotic spillover events, characterisation of human-to-human transmission dynamics, and detection of emerging variants. For the 2026 BDBV outbreak, early phylogenetic analysis has already indicated a single new spillover event and provided initial estimates of the time to most recent common ancestor (tMRCA). These insights can refine understanding of outbreak epidemiology and inform public health action.

Careful consideration is needed when interpreting sequence relatedness. Genetic proximity between sequences may be consistent with, but cannot be used as evidence for, direct transmission. Phylogenetic results must always be interpreted alongside epidemiological data such as timing, location and contact history. Current limitations include the small number of genomes available and significant geographic bias.

### Alignment

Analyses have used [MAFFT](https://mafft.cbrc.jp/alignment/software/) whole-genome alignment, via the [raccoon](https://github.com/artic-network/raccoon) / [raccoon-nf](https://github.com/artic-network/raccoon-nf) pipeline for QC and masking. [Pathoplexus](https://pathoplexus.org/) also publishes sequences already aligned to the NC_014373 reference, which several groups now use directly.

> ⚠️ **Reference-anchored alignment is preferred.** In a progressive alignment nothing holds an individual sequence to the reference, so a genome with a ragged, N-rich terminus can have its end placed in the wrong columns, appearing downstream as a long branch indistinguishable from genuine divergence. Anchoring each sequence to the reference avoids this and keeps alignment columns equivalent to genomic positions.

### Masking

Two kinds of masking are now standard for this outbreak, and independent groups have converged on them.

**ADAR editing.** ADAR is a host enzyme that converts adenosine to inosine in double-stranded RNA; inosine reads as guanosine, surfacing in these genomes as runs of T→C. Because ADAR is processive, a single editing event leaves a run of changes across tens to hundreds of bases. Counted per site, a single event appears as many independent mutations, inflating branch lengths and creating the appearance of convergent evolution where none has occurred.

The approach that has emerged is to **keep the first edit of each run and mask the rest to N**, rather than discard the genome:

| Source | Criterion | Scope |
|---|---|---|
| [INRB and partners](https://virological.org/t/reproduction-number-of-the-2026-bundibugyo-virus-disease-outbreak-over-time-phylodynamic-estimates-from-genomes-collected-up-to-6-september-2026/1047) | ≥3 T→C, or ≥3 A→G, from the majority base, each within 300 nt | 51 of 680 analysed genomes, 178 positions |
| [Nextstrain BDBV build](https://github.com/nextstrain/ebola) | ≥3 T→C, each within 200 nt, detected on the phylogeny | Replaced an earlier policy of excluding edited genomes (2026-10-19) |

Keeping the first edit records that the event occurred and leaves the branch supported; masking the rest stops one event being counted many times. N is used rather than reverting to the ancestral base, because the unedited state is not observed.

The two criteria differ in more than their window, and the choice has consequences. Detection on the phylogeny treats a run shared by a clade as one event, but sees only a run the topology holds on a single branch: a hypermutated genome pulled toward the root by its own tract has that tract divided across the basal branches, where each piece falls below the minimum run length and escapes masking. Detection against the majority base is immune to that, being independent of the tree, but it counts a shared run once in every genome carrying it, and it will mask chance clusters in any sequence that is simply distant from the consensus.

> ⚠️ Applying both detections, and exempting the sequences used to root the tree, avoids each failure in turn. Rooting sequences are decades divergent, so a few of their T→C differences fall close together by chance — and they are the last sequences that should lose signal.

> ⚠️ Whether A→G should be masked alongside T→C is dataset-specific and worth testing rather than assuming: cluster the changes of each type, then cluster them again with the same changes placed at random positions. In this outbreak's data, T→C clustering exceeds chance roughly fourteen-fold while A→G clustering does not exceed it at all.

**Genome termini.** In a tiled amplicon scheme no primer can sit beyond the end of the template, so terminal bases are primer-derived or absent, and differences there are a property of the protocol rather than of the virus. Retaining them can add several apparent substitutions to a branch and move a genome's position in the tree. INRB and partners mask the last 40 positions; the Nextstrain build masks 50 from each end.

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

Reproduction number estimates are available over the course of the outbreak, from [Delphy](https://github.com/broadinstitute/delphy) and BEAST X analyses of genomes collected to 6 September 2026: R = 1.95 (95% HPD 1.59–2.32) between 1 March and 15 May, before the outbreak was declared, falling to 1.17 (0.87–1.50) for 15 May – 15 June and 0.72 (0.59–0.86) for 15 June – 29 August. BEAST X returns nearly the same values under the primary model. The final period is not uniform: an exploratory division gives 0.92 (0.76–1.09) for 15 June – 1 August and 0.45 (0.20–0.76) for 1 – 29 August. See the [post](https://virological.org/t/reproduction-number-of-the-2026-bundibugyo-virus-disease-outbreak-over-time-phylodynamic-estimates-from-genomes-collected-up-to-6-september-2026/1047) for the caveats, which are substantial.

### Convergent mutations and selection

Recurrent mutations are sometimes interpreted as evidence of adaptation. For this outbreak the available evidence does not support that interpretation, and the conclusion reached is sensitive to the analytical method used.

Testing homoplasy by asking whether carriers of an allele are monophyletic is **rooting-dependent and conflates several things**: convergence, reversion, tree error and missing data all produce non-monophyly. Reconstructing ancestral states and counting substitutions per branch is more direct, and distinguishes a mutation arising on several internal branches — each origin inherited by descendants — from one appearing on terminal branches only, where it cannot be told apart from a sequencing or consensus-calling error.

Applied to this outbreak, recurrence is overwhelmingly on terminal branches, dominated by transitions, and *depleted* rather than enriched for protein-changing substitutions. That is the signature of mutational hotspots and RNA editing, not adaptation, and is consistent with the [100-day window analysis](https://virological.org/t/phylodynamics-and-evolution-of-the-2026-bundibugyo-virus-circulating-in-the-democratic-republic-of-the-congo-insights-from-a-100-day-window-of-genomic-sequencing/1046), which reported no indication of fitness-altering mutations or of any lineage beginning to dominate.

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

> ⚠️ **The Nextstrain `ebola/bdbv` build is subsampled.** Since 2026-09-30 it takes 25 genomes per month and excludes those failing Nextclade QC — currently 183 of the 1,224 available. Suitable for an overview; analyses needing the complete dataset should be built from Pathoplexus directly.

---

## References

### Preprint

- Wawina-Bokalanga T, Akilimali P, Pekar JE, *et al.* (69 authors; senior authors Kraemer MUG, Rambaut A, Mbala-Kingebeni P). **Temporal and Phylodynamic analyses of the 2026 Bundibugyo virus disease outbreak in the Democratic Republic of the Congo.** *medRxiv*, 7 October 2026. [doi:10.64898/2026.10.07.26365001](https://doi.org/10.64898/2026.10.07.26365001)
  Covers 686 PCR-confirmed individuals across 22 health zones, May–August 2026 — background, sample collection, sequencing and analysis. **The primary citation for this outbreak's genomic epidemiology.**

### Virological posts

From INRB Kinshasa and partners unless noted. Listed most recent first.

| Date | Post |
|---|---|
| Oct 2026 | [Temporal and Phylodynamic analyses of the 2026 BVD outbreak in the DRC](https://virological.org/t/temporal-and-phylodynamic-analyses-of-the-2026-bundibugyo-virus-disease-outbreak-in-the-democratic-republic-of-the-congo/1048) — announces the preprint above |
| Oct 2026 | [Reproduction number over time — genomes to 6 September 2026](https://virological.org/t/reproduction-number-of-the-2026-bundibugyo-virus-disease-outbreak-over-time-phylodynamic-estimates-from-genomes-collected-up-to-6-september-2026/1047) — Delphy and BEAST X; ADAR masking criteria; terminal masking |
| Aug 2026 | [Phylodynamics and evolution: insights from a 100-day window](https://virological.org/t/phylodynamics-and-evolution-of-the-2026-bundibugyo-virus-circulating-in-the-democratic-republic-of-the-congo-insights-from-a-100-day-window-of-genomic-sequencing/1046) — evolutionary rate, tMRCA, ADAR handling, rooting by residual minimisation |
| Jul 2026 | [Genomic epidemiology of the ongoing 2026 BVD outbreak in the DRC](https://virological.org/t/genomic-epidemiology-of-the-ongoing-2026-bundibugyo-virus-disease-outbreak-in-the-democratic-republic-of-the-congo/1045) — laboratory and sequencing methods |
| Jun 2026 | [Molecular evolutionary analysis of the current BVD outbreak in DRC and Uganda](https://virological.org/t/molecular-evolutionary-analysis-of-the-current-bundibugyo-virus-disease-outbreak-in-drc-and-uganda/1042) |
| May 2026 | [Initial genomes from the May 2026 BVD outbreak in the DRC and Uganda](https://virological.org/t/initial-genomes-from-may-2026-bundibugyo-virus-disease-outbreak-in-the-democratic-republic-of-the-congo-and-uganda/1032) |

### Tools and resources

- [ARTIC BDBV Sequencing Guide](https://artic.network/viruses/bdbv/bdbv-sequencing-guide.html) · [Primal Scheme Labs](https://labs.primalscheme.com) · [ARTIC Primer Foundry](https://artic.network)
- [amplicon-nf](https://github.com/artic-network/amplicon-nf) — consensus generation; v2 used for the genomes in the posts above
- [raccoon](https://github.com/artic-network/raccoon) — alignment QC and masking
- [nextstrain/ebola](https://github.com/nextstrain/ebola) — build definitions, including the ADAR detection script and masking configuration
- [IQ-TREE 3](http://www.iqtree.org/) · [BEAST X](https://beast.community/) · [Delphy](https://github.com/broadinstitute/delphy) · [MAFFT](https://mafft.cbrc.jp/alignment/software/)
- [This repository](https://github.com/WHO-Collaboratory/collaboratory-ebola-genomics-community) — an open implementation of the alignment, masking and convergence steps described above

---

[← Community home](README.md) · [📊 Live Dashboard](https://who-collaboratory.github.io/collaboratory-ebola-genomics-community/dashboard.html)
