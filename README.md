# Lit Review Assistant — Local Landscape Engine

Scientist-controlled literature landscape pipeline.

## Design

PDF → deterministic parsing → section-aware chunks → embedding model → small LLM → structured evidence → cross-section synthesis → landscape graph.

The LLM is not the graph engine. It supplies structured linguistic evidence. Citation extraction, metadata, chronology, similarity, and graph construction remain deterministic/application-controlled.

## Planned stages

1. Parse a seed paper and separate Abstract, Introduction, Methods, Results, Discussion.
2. Process each section independently with bounded context.
3. Keep section outputs linked by paper ID, section ID, chunk ID, and source location.
4. Synthesize section outputs with the Qwen3-1.7B teacher.
5. Distill the teacher outputs into a smaller student model (target: Qwen3-0.6B or another compact model).
6. Fine-tune the student on the landscape-extraction dataset.
7. Quantize the final student.
8. Benchmark quality, RAM, CPU, latency, and energy proxies; generate performance plots.

## Modularity / future hidden states

Every model stage exposes an optional `hidden_state` artifact. Hidden states are disabled by default and are stored separately from textual evidence. This lets us add representation-level features later without redesigning the pipeline.

## Resource principle

The LLM should be on-demand, not continuously running. Parsing, metadata, references, embeddings, chronology, and graph construction should not require the LLM.
