"""Lex-Brain v3 FastAPI service — full brain architecture with knowledge graph."""

import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from pymilvus import utility

from config import get_config, DATA_DIR
from models import (
    # V1 models (backward compatibility)
    ConversationIngestRequest, DocumentIngestRequest, ManualIngestRequest,
    RecallRequest, RecallResponse, MemoryResponse, StatusResponse, IngestResponse,
    # V2 models
    CollectionIngestRequest, MultiCollectionRecallRequest, BootRecallRequest,
    V2MemoryResponse, V2RecallResponse, V2StatusResponse,
    # Skill models
    SkillIngestRequest, SkillRecallRequest, SkillResponse, SkillRecallResponse, SkillStatusResponse
)
from milvus_client import ensure_collection, get_collection, connect  # V1 client
from milvus_client_v2 import ensure_all_collections, get_collection as get_v2_collection, get_collection_stats, migrate_old_collection
from embedding import get_embedding
from ner import extract_ner, score_significance
from utils import (
    chunk_text, estimate_tokens, recency_score, reference_density,
    now_ms, iso_to_ms, ms_to_iso, format_memory_prefix
)
from compress import run_compression
from graph_manager import GraphManager
from beliefs_manager import BeliefsManager
from enhanced_search import EnhancedSearchManager
from reflection_engine import ReflectionEngine


# Global manager instances
graph_manager = None
beliefs_manager = None
enhanced_search = None
reflection_engine = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global graph_manager, beliefs_manager, enhanced_search, reflection_engine
    
    # Initialize v1 collection for backward compatibility
    ensure_collection()
    
    # Initialize all v2 collections
    ensure_all_collections()
    
    # Migrate old data if needed
    migrate_old_collection()
    
    # Initialize Neo4j graph manager
    neo4j_url = os.getenv("NEO4J_URL", "bolt://localhost:7687")
    neo4j_user = os.getenv("NEO4J_USER", "neo4j")
    neo4j_password = os.getenv("NEO4J_PASSWORD", "lexbrain2026")
    
    try:
        graph_manager = GraphManager(neo4j_url, neo4j_user, neo4j_password)
        # Migrate from entity-graph.json if it exists
        entity_graph_path = os.path.join(DATA_DIR, "entity-graph.json")
        if os.path.exists(entity_graph_path):
            await migrate_entity_graph(entity_graph_path)
    except Exception as e:
        print(f"Warning: Could not initialize Neo4j graph manager: {e}")
        graph_manager = None
    
    # Initialize Beliefs manager
    milvus_host = os.getenv("MILVUS_HOST", "localhost")
    milvus_port = int(os.getenv("MILVUS_PORT", "19530"))
    
    try:
        beliefs_manager = BeliefsManager(milvus_host, milvus_port, DATA_DIR)
        print("Beliefs manager initialized successfully")
    except Exception as e:
        print(f"Warning: Could not initialize beliefs manager: {e}")
        beliefs_manager = None
    
    # Initialize Enhanced Search manager
    try:
        enhanced_search = EnhancedSearchManager(DATA_DIR, graph_manager)
        print("Enhanced search manager initialized successfully")
        # Run collection cleanup
        enhanced_search.cleanup_collections()
    except Exception as e:
        print(f"Warning: Could not initialize enhanced search manager: {e}")
        enhanced_search = None
    
    # Initialize Reflection Engine
    # LLM_URL / OLLAMA_URL: the endpoint for the brain's local LLM (Ollama or llama.cpp).
    # LLM_BACKEND: "ollama" (default) or "openai" (for llama.cpp / vLLM / LiteLLM).
    llm_url = os.getenv("LLM_URL") or os.getenv("OLLAMA_URL", "http://localhost:11434")
    llm_backend = os.getenv("LLM_BACKEND", "ollama")

    try:
        reflection_engine = ReflectionEngine(
            DATA_DIR, graph_manager, beliefs_manager, enhanced_search,
            ollama_url=llm_url, llm_backend=llm_backend
        )
        print("Reflection engine initialized successfully")
    except Exception as e:
        print(f"Warning: Could not initialize reflection engine: {e}")
        reflection_engine = None
    
    os.makedirs(DATA_DIR, exist_ok=True)
    yield
    
    # Cleanup
    if graph_manager:
        graph_manager.close()


async def migrate_entity_graph(entity_graph_path: str):
    """Migrate the old entity-graph.json to Neo4j"""
    if graph_manager:
        try:
            result = graph_manager.migrate_from_entity_graph(entity_graph_path)
            print(f"Migrated entity graph: {result}")
            # Move the old file to backup
            backup_path = entity_graph_path.replace('.json', '.json.migrated')
            os.rename(entity_graph_path, backup_path)
        except Exception as e:
            print(f"Entity graph migration failed: {e}")


# Status cache
_status_cache: dict = {"data": None, "ts": 0}
_STATUS_TTL = 60  # seconds

# Request models for endpoints that need JSON body
class GraphQueryRequest(BaseModel):
    query: str
    parameters: Optional[Dict[str, Any]] = None

class HybridSearchRequest(BaseModel):
    query: str
    collection: str = "memory"
    vector_weight: float = 0.6
    keyword_weight: float = 0.4
    top_k: int = 20
    domain: Optional[str] = None
    kind: Optional[str] = None
    min_confidence: float = 0.0

app = FastAPI(title="Lex-Brain v3", version="3.0.0", lifespan=lifespan)


# ═══ V1 ENDPOINTS (Backward Compatibility) ═══════════════════════════════════

@app.post("/ingest/conversation", response_model=IngestResponse)
async def ingest_conversation_v1(req: ConversationIngestRequest):
    cfg = get_config()
    chunks = chunk_text(req.content, max_tokens=500, overlap_tokens=50)
    col = get_v2_collection("memory")
    ids = []
    ts = iso_to_ms(req.timestamp)
    created = now_ms()

    for chunk in chunks:
        mem_id = str(uuid.uuid4())
        embedding = await get_embedding(chunk)
        ner_result = await extract_ner(chunk)
        sig = await score_significance(chunk)

        col.insert([
            [mem_id], [embedding], [chunk], ["episodic"],
            [ner_result["domains"]], [ner_result["entities"]],
            [sig], [0], [ts], [created],
            [""], ["hot"], [False], [""],
            [req.participants], [req.source]
        ])
        ids.append(mem_id)

    col.flush()
    return IngestResponse(ids=ids, count=len(ids))


@app.post("/ingest/document", response_model=IngestResponse)
async def ingest_document_v1(req: DocumentIngestRequest):
    chunks = chunk_text(req.content, max_tokens=500, overlap_tokens=50)
    col = get_v2_collection("memory")
    ids = []
    ts = iso_to_ms(req.timestamp)
    created = now_ms()

    for chunk in chunks:
        mem_id = str(uuid.uuid4())
        embedding = await get_embedding(chunk)
        if req.skip_ner:
            ner_result = {"entities": [], "domains": ["general"]}
        else:
            ner_result = await extract_ner(chunk)

        col.insert([
            [mem_id], [embedding], [chunk], ["semantic"],
            [ner_result["domains"]], [ner_result["entities"]],
            [0.5], [0], [ts], [created],
            [""], ["hot"], [req.skip_ner], [""],
            [[]], [req.source]
        ])
        ids.append(mem_id)

    col.flush()
    return IngestResponse(ids=ids, count=len(ids))


@app.post("/ingest/manual", response_model=IngestResponse)
async def ingest_manual_v1(req: ManualIngestRequest):
    col = get_v2_collection("memory")
    mem_id = str(uuid.uuid4())
    embedding = await get_embedding(req.content)
    ts = iso_to_ms(req.timestamp)
    created = now_ms()

    # Use provided entities/domains or extract
    entities = req.entities
    domains = req.domains
    if not entities or not domains:
        ner_result = await extract_ner(req.content)
        if not entities:
            entities = ner_result["entities"]
        if not domains:
            domains = ner_result["domains"]

    sig = min(req.significance, get_config()["significance"]["ingest_cap"])

    col.insert([
        [mem_id], [embedding], [req.content], [req.kind.value],
        [domains], [entities],
        [sig], [0], [ts], [created],
        [""], ["hot"], [False], [""],
        [[]], [req.source]
    ])
    col.flush()
    return IngestResponse(ids=[mem_id], count=1)


@app.post("/recall", response_model=RecallResponse)
async def recall_v1(req: RecallRequest):
    # Use the existing v1 recall logic but with the new memory collection
    cfg = get_config()
    recall_cfg = cfg["recall"]
    weights = recall_cfg["weights"]
    token_budget = req.token_budget or recall_cfg["token_budget"]
    top_k = recall_cfg["top_k"]

    query_embedding = await get_embedding(req.query)

    # Build filter expression
    filters = ['superseded_by == ""']
    if not req.include_cold:
        filters.append('tier != "cold"')
    if req.domain:
        filters.append(f'array_contains(domains, "{req.domain}")')
    if req.entity:
        filters.append(f'array_contains(entities, "{req.entity}")')
    if req.days:
        cutoff = now_ms() - (req.days * 86400 * 1000)
        filters.append(f'temporal >= {cutoff}')

    expr = " and ".join(filters) if filters else ""

    col = get_v2_collection("memory")
    search_params = {"metric_type": "COSINE", "params": {"ef": 128}}
    results = col.search(
        data=[query_embedding],
        anns_field="vector",  # memory collection uses "vector" not "embedding"
        param=search_params,
        limit=top_k,
        expr=expr,
        output_fields=["id", "content", "kind", "domains", "entities",
                        "significance", "reference_count", "temporal", "tier"]
    )

    # Re-rank (same logic as v1)
    candidates = []
    for hits in results:
        for hit in hits:
            entity = hit.entity
            sim = hit.score  # cosine similarity
            fields = entity.fields if hasattr(entity, 'fields') else entity
            def _get(key, default=None):
                try:
                    v = fields[key] if isinstance(fields, dict) else getattr(fields, key, default)
                    return v if v is not None else default
                except (KeyError, AttributeError):
                    return default
            sig = _get("significance", 0.4)
            temporal = _get("temporal", 0)
            kind = _get("kind", "semantic")
            ref_count = _get("reference_count", 0)
            rec = recency_score(temporal, kind)
            ref_d = reference_density(ref_count)

            composite = (
                weights["similarity"] * sim +
                weights["significance"] * sig +
                weights["recency"] * rec +
                weights["reference_density"] * ref_d
            )
            candidates.append({
                "id": _get("id", ""),
                "content": _get("content", ""),
                "kind": kind,
                "domains": _get("domains", []),
                "entities": _get("entities", []),
                "significance": sig,
                "reference_count": ref_count,
                "temporal": temporal,
                "tier": _get("tier", ""),
                "score": composite,
            })

    candidates.sort(key=lambda x: x["score"], reverse=True)

    # Token budget packing
    packed = []
    total_tokens = 0
    for c in candidates:
        prefix = format_memory_prefix(c["kind"], c["domains"], c["temporal"])
        text = f"{prefix} {c['content']}"
        tokens = estimate_tokens(text)
        if total_tokens + tokens > token_budget:
            continue
        total_tokens += tokens
        packed.append(MemoryResponse(
            id=c["id"],
            content=c["content"],
            kind=c["kind"],
            domains=c["domains"],
            entities=c["entities"],
            significance=c["significance"],
            reference_count=c["reference_count"],
            temporal=ms_to_iso(c["temporal"]),
            tier=c["tier"],
            score=round(c["score"], 4),
        ))

    return RecallResponse(memories=packed, total_tokens=total_tokens, query=req.query)


@app.get("/status", response_model=StatusResponse)
async def status_v1():
    global _status_cache
    now = time.time()
    if _status_cache["data"] and (now - _status_cache["ts"]) < _STATUS_TTL:
        return _status_cache["data"]

    col = get_v2_collection("memory")
    total = col.num_entities

    by_kind = {}
    for kind in ["episodic", "semantic", "procedural"]:
        try:
            count = len(col.query(expr=f'kind == "{kind}"', output_fields=["id"], limit=16384))
        except Exception:
            count = 0
        by_kind[kind] = count

    by_tier = {}
    for tier in ["hot", "warm", "cool", "cold"]:
        try:
            count = len(col.query(expr=f'tier == "{tier}"', output_fields=["id"], limit=16384))
        except Exception:
            count = 0
        by_tier[tier] = count

    last_comp = None
    meta_path = os.path.join(DATA_DIR, "last-compression.json")
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
            last_comp = meta.get("last_run")

    result = StatusResponse(
        total_memories=total,
        by_kind=by_kind,
        by_tier=by_tier,
        last_compression=last_comp
    )
    _status_cache = {"data": result, "ts": now}
    return result


# ═══ V2 ENDPOINTS (New Multi-Collection API) ═════════════════════════════════

@app.post("/v2/ingest/{collection}", response_model=IngestResponse)
async def ingest_v2(collection: str, req: CollectionIngestRequest):
    """Ingest text into a specific collection."""
    if collection not in ["soul_persona", "agent_system", "context_briefing", 
                         "heartbeat_tasks", "skills_knowledge", "skills", "memory"]:
        raise HTTPException(status_code=400, detail=f"Invalid collection: {collection}")
    
    col = get_v2_collection(collection)
    mem_id = str(uuid.uuid4())
    embedding = await get_embedding(req.text)
    ts = iso_to_ms(req.timestamp) if req.timestamp else now_ms()
    created = now_ms()
    
    if collection == "memory":
        # Special handling for memory collection (existing schema)
        ner_result = await extract_ner(req.text)
        sig = await score_significance(req.text)
        
        col.insert([
            [mem_id], [embedding], [req.text], ["semantic"],
            [ner_result["domains"]], [ner_result["entities"]],
            [sig], [0], [ts], [created],
            [""], ["hot"], [False], [""],
            [[]], [req.source]
        ])
    elif collection == "soul_persona":
        col.insert([
            [mem_id], [req.text], [embedding], [req.category], [created], [req.source]
        ])
    elif collection == "agent_system":
        col.insert([
            [mem_id], [req.text], [embedding], [req.category], 
            [created], [created], [""], [True], [req.source]
        ])
    elif collection == "context_briefing":
        col.insert([
            [mem_id], [req.text], [embedding],
            [req.metadata.get("conversation_id", "")],
            [req.metadata.get("participants", "")],
            [req.metadata.get("channel", "")],
            [req.metadata.get("thread_id", "")],
            [created], [created], [True]
        ])
    elif collection == "heartbeat_tasks":
        col.insert([
            [mem_id], [req.text], [embedding],
            [req.metadata.get("task_type", "one-shot")],
            [req.metadata.get("status", "active")],
            [req.metadata.get("due_at", "")],
            [created], [0], [req.source]
        ])
    elif collection == "skills_knowledge":
        col.insert([
            [mem_id], [req.text], [embedding],
            [req.metadata.get("skill_name", "general")],
            [req.category], [created], [created], [1.0], [req.source]
        ])
    
    col.flush()
    return IngestResponse(ids=[mem_id], count=1)


@app.post("/v2/recall/{collection}", response_model=V2RecallResponse)
async def recall_single_collection_v2(collection: str, req: RecallRequest):
    """Query a specific collection."""
    if collection not in ["soul_persona", "agent_system", "memory", 
                         "context_briefing", "heartbeat_tasks", "skills_knowledge", "skills"]:
        raise HTTPException(status_code=400, detail=f"Invalid collection: {collection}")
    
    col = get_v2_collection(collection)
    query_embedding = await get_embedding(req.query)
    token_budget = req.token_budget or 1500
    
    # Determine vector field name
    vector_field = "vector" if collection == "memory" else "embedding"
    
    # Collection-specific filtering
    expr = ""
    if collection == "agent_system":
        expr = "active == true"
    elif collection == "heartbeat_tasks":
        expr = "status == 'active'"
    elif req.days and collection == "memory":
        cutoff = now_ms() - (req.days * 86400 * 1000)
        expr = f"temporal >= {cutoff}"
    
    search_params = {"metric_type": "COSINE", "params": {"ef": 128}}
    results = col.search(
        data=[query_embedding],
        anns_field=vector_field,
        param=search_params,
        limit=20,
        expr=expr,
        output_fields=["*"]
    )
    
    memories = []
    total_tokens = 0
    
    for hits in results:
        for hit in hits:
            entity = hit.entity
            fields = entity.fields if hasattr(entity, 'fields') else entity
            
            # Get text field (different field names per collection)
            if collection == "memory":
                text = getattr(fields, "content", "")
            else:
                text = getattr(fields, "text", "")
            
            tokens = estimate_tokens(text)
            if total_tokens + tokens > token_budget:
                continue
                
            total_tokens += tokens
            memories.append(V2MemoryResponse(
                id=getattr(fields, "id", ""),
                text=text,
                collection=collection,
                category=getattr(fields, "category", None),
                score=round(hit.score, 4),
                metadata={}
            ))
    
    return V2RecallResponse(
        memories=memories,
        total_tokens=total_tokens,
        query=req.query,
        collections_searched=[collection]
    )


@app.post("/v2/recall/multi", response_model=V2RecallResponse)
async def recall_multi_collection_v2(req: MultiCollectionRecallRequest):
    """Query across multiple collections with intelligent merging."""
    query_embedding = await get_embedding(req.query)
    token_budget = req.token_budget or 1500
    
    all_memories = []
    
    for collection in req.collections:
        try:
            col = get_v2_collection(collection)
            vector_field = "vector" if collection == "memory" else "embedding"
            
            # Collection-specific filtering
            expr = ""
            if collection == "agent_system":
                expr = "active == true"
            elif collection == "heartbeat_tasks":
                expr = "status == 'active'"
            elif req.days and collection == "memory":
                cutoff = now_ms() - (req.days * 86400 * 1000)
                expr = f"temporal >= {cutoff}"
            
            search_params = {"metric_type": "COSINE", "params": {"ef": 128}}
            results = col.search(
                data=[query_embedding],
                anns_field=vector_field,
                param=search_params,
                limit=10,  # Fewer per collection to allow diversity
                expr=expr,
                output_fields=["*"]
            )
            
            for hits in results:
                for hit in hits:
                    entity = hit.entity
                    # entity may be a dict or an object with .fields
                    if hasattr(entity, 'fields') and isinstance(entity.fields, dict):
                        fields = entity.fields
                    elif isinstance(entity, dict):
                        fields = entity
                    else:
                        fields = {}
                    
                    def _get(d, key, default=""):
                        if isinstance(d, dict):
                            return d.get(key, default)
                        return getattr(d, key, default)
                    
                    # Get text field
                    if collection == "memory":
                        text = _get(fields, "content", "")
                    else:
                        text = _get(fields, "text", "")
                    
                    all_memories.append(V2MemoryResponse(
                        id=_get(fields, "id", ""),
                        text=text,
                        collection=collection,
                        category=_get(fields, "category", None),
                        score=round(hit.score, 4),
                        metadata={}
                    ))
                    
        except Exception as e:
            # Skip collections that don't exist or have errors
            continue
    
    # Sort by score and pack within token budget
    all_memories.sort(key=lambda x: x.score or 0, reverse=True)
    
    packed = []
    total_tokens = 0
    for mem in all_memories:
        tokens = estimate_tokens(mem.text)
        if total_tokens + tokens > token_budget:
            continue
        total_tokens += tokens
        packed.append(mem)
    
    return V2RecallResponse(
        memories=packed,
        total_tokens=total_tokens,
        query=req.query,
        collections_searched=req.collections
    )


@app.post("/v2/boot", response_model=V2RecallResponse)
async def boot_recall_v2(req: BootRecallRequest):
    """Boot recall — query soul + agent + relevant context for session init."""
    query = f"session initialization conversation_id:{req.conversation_id or ''} participants:{','.join(req.participants)} channel:{req.channel or ''}"
    
    # Always include these for boot
    collections = ["soul_persona", "agent_system", "context_briefing"]
    
    multi_req = MultiCollectionRecallRequest(
        query=query,
        collections=collections,
        token_budget=req.token_budget or 2000
    )
    
    return await recall_multi_collection_v2(multi_req)


@app.get("/v2/status", response_model=V2StatusResponse)
async def status_v2():
    """Get status across all collections."""
    stats = get_collection_stats()
    total = sum(stats.values())
    
    last_comp = None
    meta_path = os.path.join(DATA_DIR, "last-compression.json")
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
            last_comp = meta.get("last_run")
    
    return V2StatusResponse(
        collections=stats,
        total_memories=total,
        last_compression=last_comp
    )


# ═══ SKILL ENDPOINTS ═════════════════════════════════════════════════════════

@app.post("/v2/skills/ingest", response_model=IngestResponse)
async def ingest_skill(req: SkillIngestRequest):
    """Ingest a skill definition into the skills collection."""
    col = get_v2_collection("skills")
    skill_id = str(uuid.uuid4())
    
    # Embed description + name for semantic matching
    embed_text = f"{req.name}: {req.description}"
    embedding = await get_embedding(embed_text)
    ts = now_ms()
    
    col.insert([
        [skill_id], [embedding], [req.name], [req.description], [req.content],
        [req.kind.value], [req.source.value],
        [req.domains], [req.tools_used], [req.triggers], [req.connections],
        [0], [0],  # success_count, fail_count
        [req.version], [req.significance],
        [req.evolved_from or ""],
        [0],  # last_used
        [ts], [ts]  # created_at, updated_at
    ])
    col.flush()
    return IngestResponse(ids=[skill_id], count=1)


@app.post("/v2/skills/ingest/batch", response_model=IngestResponse)
async def ingest_skills_batch(skills: List[SkillIngestRequest]):
    """Batch ingest multiple skills."""
    col = get_v2_collection("skills")
    ids = []
    ts = now_ms()
    
    for req in skills:
        skill_id = str(uuid.uuid4())
        embed_text = f"{req.name}: {req.description}"
        embedding = await get_embedding(embed_text)
        
        col.insert([
            [skill_id], [embedding], [req.name], [req.description], [req.content],
            [req.kind.value], [req.source.value],
            [req.domains], [req.tools_used], [req.triggers], [req.connections],
            [0], [0], [req.version], [req.significance],
            [req.evolved_from or ""], [0], [ts], [ts]
        ])
        ids.append(skill_id)
    
    col.flush()
    return IngestResponse(ids=ids, count=len(ids))


@app.post("/v2/skills/recall", response_model=SkillRecallResponse)
async def recall_skills(req: SkillRecallRequest):
    """Recall relevant skills for a given query."""
    col = get_v2_collection("skills")
    query_embedding = await get_embedding(req.query)
    
    # Build filter
    filters = []
    if not req.include_variants:
        filters.append('kind != "skill_variant"')
    if req.domain:
        filters.append(f'array_contains(domains, "{req.domain}")')
    if req.min_significance > 0:
        filters.append(f'significance >= {req.min_significance}')
    
    expr = " and ".join(filters) if filters else ""
    
    search_params = {"metric_type": "COSINE", "params": {"ef": 128}}
    results = col.search(
        data=[query_embedding],
        anns_field="embedding",
        param=search_params,
        limit=req.top_k * 2,  # Over-fetch for token budget packing
        expr=expr,
        output_fields=["id", "name", "description", "content", "kind", "source",
                       "domains", "tools_used", "triggers", "connections",
                       "success_count", "fail_count", "version", "significance",
                       "evolved_from"]
    )
    
    skills = []
    total_tokens = 0
    
    for hits in results:
        for hit in hits:
            entity = hit.entity
            fields = entity.fields if hasattr(entity, 'fields') else entity
            def _g(key, default=None):
                try:
                    v = fields[key] if isinstance(fields, dict) else getattr(fields, key, default)
                    return v if v is not None else default
                except (KeyError, AttributeError):
                    return default
            
            content = _g("content", "")
            tokens = estimate_tokens(content)
            if total_tokens + tokens > req.token_budget:
                continue
            if len(skills) >= req.top_k:
                break
            
            total_tokens += tokens
            skills.append(SkillResponse(
                id=_g("id", ""),
                name=_g("name", ""),
                description=_g("description", ""),
                content=content,
                kind=_g("kind", "skill"),
                source=_g("source", "bundled"),
                domains=_g("domains", []),
                tools_used=_g("tools_used", []),
                triggers=_g("triggers", []),
                connections=_g("connections", []),
                success_count=_g("success_count", 0),
                fail_count=_g("fail_count", 0),
                version=_g("version", 1),
                significance=_g("significance", 0.5),
                evolved_from=_g("evolved_from", None) or None,
                score=round(hit.score, 4),
            ))
    
    return SkillRecallResponse(skills=skills, total_tokens=total_tokens, query=req.query)


@app.get("/v2/skills/status", response_model=SkillStatusResponse)
async def skills_status():
    """Get skills collection statistics."""
    col = get_v2_collection("skills")
    total = col.num_entities
    
    by_kind = {}
    for kind in ["skill", "skill_step", "skill_variant"]:
        try:
            count = len(col.query(expr=f'kind == "{kind}"', output_fields=["id"], limit=16384))
        except Exception:
            count = 0
        by_kind[kind] = count
    
    by_source = {}
    for source in ["bundled", "custom", "auto-created"]:
        try:
            count = len(col.query(expr=f'source == "{source}"', output_fields=["id"], limit=16384))
        except Exception:
            count = 0
        by_source[source] = count
    
    # Top skills by success count
    top_skills = []
    try:
        top = col.query(
            expr="success_count > 0",
            output_fields=["id", "name", "success_count", "fail_count", "significance"],
            limit=10
        )
        top.sort(key=lambda x: x.get("success_count", 0), reverse=True)
        top_skills = [{"name": s.get("name"), "success_count": s.get("success_count", 0), 
                       "fail_count": s.get("fail_count", 0)} for s in top[:5]]
    except Exception:
        pass
    
    return SkillStatusResponse(
        total_skills=total,
        by_kind=by_kind,
        by_source=by_source,
        top_skills=top_skills
    )


@app.post("/v2/skills/{skill_id}/success")
async def skill_success(skill_id: str):
    """Record a successful use of a skill."""
    col = get_v2_collection("skills")
    results = col.query(expr=f'id == "{skill_id}"', output_fields=["success_count", "significance"])
    if not results:
        raise HTTPException(status_code=404, detail="Skill not found")
    
    current = results[0]
    new_count = current.get("success_count", 0) + 1
    new_sig = min(1.0, current.get("significance", 0.5) + 0.02)
    
    col.delete(expr=f'id == "{skill_id}"')
    # Re-query to get full record, then reinsert with updated fields
    # For now, just update via delete+reinsert pattern
    # (Milvus doesn't support in-place updates well)
    return {"skill_id": skill_id, "success_count": new_count, "significance": round(new_sig, 4)}


@app.post("/v2/skills/{skill_id}/fail")
async def skill_fail(skill_id: str):
    """Record a failed use of a skill."""
    col = get_v2_collection("skills")
    results = col.query(expr=f'id == "{skill_id}"', output_fields=["fail_count", "significance"])
    if not results:
        raise HTTPException(status_code=404, detail="Skill not found")
    
    current = results[0]
    new_count = current.get("fail_count", 0) + 1
    new_sig = max(0.0, current.get("significance", 0.5) - 0.05)
    
    return {"skill_id": skill_id, "fail_count": new_count, "significance": round(new_sig, 4)}


@app.post("/v2/skills/{skill_id}/evolve", response_model=IngestResponse)
async def evolve_skill(skill_id: str, req: SkillIngestRequest):
    """Create a new version of a skill, linking to the parent."""
    col = get_v2_collection("skills")
    results = col.query(expr=f'id == "{skill_id}"', output_fields=["name", "version"])
    if not results:
        raise HTTPException(status_code=404, detail="Parent skill not found")
    
    parent = results[0]
    req.evolved_from = skill_id
    req.version = parent.get("version", 1) + 1
    req.kind = "skill"
    
    return await ingest_skill(req)


# ═══ GRAPH ENDPOINTS (Layer 1: Knowledge Graph) ═════════════════════════════

import re as _re
_CYPHER_KW = _re.compile(
    r"^\s*(MATCH|RETURN|CREATE|MERGE|DELETE|DETACH|SET|REMOVE|WITH|UNWIND|CALL|"
    r"OPTIONAL|LOAD|FOREACH|DROP|ALTER|GRANT|DENY|REVOKE|SHOW|START|STOP|USE)\b",
    _re.IGNORECASE,
)

def _is_cypher(q: str) -> bool:
    return bool(_CYPHER_KW.match(q.strip()))

def _nl_to_cypher(query: str):
    """Convert a natural-language query to a Cypher MATCH searching node names."""
    terms = [t.strip() for t in query.split() if len(t.strip()) >= 2]
    if not terms:
        return "MATCH (n) RETURN n, labels(n) AS labels LIMIT 10", {}
    pattern = "(?i).*(" + "|".join(_re.escape(t) for t in terms) + ").*"
    cypher = (
        "MATCH (n) "
        "WHERE any(prop IN [n.name, n.hostname, n.path, n.id, n.role, n.type, n.domain, n.description] WHERE prop IS NOT NULL AND prop =~ $pattern) "
        "OPTIONAL MATCH (n)-[r]-(m) "
        "RETURN n AS node, labels(n) AS node_labels, "
        "collect(DISTINCT {relationship: type(r), target: COALESCE(m.name, m.hostname, m.path, m.id), "
        "target_labels: labels(m)})[..10] AS connections "
        "LIMIT 20"
    )
    return cypher, {"pattern": pattern}


@app.post("/graph/query")
async def graph_query(req: GraphQueryRequest):
    """Execute a Cypher query OR a natural-language entity search.

    If the query text starts with a Cypher keyword (MATCH, RETURN, etc.)
    it is executed as raw Cypher.  Otherwise it is treated as a
    natural-language search and converted to a fuzzy name lookup.
    """
    if not graph_manager:
        raise HTTPException(status_code=503, detail="Neo4j graph not available")

    query_text = req.query.strip()
    if _is_cypher(query_text):
        cypher = query_text
        parameters = req.parameters or {}
    else:
        cypher, parameters = _nl_to_cypher(query_text)
        if req.parameters:
            parameters.update(req.parameters)

    try:
        result = graph_manager.query(cypher, parameters)
        return {
            "query": cypher,
            "natural_language": not _is_cypher(req.query),
            "results": result,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Graph query error: {str(e)}")


@app.get("/graph/neighbors/{node_id}")
async def get_neighbors(node_id: str, max_hops: int = 1):
    """Get all neighbors of a node within max_hops"""
    if not graph_manager:
        raise HTTPException(status_code=503, detail="Neo4j graph not available")
    
    try:
        neighbors = graph_manager.get_neighbors(node_id, max_hops)
        return {"node_id": node_id, "max_hops": max_hops, "neighbors": neighbors}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error getting neighbors: {str(e)}")


@app.get("/graph/path/{from_id}/{to_id}")
async def get_path(from_id: str, to_id: str, max_length: int = 4):
    """Find shortest path between two nodes"""
    if not graph_manager:
        raise HTTPException(status_code=503, detail="Neo4j graph not available")
    
    try:
        path = graph_manager.find_path(from_id, to_id, max_length)
        return {"from": from_id, "to": to_id, "path": path, "length": len(path)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error finding path: {str(e)}")


@app.get("/graph/subgraph")
async def get_subgraph(domain: Optional[str] = None, node_type: Optional[str] = None, limit: int = 100):
    """Extract a subgraph by domain or node type"""
    if not graph_manager:
        raise HTTPException(status_code=503, detail="Neo4j graph not available")
    
    try:
        subgraph = graph_manager.get_subgraph(domain, node_type, limit)
        return {"filters": {"domain": domain, "node_type": node_type}, "limit": limit, "subgraph": subgraph}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error getting subgraph: {str(e)}")


@app.post("/graph/upsert")
async def upsert_graph_data(
    node_label: Optional[str] = None,
    node_properties: Optional[Dict[str, Any]] = None,
    from_id: Optional[str] = None,
    to_id: Optional[str] = None,
    relationship_type: Optional[str] = None,
    relationship_properties: Optional[Dict[str, Any]] = None
):
    """Create or update nodes and relationships"""
    if not graph_manager:
        raise HTTPException(status_code=503, detail="Neo4j graph not available")
    
    try:
        result = {}
        
        # Upsert node if provided
        if node_label and node_properties:
            node_id = graph_manager.upsert_node(node_label, node_properties)
            result["node_id"] = node_id
        
        # Upsert relationship if provided
        if from_id and to_id and relationship_type:
            rel_props = relationship_properties or {}
            success = graph_manager.upsert_edge(from_id, to_id, relationship_type, rel_props)
            result["relationship_created"] = success
        
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error upserting graph data: {str(e)}")


@app.get("/graph/stats")
async def graph_stats():
    """Get graph statistics"""
    if not graph_manager:
        raise HTTPException(status_code=503, detail="Neo4j graph not available")
    
    try:
        stats = graph_manager.get_stats()
        return stats
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error getting graph stats: {str(e)}")


# ═══ BELIEF ENDPOINTS (Layer 3: Belief State) ═══════════════════════════════

@app.post("/beliefs/assert")
async def assert_belief(
    statement: str,
    domain: str = "general",
    entities: Optional[List[str]] = None,
    confidence: float = 0.7,
    source_memories: Optional[List[str]] = None,
    reason: str = "manual_assertion"
):
    """Assert a new belief or update existing one"""
    if not beliefs_manager:
        raise HTTPException(status_code=503, detail="Beliefs manager not available")
    
    if entities is None:
        entities = []
    if source_memories is None:
        source_memories = []
    
    try:
        belief_id = await beliefs_manager.assert_belief(
            statement, domain, entities, confidence, source_memories, reason
        )
        return {"belief_id": belief_id, "statement": statement, "confidence": confidence}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error asserting belief: {str(e)}")


@app.post("/beliefs/challenge")
async def challenge_belief(
    belief_id: str,
    contradicting_statement: str,
    contradicting_memories: Optional[List[str]] = None,
    reason: str = "contradiction"
):
    """Register contradicting information for a belief"""
    if not beliefs_manager:
        raise HTTPException(status_code=503, detail="Beliefs manager not available")
    
    if contradicting_memories is None:
        contradicting_memories = []
    
    try:
        success = await beliefs_manager.challenge_belief(
            belief_id, contradicting_statement, contradicting_memories, reason
        )
        return {"success": success, "belief_id": belief_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error challenging belief: {str(e)}")


@app.post("/beliefs/query")
async def query_beliefs(
    query: Optional[str] = None,
    domain: Optional[str] = None,
    min_confidence: float = 0.0,
    limit: int = 20
):
    """Query beliefs by text similarity, domain, or confidence"""
    if not beliefs_manager:
        raise HTTPException(status_code=503, detail="Beliefs manager not available")
    
    try:
        beliefs = await beliefs_manager.query_beliefs(query, domain, min_confidence, limit)
        return {
            "beliefs": beliefs,
            "count": len(beliefs),
            "query": query,
            "domain": domain,
            "min_confidence": min_confidence
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error querying beliefs: {str(e)}")


@app.get("/beliefs/current")
async def get_current_beliefs(domain: Optional[str] = None, limit: int = 50):
    """Get all active beliefs for a domain"""
    if not beliefs_manager:
        raise HTTPException(status_code=503, detail="Beliefs manager not available")
    
    try:
        beliefs = await beliefs_manager.query_beliefs(
            query=None, domain=domain, min_confidence=0.0, limit=limit
        )
        return {"beliefs": beliefs, "domain": domain, "count": len(beliefs)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error getting current beliefs: {str(e)}")


@app.get("/beliefs/{belief_id}/history")
async def get_belief_history(belief_id: str):
    """Get the changelog history for a belief"""
    if not beliefs_manager:
        raise HTTPException(status_code=503, detail="Beliefs manager not available")
    
    try:
        history = beliefs_manager.get_belief_history(belief_id)
        return {"belief_id": belief_id, "history": history, "count": len(history)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error getting belief history: {str(e)}")


@app.get("/beliefs/stats")
async def belief_stats():
    """Get belief statistics"""
    if not beliefs_manager:
        raise HTTPException(status_code=503, detail="Beliefs manager not available")
    
    try:
        stats = beliefs_manager.get_stats()
        return stats
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error getting belief stats: {str(e)}")


# ═══ ENHANCED SEARCH ENDPOINTS (Layer 2: Enhanced Vector DB) ═══════════════

@app.post("/search/hybrid")
async def hybrid_search(req: HybridSearchRequest):
    """Perform hybrid search combining vector similarity and keyword matching"""
    if not enhanced_search:
        raise HTTPException(status_code=503, detail="Enhanced search not available")
    
    try:
        # Get the collection
        from milvus_client_v2 import get_collection as get_v2_collection
        col = get_v2_collection(req.collection)
        
        results = await enhanced_search.hybrid_search(
            req.query, col, req.vector_weight, req.keyword_weight, 
            req.top_k, req.domain, req.kind, req.min_confidence
        )
        
        return {
            "results": results,
            "query": req.query,
            "collection": req.collection,
            "vector_weight": req.vector_weight,
            "keyword_weight": req.keyword_weight,
            "count": len(results)
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Hybrid search error: {str(e)}")


@app.post("/search/keyword")
async def keyword_search(
    query: str,
    limit: int = 20,
    domain: Optional[str] = None,
    kind: Optional[str] = None
):
    """Perform keyword-only search using FTS5"""
    if not enhanced_search:
        raise HTTPException(status_code=503, detail="Enhanced search not available")
    
    try:
        results = enhanced_search.keyword_search(query, limit, domain, kind)
        return {
            "results": results,
            "query": query,
            "count": len(results)
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Keyword search error: {str(e)}")


@app.post("/search/normalize-entities")
async def normalize_entities(entities: List[str]):
    """Normalize entity list to canonical forms"""
    if not enhanced_search:
        raise HTTPException(status_code=503, detail="Enhanced search not available")
    
    normalized = enhanced_search.normalize_entities(entities)
    
    return {
        "original": entities,
        "normalized": normalized,
        "mappings": {
            orig: norm for orig, norm in zip(entities, normalized) 
            if orig != norm
        }
    }


@app.post("/search/normalize-query")
async def normalize_query(query: str):
    """Normalize entities mentioned in a query string"""
    if not enhanced_search:
        raise HTTPException(status_code=503, detail="Enhanced search not available")
    
    normalized = enhanced_search.normalize_query_entities(query)
    
    return {
        "original": query,
        "normalized": normalized,
        "changed": query != normalized
    }


@app.get("/search/stats")
async def enhanced_search_stats():
    """Get enhanced search statistics"""
    if not enhanced_search:
        raise HTTPException(status_code=503, detail="Enhanced search not available")
    
    try:
        stats = enhanced_search.get_stats()
        return stats
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error getting search stats: {str(e)}")


# ═══ REFLECTION ENDPOINTS (Layer 4: Reflection Engine) ═════════════════════

@app.post("/reflect/run")
async def run_reflection(mode: str = "standard"):
    """Manually trigger a reflection cycle"""
    if not reflection_engine:
        raise HTTPException(status_code=503, detail="Reflection engine not available")
    
    if mode not in ["standard", "daily", "weekly"]:
        raise HTTPException(status_code=400, detail="Mode must be: standard, daily, or weekly")
    
    try:
        result = await reflection_engine.run_cycle(mode)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Reflection cycle failed: {str(e)}")


@app.get("/reflect/stats")
async def reflection_stats():
    """Get reflection engine statistics"""
    if not reflection_engine:
        raise HTTPException(status_code=503, detail="Reflection engine not available")
    
    try:
        stats = reflection_engine.get_stats()
        return stats
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error getting reflection stats: {str(e)}")


# ═══ Legacy/Shared Endpoints ══════════════════════════════════════════════════

@app.delete("/forget")
async def forget(memory_id: str):
    # Try to delete from all collections
    deleted_from = []
    for collection in ["memory", "soul_persona", "agent_system", "context_briefing", 
                      "heartbeat_tasks", "skills_knowledge", "skills"]:
        try:
            col = get_v2_collection(collection)
            col.delete(expr=f'id == "{memory_id}"')
            col.flush()
            deleted_from.append(collection)
        except Exception:
            continue
    
    return {"deleted": memory_id, "from_collections": deleted_from}


@app.get("/entity-graph")
async def entity_graph():
    path = os.path.join(DATA_DIR, "entity-graph.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {"edges": {}}


@app.get("/contradictions")
async def contradictions():
    path = os.path.join(DATA_DIR, "contradiction-log.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return []


@app.post("/compress")
async def compress():
    results = await run_compression()
    return results


# ═══ BRAIN MODEL CONFIG ════════════════════════════════════════════════════════

@app.get("/v2/model/config")
async def get_model_config():
    """Return the current LLM and embedding model configuration."""
    cfg = get_config()
    return {
        "llm_backend": cfg.get("llm_backend", os.getenv("LLM_BACKEND", "ollama")),
        "llm_url": cfg.get("llm_url", os.getenv("LLM_URL") or os.getenv("OLLAMA_URL", "http://ollama:11434")),
        "embedding_model": cfg.get("embedding_model", cfg.get("embedding", {}).get("model", "nomic-embed-text")),
        "embedding_dim": cfg.get("embedding_dim", cfg.get("embedding", {}).get("dimension", 768)),
        "generation_model": cfg.get("ner", {}).get("model", "qwen2.5:7b"),
        "compression_model": cfg.get("compression_model", "qwen2.5:7b"),
    }


@app.post("/v2/model/config")
async def update_model_config(body: dict):
    """Update model configuration and reload.

    Accepts any combination of:
      llm_backend, llm_url, embedding_model, embedding_dim,
      generation_model, compression_model
    """
    allowed = {
        "llm_backend", "llm_url",
        "embedding_model", "embedding_dim",
        "generation_model", "compression_model",
    }
    cfg = get_config()
    patch = {k: v for k, v in body.items() if k in allowed}

    # Map user-friendly keys into the nested config structure the brain expects.
    if "embedding_model" in patch:
        cfg["embedding_model"] = patch["embedding_model"]
        cfg.setdefault("embedding", {})["model"] = patch["embedding_model"]
    if "embedding_dim" in patch:
        cfg["embedding_dim"] = patch["embedding_dim"]
        cfg.setdefault("embedding", {})["dimension"] = patch["embedding_dim"]
    if "generation_model" in patch:
        cfg.setdefault("ner", {})["model"] = patch["generation_model"]
    if "compression_model" in patch:
        cfg["compression_model"] = patch["compression_model"]
    if "llm_backend" in patch:
        cfg["llm_backend"] = patch["llm_backend"]
    if "llm_url" in patch:
        cfg["llm_url"] = patch["llm_url"]

    # Persist to disk so it survives restarts.
    config_path = os.getenv("CONFIG_PATH", "/app/config.json")
    try:
        import json as _json
        with open(config_path, "w") as f:
            _json.dump(cfg, f, indent=2)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not write config: {e}")

    # Force the in-memory config to reload.
    from config import reload_config
    reload_config()

    return {"ok": True, "config": await get_model_config()}


# Health check
@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}