# Lit Review Assistant — Local Landscape Engine

Making literature review easier and understanding concepts and topics in a domain quicker!

## Design

PDF → deterministic parsing → section-aware chunks → embedding model → small LLM → structured evidence → cross-section synthesis → landscape graph.

## Planned stages

1. Parse a seed paper and separate Abstract, Introduction, Methods, Results, Discussion. (COMPLETE)
2. Process each section independently with bounded context. (COMPLETE)
3. Keep section outputs linked by paper ID, section ID, chunk ID, and source location. (COMPLETE)
4. Synthesize section outputs with the Qwen3-1.7B teacher. (COMPLETE)
5. Distill the teacher outputs into a smaller student model (target: Qwen3-0.6B or another compact model). (COMPLETE)
6. Fine-tune the student on the landscape-extraction dataset. 
7. Quantize the final student.
8. Benchmark quality, RAM, CPU, latency, and energy proxies; generate performance plots.

## Modularity / future hidden states

The project will be modular so future hidden states can be added easily with minimal changes to API and frontend.

## Resource principle

The LLM would be on-demand, not continuously running. Parsing, metadata, references, embeddings, chronology, and graph construction would not use the LLM saving memory.

Frontend Test :
https://www.figma.com/make/kLYaxH5b24SXmblR5WBxQv/Liit?code-node-id=0-6&p=f&t=mRIAgQql2GODK5HH-0&fullscreen=1

(Liit)
