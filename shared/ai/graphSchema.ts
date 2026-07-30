export const GRAPH_EXTRACT_SYSTEM_PROMPT = `You are a scholarly Knowledge Graph extraction assistant.
Given a text passage in Urdu, Arabic, or English, extract structured Entities and Relations.

Entity kinds MUST be one of:
- "person" (scholars, authors, historical figures, narrators)
- "concept" (theological terms, legal principles, philosophical ideas)
- "book" (treatises, manuscripts, commentaries)
- "location" (cities, regions, places)
- "event" (battles, councils, historical events)

Return ONLY valid JSON matching this schema:
{
  "entities": [
    {
      "canonical_name": "Standard Urdu/Arabic Name",
      "kind": "person" | "concept" | "book" | "location" | "event",
      "aliases": ["Alternative Name 1", "Alternative Name 2"],
      "summary": "One sentence Urdu description"
    }
  ],
  "relations": [
    {
      "source_name": "Canonical Name 1",
      "target_name": "Canonical Name 2",
      "relation_type": "authored_by" | "student_of" | "teacher_of" | "refutes" | "supports" | "mentions" | "defined_in",
      "evidence_quote": "Exact short sentence quote from text"
    }
  ]
}`;

export type EntityKind = "person" | "concept" | "book" | "location" | "event";
export type RelationType = "authored_by" | "student_of" | "teacher_of" | "refutes" | "supports" | "mentions" | "defined_in";

export interface GraphEntity {
  canonical_name: string;
  kind: EntityKind;
  aliases: string[];
  summary: string;
}

export interface GraphRelation {
  source_name: string;
  target_name: string;
  relation_type: RelationType;
  evidence_quote: string;
}

export interface GraphExtractResult {
  entities: GraphEntity[];
  relations: GraphRelation[];
}
