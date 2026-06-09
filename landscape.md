![IPSN logo](img/ipsn.png)

[← Community home](README.md) · [📊 Live Dashboard](https://who-collaboratory.github.io/collaboratory-ebola-genomics-community/dashboard.html)

# Landscape Analysis: BDBV Genomic Sequencing

Genome sequence data can provide valuable information to support surveillance and public health response during Ebola outbreaks. Genomic surveillance can support outbreak investigation by helping assess relatedness between cases, identify possible transmission chains, distinguish between single and multiple zoonotic spillover events, investigate cross-border transmission, and assess potential viral persistence in individuals who have recovered from infection. Genome sequence data are also important for monitoring viral evolution and for supporting the evaluation and ongoing performance of diagnostics, therapeutics and vaccines.

In an effort to help countries navigate the available wet-lab and dry-lab approaches for Bundibugyo virus (BDBV) genomics during the 2026 outbreak in DRC and Uganda, IPSN is collating a landscape analysis of current methods.

We welcome updates either through pull-requests or via issues to this repository.

> **Last updated:** 2026-06-01  
> *Based on: [ARTIC BDBV Sequencing Guide v1.0.0](https://artic.network/viruses/bdbv/bdbv-sequencing-guide.html) and [Initial genomes from May 2026 BDBV outbreak (Virological)](https://virological.org/t/initial-genomes-from-may-2026-bundibugyo-virus-disease-outbreak-in-the-democratic-republic-of-the-congo-and-uganda/1032)*

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
| [Illumina Viral Surveillance Panel V2](https://www.illumina.com/products/by-type/sequencing-kits/library-prep-kits/respiratory-virus-oligos.html) | Illumina | >99% | Used by CPHL (Uganda); BDBV added in V2 |

> ⚠️ Not all viral bait capture panels include BDBV probes. Confirm panel content before use — notably, earlier versions of some panels do not include BDBV.


---

### 2. Amplicon Sequencing

Amplicon-based sequencing works by amplifying overlapping fragments of the viral genome using sets of tiled PCR primers. The resulting amplicons can then be sequenced on short- or long-read platforms. The approach is highly sensitive due to targeted amplification of viral RNA (following reverse transcription), making it suitable for samples with lower viral loads, and is valued for its multiplexing capability, cost-effectiveness and scalability in routine genomic surveillance. The main limitation is dependence on primer performance: as genetic divergence between the circulating virus and the reference genome used for primer design increases, particularly through mutations at primer binding sites, amplification of specific genomic regions can fail, resulting in coverage gaps. Shorter amplicon schemes generally offer greater sensitivity for degraded or low-quality samples, while larger amplicon schemes require higher viral loads but use fewer primer pairs.

Amplicon-based approaches offer lower per-sample cost and higher throughput than bait capture, making them more scalable for routine genomic surveillance.

#### Primer Schemes

| Primer Scheme                                                                                    | Amplicon Size (bp) | Reference            | BDBV 2026 Coverage | Platform       | Availability                                        | Notes                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | ------------------ | -------------------- | ------------------ | -------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [artic-bdbv-2026/400/v1.0.0](https://labs.primalscheme.com/detail/artic-bdbv-2026/400/v1.0.0/)   | 400                | 2026 epidemic strain | Pending validation | Illumina / ONT | [Primal Scheme Labs](https://labs.primalscheme.com) | Designed specifically for 2026 epidemic strain; validation underway at INRB;                                                   |
| [artic-pan-ebola/1000/v1.0.0](https://labs.primalscheme.com/detail/artic-pan-ebola/1000/v1.0.0/) | 1000               | Pan-Ebolavirus       | ~50–70%            | Illumina / ONT | [Primal Scheme Labs](https://labs.primalscheme.com) | Tested in DRC and Bernard Nocht; **Insufficient for routine genomic epidemiology at this coverage - v2.0.0 under development** |

> The BDBV-specific scheme (artic-bdbv-2026/400/v1.0.0) is expected to generate the best results across a broad range of sample Ct values and viral titres. Schemes can be requested directly from ARTIC at no cost including shipping via the [ARTIC Primer Foundry](https://artic.network).

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

**Alignment strategy.** All Bundibugyo outbreak analyses have used [MAFFT](https://mafft.cbrc.jp/alignment/software/) -based whole-genome multiple sequence alignment via the [raccoon](https://github.com/artic-network/raccoon) / [raccoon-nf](https://github.com/artic-network/raccoon-nf) pipeline

**Masking.** ADAR-driven hypermutation (T→C transitions in intergenic regions) has been observed in initial 2026 genomes and may need to be masked prior to phylogenetic inference to avoid spurious branch lengths.

**Temporal inference.** Because BDBV has a limited number of genomes and a narrow temporal range of sampling, time-calibrated analyses currently require a fixed substitution rate. Initial analyses have used rates of 1.2–1.9 × 10⁻³ substitutions/site/year, based on prior estimates from the 2014–2016 EBOV epidemic; the resulting tMRCA range should be interpreted accordingly.

## Data Sharing

WHO strongly encourages countries and laboratories to share genome sequence data and associated metadata, and where appropriate and feasible, raw sequence data, through publicly accessible databases in a timely manner to support global surveillance and risk assessment.

All BDBV genomes from the 2026 outbreak are being deposited in [Pathoplexus](https://pathoplexus.org/), which now supports BDBV sequences.  A phylogenetic representation of the BDBV genomes is being maintained by [Nextstrain](https://nextstrain.org/ebola/bdbv) and curated by INRB colleagues.

---

[← Community home](README.md) · [📊 Live Dashboard](https://who-collaboratory.github.io/collaboratory-ebola-genomics-community/dashboard.html)
