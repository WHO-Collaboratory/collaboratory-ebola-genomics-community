![IPSN logo](img/ipsn.png)

[← Community home](README.md) · [📊 Live Dashboard](https://who-collaboratory.github.io/collaboratory-ebola-genomics-community/dashboard.html)

# Landscape Analysis: BDBV Genomic Sequencing

In an effort to help countries navigate the available wet-lab and dry-lab approaches for Bundibugyo virus (BDBV) genomics during the 2026 outbreak in DRC and Uganda, IPSN is collating a landscape analysis of current methods.

We welcome updates either through pull-requests or via issues to this repository.

> **Last updated:** 2026-06-01  
> *Based on: [ARTIC BDBV Sequencing Guide v1.0.0](https://artic.network/viruses/bdbv/bdbv-sequencing-guide.html) and [Initial genomes from May 2026 BDBV outbreak (Virological)](https://virological.org/t/initial-genomes-from-may-2026-bundibugyo-virus-disease-outbreak-in-the-democratic-republic-of-the-congo-and-uganda/1032)*

---

## Sequencing Approaches

Three broad approaches are currently in use or under evaluation for BDBV genomic sequencing. These differ in cost, coverage, required infrastructure, and suitability across sample Ct ranges.

### 1. Bait Capture Sequencing

Bait capture has generated the initial genomes from this outbreak and is currently the recommended approach for samples with Ct 17–25, achieving >99% genome coverage.

| Kit | Platform | Coverage (Ct 17–25) | Notes |
|---|---|---|---|
| [Twist Comprehensive Viral Research Panel](https://www.twistbioscience.com/products/ngs/fixed-panels/comprehensive-viral-research-panel) | Illumina | >99% | Used by INRB (DRC); includes BDBV probes |
| [Illumina Viral Surveillance Panel V2](https://www.illumina.com/products/by-type/sequencing-kits/library-prep-kits/respiratory-virus-oligos.html) | Illumina | >99% | Used by CPHL (Uganda); BDBV added in V2 |

> ⚠️ Not all viral bait capture panels include BDBV probes. Confirm panel content before use — notably, earlier versions of some panels do not include BDBV.

Bait capture data can be assembled *de novo* at high coverage using standard tools such as metaSPAdes or MEGAHIT.

---

### 2. Amplicon Sequencing

Amplicon-based approaches offer lower per-sample cost and higher throughput than bait capture, making them more scalable for routine genomic surveillance.

#### Primer Schemes

| Primer Scheme                                                                                    | Amplicon Size (bp) | Reference            | BDBV 2026 Coverage                 | Platform       | Availability                                        | Notes                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ------------------ | -------------------- | ---------------------------------- | -------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [artic-bdbv-2026/400/v1.0.0](https://labs.primalscheme.com/detail/artic-bdbv-2026/400/v1.0.0/)   | 400                | 2026 epidemic strain | Expected high (pending validation) | Illumina / ONT | Free on request from Artic                          | Designed specifically for 2026 epidemic strain; validation underway at INRB; **recommended once available** |
| [artic-pan-ebola/1000/v2.0.0](https://labs.primalscheme.com/detail/artic-pan-ebola/1000/v1.0.0/) | 1000               | Pan-Ebolavirus       | TBC                                | Illumina / ONT | Free on request from Artic                          | Updated pan-Ebola scheme; broader coverage than v1                                                          |
| [artic-pan-ebola/1000/v1.0.0](https://labs.primalscheme.com/detail/artic-pan-ebola/1000/v1.0.0/) | 1000               | Pan-Ebolavirus       | ~50–70%                            | Illumina / ONT | [Primal Scheme Labs](https://labs.primalscheme.com) | Tested in DRC and Bernard Nocht; insufficient for routine genomic epidemiology at this coverage             |

> The BDBV-specific scheme (artic-bdbv-2026/400/v1.0.0) is expected to generate the best results across a broad range of sample Ct values and viral titres. Schemes can be requested directly from ARTIC at no cost including shipping via the [ARTIC Primer Foundry](https://artic.network).

---

### 3. Metagenomics

Metagenomics does not require prior knowledge of the pathogen sequence and may be especially useful for diagnostically ambiguous samples or for detection of co-circulating pathogens.

| Protocol | Recommended Ct | Platform | Notes |
|---|---|---|---|
| [SMART-9N](https://www.protocols.io/view/viral-metagenomics-using-smart-9n-amplification-an-j8nlke5wwl5r/v1) | <20 (genomes may be recovered up to Ct 30) | Illumina / ONT | SISPA-based; optimised for viral RNA; primers available on request from ARTIC |

> Metagenomics is particularly valuable when there is diagnostic uncertainty about the causative agent, or when new strains of Ebolavirus or other haemorrhagic fevers may be co-circulating.

---

## Bioinformatic Workflows for Consensus Generation

### Bait Capture

| Pipeline | Platform | Workflow | Notes |
|---|---|---|---|
| [nf-core/viralrecon](https://github.com/nf-core/viralrecon) | Illumina | Nextflow | Used successfully by INRB for Twist panel data; Docker/Singularity containerised |
| metaSPAdes / MEGAHIT | Illumina | Stand-alone | For de novo assembly at high coverage |

### Amplicon Sequencing

| Pipeline | Platform | Workflow | Containerised | Notes |
|---|---|---|---|---|
| [artic-network/amplicon-nf](https://github.com/artic-network/amplicon-nf) | Illumina / ONT | Nextflow | Docker / Singularity | Recommended by ARTIC for both platforms; tutorials available on [ARTIC website](https://artic.network/resources/amplicon-nf) and [GitHub](https://github.com/artic-network/amplicon-nf/tree/main/docs) |

> Use a BDBV 2026 epidemic reference strain as the mapping reference for variant calling. Refer to the [ARTIC website](https://artic.network) for the recommended reference.

---

## Phylogenetic Analysis

Standard phylogenetic approaches work well for BDBV. The number of genomes is expected to remain within the practical limits of desktop tools for the near future.

### Recommended Workflow

| Step | Tool | Notes |
|---|---|---|
| Multiple sequence alignment | [MAFFT](https://mafft.cbrc.jp/alignment/software/) | Standard approach; well suited to current genome numbers |
| ML phylogeny | [IQ-TREE2](https://iqtree.github.io) | HKY+gamma model used in initial outbreak analysis; ultrafast bootstrap supported |
| Integrated QC + phylogeny | [raccoon](https://github.com/artic-network/raccoon) / [raccoon-nf](https://github.com/artic-network/raccoon-nf) | Combines alignment, QC, and HTML report generation; runs within ONT EPI2ME (no command-line needed); tutorial at [artic.network](https://artic.network/tutorials/raccoon-nf.html) |
| Tree visualisation | [PearTree](https://peartree.live) | Desktop app or zero-install web app; used in Virological outbreak reports |
| Temporal / phylodynamic | [TreeTime](https://github.com/neherlab/treetime) | Powers Nextstrain BDBV updates; estimates tMRCA |
| Comprehensive phylodynamics | [BEAST v10.5](http://beast.community) | Estimates tMRCA, epidemic growth rate, spatial spread; used in initial BDBV outbreak analysis |

## Data Sharing

All BDBV genomes from the 2026 outbreak are being deposited in [Pathoplexus](https://pathoplexus.org/), which now supports BDBV sequences.


## Genome Quality Considerations

The following quality issues have been identified in initial BDBV genomes from the 2026 outbreak and should be considered during analysis:

- **ADAR editing events** — tracts of T→C mutations within short spans (e.g., positions 4165–4191 in one genome) in intergenic regions; affected positions should be masked. This phenomenon has been observed in previous Ebolavirus outbreaks.
- **Geographic bias** — current genomes are predominantly from Bunia; tMRCA and other phylodynamic estimates should be interpreted with caution until genomes from the wider epidemic area are available.

---

[← Community home](README.md) · [📊 Live Dashboard](https://who-collaboratory.github.io/collaboratory-ebola-genomics-community/dashboard.html)
