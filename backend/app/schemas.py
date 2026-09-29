"""Pydantic schemas: API boundary. No scientific judgments here."""
from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""


class Project(BaseModel):
    id: str
    name: str
    description: str = ""
    created_at: str
    updated_at: str


class PaperCreate(BaseModel):
    title: str = "UNSET"
    authors: list[str] = []
    journal: str = ""
    year: Optional[int] = None
    doi: str = ""
    pmid: str = ""
    arxiv_id: str = ""
    abstract: str = ""
    source_pdf_path: str = ""
    discovery_source_type: str = "direct_import"


class Paper(BaseModel):
    id: str
    project_id: str
    title: str
    authors: list[str] = []
    journal: str = ""
    year: Optional[int] = None
    doi: str = ""
    pmid: str = ""
    arxiv_id: str = ""
    abstract: str = ""
    source_pdf_path: str = ""
    discovery_source_type: str = "direct_import"
    source_paper_id: str = ""
    query_id: str = ""
    extraction_status: str = "pending"
    parsing_warnings: list[Any] = []
    # Project-collection membership: true only when the researcher
    # explicitly added this paper (upload/import/Add to Project).
    in_project: bool = True
    # Free full-text link recorded by the source ("" = none known).
    pdf_url: str = ""
    # Publication types as reported by the source ([] = unavailable;
    # never inferred).
    pub_types: list[str] = []
    created_at: str
    updated_at: str


class ProcessingStatus(BaseModel):
    paper_id: str
    extraction_status: str
    parsing_warnings: list[Any] = []
    source_pdf_path: str = ""


class PaperSection(BaseModel):
    name: str
    items: list[Any] = []


class PaperChunk(BaseModel):
    chunk_id: str
    section: str
    subsection: str = ""
    text: str
    source_start: str = ""
    source_end: str = ""
    token_estimate: int = 0
    char_count: int = 0
    text_hash: str = ""


class EvidenceItem(BaseModel):
    id: str
    paper_id: str
    chunk_id: str
    category: str
    text: str
    section: str = ""
    subsection: str = ""
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    location_status: str = "known"
    status: str = "explicit"
    schema_version: str = "1.0"
    model_name: str = ""
    prompt_version: str = "1.0"
    created_at: str


class ExtractRequest(BaseModel):
    force: bool = False
    limit: Optional[int] = None
    chunk_ids: Optional[list[str]] = None


class ExtractionStats(BaseModel):
    paper_id: str
    status: str
    chunks_total: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped_cached: int = 0
    evidence_items: int = 0
    json_failures: int = 0
    provenance_failures: int = 0
    repair_attempts: int = 0
    repair_successes: int = 0
    model: str = ""
    prompt_version: str = "1.0"
    schema_version: str = "1.0"
    duration_seconds: float = 0.0
    warnings: list[Any] = []


class ExtractionRunStatus(BaseModel):
    """Truthful latest-attempt extraction state per current chunk,
    aggregated read-only from `chunk_extractions`.
    run: not_run | complete | partial | failed."""
    paper_id: str
    run: str
    chunks_total: int = 0
    succeeded: int = 0
    failed: int = 0
    not_attempted: int = 0
    error: str = ""


class SynthesisSource(BaseModel):
    evidence_id: str
    chunk_id: str = ""
    section: str = ""
    subsection: str = ""
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    location_status: str = "known"


class SynthesisItem(BaseModel):
    text: str
    evidence_ids: list[str] = []
    sources: list[SynthesisSource] = []


class PaperSynthesis(BaseModel):
    paper_id: str
    synthesis_status: str
    synthesis: dict[str, list[SynthesisItem]] = {}
    error: str = ""
    schema_version: str = "1.0"
    model_name: str = ""
    prompt_version: str = "1.0"
    input_tokens: int = 0
    model_calls: int = 0
    created_at: str
    updated_at: str


class SynthesizeRequest(BaseModel):
    force: bool = False


class SynthesisStats(BaseModel):
    paper_id: str
    status: str
    cached: bool = False
    model: str = ""
    prompt_version: str = "1.0"
    schema_version: str = "1.0"
    model_calls: int = 0
    repair_attempts: int = 0
    input_tokens: int = 0
    fields_populated: int = 0
    duration_seconds: float = 0.0
    hierarchical: bool = False
    warnings: list[Any] = []


class MetadataField(BaseModel):
    value: Any = None
    source: str = "unknown"
    candidates: list[Any] = []


class PaperMetadata(BaseModel):
    paper_id: str
    fields: dict[str, MetadataField] = {}


class Reference(BaseModel):
    id: str
    paper_id: str
    ref_index: int = 0
    raw_text: str = ""
    title: str = ""
    authors: list[str] = []
    year: Optional[int] = None
    journal: str = ""
    doi: str = ""
    pmid: str = ""
    arxiv_id: str = ""
    source_page: Optional[int] = None
    resolution_status: str = "unresolved"
    resolved_paper_id: str = ""
    created_at: str


class ReferenceStats(BaseModel):
    paper_id: str
    status: str
    references: int = 0
    resolved: int = 0
    unresolved: int = 0
    ambiguous: int = 0
    edges: int = 0
    warnings: list[Any] = []


class CitationEdge(BaseModel):
    source_paper_id: str
    target_paper_id: str
    relationship: str = "cites"
    source: str = "reference_extraction"
    status: str = "resolved"
    created_at: str


class Citations(BaseModel):
    outgoing: list[CitationEdge] = []
    incoming: list[CitationEdge] = []


class EmbedRequest(BaseModel):
    force: bool = False


class EmbeddingStats(BaseModel):
    paper_id: str
    status: str
    cached: bool = False
    model: str = ""
    embedding_version: str = "1.0"
    dim: int = 0
    duration_seconds: float = 0.0
    warnings: list[Any] = []


class EmbeddingStatus(BaseModel):
    paper_id: str
    status: str = "pending"
    error: str = ""
    embeddings: list[Any] = []


class SimilarityPair(BaseModel):
    paper_a: str
    paper_b: str
    similarity: float = 0.0
    embedding_model: str = ""
    embedding_version: str = "1.0"
    created_at: str


class ProjectSimilarity(BaseModel):
    project_id: str
    pairs: list[SimilarityPair] = []
    computed: int = 0
    skipped: list[Any] = []


class DiscoveryItem(BaseModel):
    type: str = ""
    query: str = ""
    source_paper_id: str = ""
    search_id: str = ""
    external_id: str = ""
    # Database the route ran through (pubmed | arxiv), joined from the
    # persisted search row; "" for routes that are not searches.
    source: str = ""


class LandscapeNode(BaseModel):
    id: str
    type: str = "paper"
    title: str = ""
    authors: list[str] = []
    year: Optional[int] = None
    journal: str = ""
    doi: str = ""
    pmid: str = ""
    arxiv_id: str = ""
    discovery_source: str = ""
    discovery: list[DiscoveryItem] = []
    metadata_only: bool = False
    embedding_status: str = "pending"
    concepts: list[str] = []
    methods: list[str] = []
    # Workspace fields: discovered != added-to-project.
    in_project: bool = True
    abstract: str = ""
    # Free full-text link when the source recorded one ("" = none known).
    pdf_url: str = ""
    # Publication types from the source ([] = unavailable).
    pub_types: list[str] = []
    # True/False when the source typed the record, None = unavailable
    # (never assumed "not retracted").
    retracted: Optional[bool] = None
    # No citation-count source exists in this app: always null
    # ("Citation count unavailable"), never a fabricated 0.
    citation_count: Optional[int] = None
    created_at: str = ""


class LandscapeEdge(BaseModel):
    source: str
    target: str
    relationship: str
    status: str = ""
    similarity: Optional[float] = None
    # How the relationship was obtained (reference_extraction |
    # pubmed_citedin); "" for arithmetic semantic_similarity edges.
    mechanism: str = ""


class LandscapeChannel(BaseModel):
    """One discovery channel outcome of the latest automatic build."""
    channel: str
    source: str = ""
    status: str = "pending"  # complete | partial | skipped | error
    detail: str = ""
    query: str = ""
    search_id: str = ""
    retrieved: int = 0
    created: int = 0
    edged: int = 0
    below_threshold: int = 0
    duplicates: int = 0
    excluded_self: int = 0
    skipped: int = 0
    unresolved: int = 0
    resolved: int = 0
    edges: int = 0
    error: str = ""
    errors: list[str] = []


class LandscapeStatus(BaseModel):
    """Truthful state of the automatic landscape build (no fake
    percentages: only real steps and per-channel outcomes)."""
    project_id: str
    seed_paper_id: str = ""
    status: str = "idle"  # idle | running | complete | error
    step: str = ""
    channels: list[LandscapeChannel] = []
    policy: dict[str, Any] = {}
    error: str = ""
    started_at: str = ""
    updated_at: str = ""


class DiscoverRequest(BaseModel):
    seed_paper_id: str = ""


class CollectionAddRequest(BaseModel):
    """Bulk [Add to Project]: explicit membership for named papers only."""
    paper_ids: list[str] = Field(min_length=1)


class CollectionAddResponse(BaseModel):
    project_id: str
    project_name: str
    added: int = 0
    already_in_project: int = 0
    not_found: list[str] = []


class Landscape(BaseModel):
    project_id: str
    nodes: list[LandscapeNode] = []
    edges: list[LandscapeEdge] = []


class SearchRequest(BaseModel):
    query: str = ""
    max_results: int = 20
    year_min: Optional[int] = None
    year_max: Optional[int] = None


class SearchResultItem(BaseModel):
    external_id: str = ""
    source: str = ""
    pmid: str = ""
    doi: str = ""
    arxiv_id: str = ""
    title: str = ""
    authors: list[str] = []
    journal: str = ""
    year: Optional[int] = None
    abstract: str = ""
    pdf_url: str = ""
    rank: int = 0
    discovery_source: Any = None
    # Publication types as reported by the source ([] = unavailable).
    pub_types: list[str] = []


class SearchResponse(BaseModel):
    search_id: str = ""
    project_id: str = ""
    source: str = ""
    query: str = ""
    result_count: int = 0
    status: str = ""
    error: str = ""
    results: list[SearchResultItem] = []


class SearchHistoryItem(BaseModel):
    id: str = ""
    project_id: str = ""
    source: str = ""
    query: str = ""
    max_results: int = 20
    result_count: int = 0
    status: str = ""
    error: str = ""
    created_at: str


class ImportRequest(BaseModel):
    project_id: str
    search_id: str
    external_id: str


class ImportResponse(BaseModel):
    paper_id: str = ""
    created: bool = False
    discovery_source_type: str = ""
    embedding: Any = None
    references_resolved: int = 0
    similarity_computed: int = 0
    similarity_skipped: list[Any] = []
    warnings: list[Any] = []


class TutorRequest(BaseModel):
    """Contextual tutor ask (beta). `text` is the researcher's selection,
    preserved verbatim; `context` is the surrounding paragraph (bounded,
    its role stated in the prompt). Nothing here triggers automatically."""
    paper_id: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=30000)
    context: str = Field(default="", max_length=10000)
    section: str = ""
    subsection: str = ""
    page: Optional[int] = None
    evidence_id: str = ""


class TutorResponse(BaseModel):
    """One explanation. status: ok | insufficient | error | unavailable.
    Nothing is persisted — the answer exists only in this response."""
    paper_id: str
    status: str = "ok"
    explanation: str = ""
    error: str = ""
    model: str = ""
    prompt_version: str = "1.0"
    duration_seconds: float = 0.0
    section: str = ""
    subsection: str = ""
    page: Optional[int] = None
    evidence_id: str = ""
    truncated: bool = False
