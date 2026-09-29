# Architecture (MVP Phase 1)

Local-first desktop app. Phase 1 wires the skeleton only:

```
Liit/ (React+TS+Vite shell, mock data) --HTTP--> backend/app (FastAPI)
                                                      |
                                                      v
                                              SQLite (data/lit_review.db, stdlib sqlite3)
Existing pipeline (untouched, Phase 2+): src/pdf -> src/chunking -> src/teacher
```

- No ORM (stdlib `sqlite3`), no vector DB yet, no LLM calls in backend.
- `LIT_REVIEW_DB` env overrides DB path (used by tests).
- Frontend talks to backend only via `Liit/src/lib/api.ts`.
