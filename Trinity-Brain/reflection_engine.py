"""
Reflection Engine for Lex-Brain v3
Runs offline processing: semantic extraction, belief maintenance, graph enrichment, 
pattern detection, contradiction resolution, and insight generation.
"""

import json
import os
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
import httpx

from milvus_client_v2 import get_collection as get_v2_collection
from graph_manager import GraphManager
from beliefs_manager import BeliefsManager
from enhanced_search import EnhancedSearchManager
from embedding import get_embedding
from ner import extract_ner
from utils import now_ms, ms_to_iso, iso_to_ms

logger = logging.getLogger(__name__)

class ReflectionEngine:
    def __init__(self, data_dir: str, graph_manager: GraphManager = None,
                 beliefs_manager: BeliefsManager = None,
                 enhanced_search: EnhancedSearchManager = None,
                 ollama_url: str = "http://localhost:11434",
                 llm_backend: str = "ollama"):
        self.data_dir = data_dir
        self.graph_manager = graph_manager
        self.beliefs_manager = beliefs_manager
        self.enhanced_search = enhanced_search
        self.llm_url = ollama_url
        self.llm_backend = llm_backend
        
        self.state_file = os.path.join(data_dir, "reflection_state.json")
        self.load_state()
    
    def load_state(self):
        """Load reflection engine state"""
        if os.path.exists(self.state_file):
            with open(self.state_file, 'r') as f:
                self.state = json.load(f)
        else:
            self.state = {
                'last_run': 0,
                'last_daily_run': 0,
                'last_weekly_run': 0,
                'processed_memories': [],
                'insights_generated': 0,
                'patterns_detected': 0,
                'beliefs_created': 0,
                'graph_nodes_added': 0
            }
    
    def save_state(self):
        """Save reflection engine state"""
        with open(self.state_file, 'w') as f:
            json.dump(self.state, f, indent=2)
    
    async def ollama_generate(self, prompt: str, model: str = "qwen2.5:7b") -> str:
        """Generate text via the configured LLM backend (Ollama or OpenAI-compatible).

        Supports:
          - backend="ollama"  -> POST /api/generate  (Ollama native)
          - backend="openai"  -> POST /v1/chat/completions  (llama.cpp, vLLM, LiteLLM, etc.)
        """
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                if self.llm_backend == "openai":
                    response = await client.post(
                        f"{self.llm_url}/v1/chat/completions",
                        json={
                            "model": model,
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": 0.3,
                            "top_p": 0.9,
                            "max_tokens": 1000,
                            "stream": False,
                        }
                    )
                    if response.status_code == 200:
                        return response.json()["choices"][0]["message"]["content"].strip()
                    else:
                        logger.error(f"LLM error {response.status_code}: {response.text}")
                        return ""
                else:
                    response = await client.post(
                        f"{self.llm_url}/api/generate",
                        json={
                            "model": model,
                            "prompt": prompt,
                            "stream": False,
                            "options": {
                                "temperature": 0.3,
                                "top_p": 0.9,
                                "max_tokens": 1000
                            }
                        }
                    )
                    if response.status_code == 200:
                        result = response.json()
                        return result.get("response", "").strip()
                    else:
                        logger.error(f"LLM error {response.status_code}: {response.text}")
                        return ""

        except Exception as e:
            logger.error(f"Error calling LLM: {e}")
            return ""
    
    async def run_cycle(self, mode: str = "standard"):
        """
        Run a reflection cycle
        mode: "standard" (6h tasks) | "daily" | "weekly"
        """
        logger.info(f"Starting reflection cycle: {mode}")
        
        start_time = now_ms()
        
        try:
            # Get new memories since last run
            new_memories = await self.get_new_memories()
            logger.info(f"Processing {len(new_memories)} new memories")
            
            # Always run standard tasks
            if new_memories:
                await self.semantic_extraction(new_memories)
                if self.beliefs_manager:
                    await self.belief_maintenance(new_memories)
                if self.graph_manager:
                    await self.graph_enrichment(new_memories)
            
            # Run daily tasks
            if mode in ("daily", "weekly"):
                await self.pattern_detection()
                if self.beliefs_manager:
                    await self.contradiction_resolution()
            
            # Run weekly tasks
            if mode == "weekly":
                if self.graph_manager:
                    await self.graph_pruning()
                await self.insight_generation()
            
            # Update state
            self.state['last_run'] = start_time
            if mode == "daily":
                self.state['last_daily_run'] = start_time
            elif mode == "weekly":
                self.state['last_weekly_run'] = start_time
            
            self.save_state()
            
            duration = (now_ms() - start_time) / 1000
            logger.info(f"Reflection cycle completed in {duration:.1f}s")
            
            return {
                "mode": mode,
                "duration_seconds": duration,
                "memories_processed": len(new_memories),
                "success": True
            }
            
        except Exception as e:
            logger.error(f"Reflection cycle failed: {e}")
            return {
                "mode": mode,
                "error": str(e),
                "success": False
            }
    
    async def get_new_memories(self) -> List[Dict[str, Any]]:
        """Get memories created since last reflection run"""
        try:
            col = get_v2_collection("memory")
            
            # Query memories created after last run
            cutoff = self.state['last_run']
            
            results = col.query(
                expr=f"created_at > {cutoff}",
                output_fields=["id", "content", "kind", "domains", "entities", 
                              "temporal", "created_at", "participants", "source"],
                limit=1000
            )
            
            memories = []
            for result in results:
                memories.append({
                    'id': result.get('id', ''),
                    'content': result.get('content', ''),
                    'kind': result.get('kind', 'semantic'),
                    'domains': result.get('domains', []),
                    'entities': result.get('entities', []),
                    'temporal': result.get('temporal', 0),
                    'created_at': result.get('created_at', 0),
                    'participants': result.get('participants', []),
                    'source': result.get('source', '')
                })
            
            return memories
            
        except Exception as e:
            logger.error(f"Error getting new memories: {e}")
            return []
    
    async def semantic_extraction(self, memories: List[Dict[str, Any]]):
        """Extract semantic facts from episodic memories"""
        logger.info("Running semantic extraction...")
        
        extracted_count = 0
        
        for memory in memories:
            if memory['kind'] != 'episodic':
                continue
            
            # Skip if already processed
            if memory['id'] in self.state.get('processed_memories', []):
                continue
            
            content = memory['content']
            
            # Use Qwen to extract semantic facts
            prompt = f"""
Analyze this conversation excerpt and extract factual information that could be stored as semantic knowledge.
Focus on decisions, plans, preferences, facts about people/projects/companies, and important details.

Conversation: {content}

Extract 0-3 semantic facts. For each fact, provide:
1. The factual statement (clear, standalone)
2. Confidence level (0.3-0.9)
3. Domain (personal/business/technical/finance/etc)

Format as JSON array:
[
  {{
    "statement": "factual statement here",
    "confidence": 0.7,
    "domain": "business"
  }}
]

Return empty array [] if no significant facts found.
"""
            
            try:
                response = await self.ollama_generate(prompt)
                
                # Try to parse JSON response
                facts = []
                try:
                    facts = json.loads(response)
                    if not isinstance(facts, list):
                        facts = []
                except json.JSONDecodeError:
                    # Try to extract JSON from response
                    import re
                    json_match = re.search(r'\[.*\]', response, re.DOTALL)
                    if json_match:
                        try:
                            facts = json.loads(json_match.group())
                        except:
                            facts = []
                
                # Store extracted facts as semantic memories
                for fact in facts:
                    if isinstance(fact, dict) and 'statement' in fact:
                        await self.store_semantic_memory(
                            fact['statement'],
                            fact.get('domain', 'general'),
                            fact.get('confidence', 0.5),
                            memory['id']
                        )
                        extracted_count += 1
                
                # Mark as processed
                self.state.setdefault('processed_memories', []).append(memory['id'])
                
            except Exception as e:
                logger.warning(f"Semantic extraction failed for memory {memory['id']}: {e}")
        
        logger.info(f"Extracted {extracted_count} semantic facts")
        return extracted_count
    
    async def store_semantic_memory(self, statement: str, domain: str, 
                                  confidence: float, source_memory_id: str):
        """Store an extracted semantic memory"""
        try:
            col = get_v2_collection("memory")
            
            # Create semantic memory
            memory_id = f"semantic_{now_ms()}"
            embedding = await get_embedding(statement)
            ner_result = await extract_ner(statement)
            now = now_ms()
            
            col.insert([
                [memory_id], [embedding], [statement], ["semantic"],
                [ner_result.get("domains", [domain])], 
                [ner_result.get("entities", [])],
                [confidence], [0], [now], [now],
                [source_memory_id], ["hot"], [False], [""],
                [[]], ["reflection_engine"]
            ])
            col.flush()
            
            logger.info(f"Created semantic memory: {statement[:50]}...")
            
        except Exception as e:
            logger.error(f"Error storing semantic memory: {e}")
    
    async def belief_maintenance(self, memories: List[Dict[str, Any]]):
        """Extract and maintain beliefs from new memories"""
        logger.info("Running belief maintenance...")
        
        beliefs_updated = 0
        
        for memory in memories:
            content = memory['content']
            
            # Use Qwen to extract factual claims
            prompt = f"""
Analyze this text and extract factual claims that could be beliefs (things that are asserted as true).
Focus on concrete facts, decisions, plans, and statements about reality.

Text: {content}

Extract 0-2 factual claims. For each claim, provide:
1. The belief statement (clear, specific)
2. Confidence level (0.3-0.9)
3. Domain category
4. Entities involved

Format as JSON array:
[
  {{
    "statement": "belief statement here",
    "confidence": 0.8,
    "domain": "finance",
    "entities": ["Ryan", "Float Air"]
  }}
]

Return empty array [] if no clear factual claims found.
"""
            
            try:
                response = await self.ollama_generate(prompt)
                
                # Parse response
                claims = []
                try:
                    claims = json.loads(response)
                    if not isinstance(claims, list):
                        claims = []
                except json.JSONDecodeError:
                    import re
                    json_match = re.search(r'\[.*\]', response, re.DOTALL)
                    if json_match:
                        try:
                            claims = json.loads(json_match.group())
                        except:
                            claims = []
                
                # Process each claim
                for claim in claims:
                    if isinstance(claim, dict) and 'statement' in claim:
                        await self.beliefs_manager.assert_belief(
                            claim['statement'],
                            claim.get('domain', 'general'),
                            claim.get('entities', []),
                            claim.get('confidence', 0.5),
                            [memory['id']],
                            "reflection_extraction"
                        )
                        beliefs_updated += 1
                        self.state['beliefs_created'] = self.state.get('beliefs_created', 0) + 1
                
            except Exception as e:
                logger.warning(f"Belief extraction failed for memory {memory['id']}: {e}")
        
        logger.info(f"Updated {beliefs_updated} beliefs")
        return beliefs_updated
    
    async def graph_enrichment(self, memories: List[Dict[str, Any]]):
        """Extract and add entities/relationships to the graph"""
        logger.info("Running graph enrichment...")
        
        nodes_added = 0
        edges_added = 0
        
        for memory in memories:
            content = memory['content']
            
            # Use Qwen to extract entities and relationships
            prompt = f"""
Analyze this text and extract entities and their relationships for a knowledge graph.

Text: {content}

Extract:
1. Important entities (people, organizations, projects, concepts, places)
2. Relationships between entities

Format as JSON:
{{
  "entities": [
    {{
      "name": "entity name",
      "type": "Person|Organization|Project|Concept|Place",
      "aliases": ["alt name 1", "alt name 2"]
    }}
  ],
  "relationships": [
    {{
      "from": "entity 1",
      "to": "entity 2", 
      "type": "WORKS_AT|OWNS|USES|RELATED_TO|DECIDED",
      "context": "brief context"
    }}
  ]
}}

Focus on concrete, factual relationships. Return empty arrays if nothing significant found.
"""
            
            try:
                response = await self.ollama_generate(prompt)
                
                # Parse response
                graph_data = {}
                try:
                    graph_data = json.loads(response)
                except json.JSONDecodeError:
                    import re
                    json_match = re.search(r'\{.*\}', response, re.DOTALL)
                    if json_match:
                        try:
                            graph_data = json.loads(json_match.group())
                        except:
                            graph_data = {}
                
                # Add entities
                for entity in graph_data.get('entities', []):
                    if isinstance(entity, dict) and 'name' in entity:
                        try:
                            node_id = self.graph_manager.upsert_node(
                                entity.get('type', 'Concept'),
                                {
                                    'name': entity['name'],
                                    'aliases': entity.get('aliases', []),
                                    'source': 'reflection_engine'
                                }
                            )
                            if node_id:
                                nodes_added += 1
                        except Exception as e:
                            logger.warning(f"Failed to add entity {entity['name']}: {e}")
                
                # Add relationships
                for rel in graph_data.get('relationships', []):
                    if isinstance(rel, dict) and all(k in rel for k in ['from', 'to', 'type']):
                        try:
                            # Find node IDs for the entities
                            from_nodes = self.graph_manager.query(
                                "MATCH (n) WHERE n.name = $name RETURN n.id",
                                {'name': rel['from']}
                            )
                            to_nodes = self.graph_manager.query(
                                "MATCH (n) WHERE n.name = $name RETURN n.id", 
                                {'name': rel['to']}
                            )
                            
                            if from_nodes and to_nodes:
                                success = self.graph_manager.upsert_edge(
                                    from_nodes[0]['n.id'],
                                    to_nodes[0]['n.id'],
                                    rel['type'],
                                    {
                                        'context': rel.get('context', ''),
                                        'source': 'reflection_engine',
                                        'weight': 1.0
                                    }
                                )
                                if success:
                                    edges_added += 1
                        except Exception as e:
                            logger.warning(f"Failed to add relationship: {e}")
                
            except Exception as e:
                logger.warning(f"Graph enrichment failed for memory {memory['id']}: {e}")
        
        self.state['graph_nodes_added'] = self.state.get('graph_nodes_added', 0) + nodes_added
        logger.info(f"Added {nodes_added} nodes and {edges_added} edges to graph")
        return {'nodes_added': nodes_added, 'edges_added': edges_added}
    
    async def pattern_detection(self):
        """Detect patterns in recent memories and graph structure"""
        logger.info("Running pattern detection...")
        
        try:
            # Get recent memories (last 7 days)
            cutoff = now_ms() - (7 * 24 * 60 * 60 * 1000)
            
            col = get_v2_collection("memory")
            recent_memories = col.query(
                expr=f"temporal > {cutoff}",
                output_fields=["content", "domains", "entities", "temporal"],
                limit=100
            )
            
            if not recent_memories:
                return []
            
            # Use Qwen to detect patterns
            memory_summaries = []
            for mem in recent_memories[:20]:  # Limit for token budget
                content = mem.get('content', '')[:200]  # Truncate
                domains = ', '.join(mem.get('domains', []))
                entities = ', '.join(mem.get('entities', []))
                memory_summaries.append(f"[{domains}] {entities}: {content}")
            
            prompt = f"""
Analyze these recent memories and identify significant patterns, trends, or recurring themes.

Recent memories (last 7 days):
{chr(10).join(memory_summaries)}

Identify 1-3 patterns such as:
- Recurring topics or themes
- Changing priorities or focus areas  
- Relationship patterns between entities
- Decision patterns or behavioral trends

For each pattern, provide:
1. Pattern description (clear, specific)
2. Significance level (0.3-0.9)
3. Supporting evidence count
4. Domain/category

Format as JSON array:
[
  {{
    "description": "pattern description",
    "significance": 0.7,
    "evidence_count": 5,
    "domain": "business"
  }}
]

Return empty array [] if no significant patterns found.
"""
            
            response = await self.ollama_generate(prompt)
            
            # Parse patterns
            patterns = []
            try:
                patterns = json.loads(response)
                if not isinstance(patterns, list):
                    patterns = []
            except json.JSONDecodeError:
                import re
                json_match = re.search(r'\[.*\]', response, re.DOTALL)
                if json_match:
                    try:
                        patterns = json.loads(json_match.group())
                    except:
                        patterns = []
            
            # Store patterns as semantic memories
            patterns_stored = 0
            for pattern in patterns:
                if isinstance(pattern, dict) and 'description' in pattern:
                    await self.store_semantic_memory(
                        f"PATTERN: {pattern['description']}",
                        pattern.get('domain', 'meta'),
                        pattern.get('significance', 0.5),
                        "pattern_detection"
                    )
                    patterns_stored += 1
            
            self.state['patterns_detected'] = self.state.get('patterns_detected', 0) + patterns_stored
            logger.info(f"Detected and stored {patterns_stored} patterns")
            
            return patterns
            
        except Exception as e:
            logger.error(f"Pattern detection failed: {e}")
            return []
    
    async def contradiction_resolution(self):
        """Resolve contradictions in beliefs"""
        logger.info("Running contradiction resolution...")
        
        if not self.beliefs_manager:
            return
        
        try:
            # Get low-confidence beliefs that might have contradictions
            low_confidence_beliefs = await self.beliefs_manager.query_beliefs(
                query=None,
                domain=None,
                min_confidence=0.0,
                limit=50
            )
            
            contradictions_resolved = 0
            
            for belief in low_confidence_beliefs:
                if belief['confidence'] < 0.5:
                    # This belief has been challenged - analyze if we should resolve it
                    # For now, just log it - full implementation would gather evidence
                    logger.info(f"Low confidence belief: {belief['statement']} ({belief['confidence']})")
                    # TODO: Implement evidence gathering and resolution logic
            
            return contradictions_resolved
            
        except Exception as e:
            logger.error(f"Contradiction resolution failed: {e}")
            return 0
    
    async def graph_pruning(self):
        """Prune old, low-weight edges and orphan nodes from graph"""
        logger.info("Running graph pruning...")
        
        if not self.graph_manager:
            return {}
        
        try:
            # Remove edges not seen in 180+ days with weight < 2
            cutoff_date = (datetime.now() - timedelta(days=180)).isoformat()
            
            prune_query = f"""
            MATCH ()-[r]-()
            WHERE r.last_seen < '{cutoff_date}' AND r.weight < 2
            DELETE r
            RETURN count(r) as deleted_edges
            """
            
            result = self.graph_manager.query(prune_query)
            deleted_edges = result[0]['deleted_edges'] if result else 0
            
            # Remove orphan nodes (no relationships)
            orphan_query = """
            MATCH (n)
            WHERE NOT (n)--()
            DELETE n
            RETURN count(n) as deleted_nodes
            """
            
            result = self.graph_manager.query(orphan_query)
            deleted_nodes = result[0]['deleted_nodes'] if result else 0
            
            logger.info(f"Pruned {deleted_edges} edges and {deleted_nodes} orphan nodes")
            
            return {'deleted_edges': deleted_edges, 'deleted_nodes': deleted_nodes}
            
        except Exception as e:
            logger.error(f"Graph pruning failed: {e}")
            return {}
    
    async def insight_generation(self):
        """Generate high-level insights from accumulated knowledge"""
        logger.info("Running insight generation...")
        
        try:
            # Get recent high-significance memories
            col = get_v2_collection("memory")
            cutoff = now_ms() - (30 * 24 * 60 * 60 * 1000)  # Last 30 days
            
            significant_memories = col.query(
                expr=f"temporal > {cutoff} and significance > 0.6",
                output_fields=["content", "domains", "entities", "significance"],
                limit=20
            )
            
            # Get top beliefs
            beliefs = []
            if self.beliefs_manager:
                beliefs = await self.beliefs_manager.query_beliefs(
                    query=None, min_confidence=0.7, limit=10
                )
            
            # Prepare context for insight generation
            memory_context = []
            for mem in significant_memories[:10]:
                content = mem.get('content', '')[:200]
                domains = ', '.join(mem.get('domains', []))
                sig = mem.get('significance', 0)
                memory_context.append(f"[{domains}, sig:{sig}] {content}")
            
            belief_context = []
            for belief in beliefs[:5]:
                stmt = belief.get('statement', '')[:100]
                conf = belief.get('confidence', 0)
                belief_context.append(f"[conf:{conf:.2f}] {stmt}")
            
            prompt = f"""
Based on recent significant events and established beliefs, generate 2-3 high-level insights about patterns, trends, or implications.

Recent significant memories:
{chr(10).join(memory_context)}

Current beliefs:
{chr(10).join(belief_context)}

Generate insights that are:
1. Non-obvious (not directly stated in the data)
2. Actionable or strategically relevant
3. Based on patterns across multiple data points

For each insight, provide:
1. The insight statement (clear, strategic)
2. Confidence level (0.5-0.9)
3. Supporting evidence summary

Format as JSON array:
[
  {{
    "insight": "insight statement",
    "confidence": 0.7,
    "evidence": "brief evidence summary"
  }}
]

Return empty array [] if no meaningful insights can be generated.
"""
            
            response = await self.ollama_generate(prompt)
            
            # Parse insights
            insights = []
            try:
                insights = json.loads(response)
                if not isinstance(insights, list):
                    insights = []
            except json.JSONDecodeError:
                import re
                json_match = re.search(r'\[.*\]', response, re.DOTALL)
                if json_match:
                    try:
                        insights = json.loads(json_match.group())
                    except:
                        insights = []
            
            # Store insights as semantic memories
            insights_stored = 0
            for insight in insights:
                if isinstance(insight, dict) and 'insight' in insight:
                    await self.store_semantic_memory(
                        f"INSIGHT: {insight['insight']}",
                        "meta",
                        insight.get('confidence', 0.7),
                        "insight_generation"
                    )
                    insights_stored += 1
            
            self.state['insights_generated'] = self.state.get('insights_generated', 0) + insights_stored
            logger.info(f"Generated and stored {insights_stored} insights")
            
            return insights
            
        except Exception as e:
            logger.error(f"Insight generation failed: {e}")
            return []
    
    def get_stats(self) -> Dict[str, Any]:
        """Get reflection engine statistics"""
        return {
            'last_run': ms_to_iso(self.state['last_run']) if self.state['last_run'] else None,
            'last_daily_run': ms_to_iso(self.state['last_daily_run']) if self.state['last_daily_run'] else None,
            'last_weekly_run': ms_to_iso(self.state['last_weekly_run']) if self.state['last_weekly_run'] else None,
            'processed_memories': len(self.state.get('processed_memories', [])),
            'insights_generated': self.state.get('insights_generated', 0),
            'patterns_detected': self.state.get('patterns_detected', 0),
            'beliefs_created': self.state.get('beliefs_created', 0),
            'graph_nodes_added': self.state.get('graph_nodes_added', 0)
        }
