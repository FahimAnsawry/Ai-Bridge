 Python Rewrite Implementation Plan: ai-bridge

     Context

     The current project is a Node.js/Express AI proxy server with a React      
     dashboard. The goal is to rewrite the backend in Python (FastAPI), keeping 
     all proxy features but removing the frontend entirely. Users configure     
     providers via YAML files instead of a browser UI. No MongoDB — config lives      in per-user YAML files. Multi-user support is retained via file-per-user  
     config.

     ---
     Target Architecture

     ai-bridge-py/
     ├── main.py                  # Entry point — starts both servers
     ├── config/
     │   ├── settings.yaml        # Global defaults (ports, cors, etc.)
     │   └── users/
     │       ├── alice.yaml       # Per-user: providers, access_key, settings   
     │       └── bob.yaml
     ├── app/
     │   ├── proxy/
     │   │   ├── server.py        # FastAPI app for port 3000 (/v1/*)
     │   │   ├── router.py        # Route handlers (proxyRequest equivalent)    
     │   │   ├── normalize.py     # normalizeMessages() + normalizeTools()      
     pipeline
     │   │   ├── optimize.py      # pruneMessagesToBudget() +
     summarizeMessagesToBudget()
     │   │   ├── cache.py         # Response cache (TTL dict)
     │   │   └── failover.py      # Key rotation + provider switching logic     
     │   ├── admin/
     │   │   ├── server.py        # FastAPI app for port 3001 (/api/*)
     │   │   └── routes.py        # /api/status, /api/config, /api/logs,        
     /api/models
     │   ├── config/
     │   │   ├── loader.py        # loadConfig(user_id) with 30s TTL cache      
     │   │   └── schema.py        # Pydantic models for user config + provider  
     │   ├── auth/
     │   │   └── middleware.py    # require_access_key dependency
     │   └── logger.py            # In-memory log store (last 50 per user) +    
     stats
     └── requirements.txt

     ---
     Phase 1 — Project Scaffold & Config System

     Files: main.py, app/config/schema.py, app/config/loader.py,
     config/settings.yaml

     Config schema (Pydantic)

     class Provider(BaseModel):
         id: str
         name: str
         base_url: str
         api_key: str = ""
         api_keys: list[str] = []
         is_active: bool = True
         copilot_auth: dict = {}   # for GitHub Copilot token storage

     class UserConfig(BaseModel):
         access_key: str
         active_provider_id: str = "swiftrouter"
         providers: list[Provider] = []
         model_routing: str = "fallback"
         model_mapping: dict[str, str] = {}
         stub_models: list[str] = []
         request_minimization_enabled: bool = True
         chat_max_upstream_attempts: int = 4
         token_optimization_enabled: bool = False
         prompt_budget_tokens: int = 0
         token_summarization_enabled: bool = False
         response_cache_enabled: bool = False
         response_cache_ttl_seconds: int = 30
         cors_origins: list[str] = ["*"]

     Config loader

     - loadConfig(user_id: str) -> UserConfig
     - Reads config/users/<user_id>.yaml
     - 30s TTL in-memory cache using cachetools.TTLCache
     - Falls back to config/settings.yaml defaults for missing fields
     - saveConfig(user_id, updates) — writes back to YAML, invalidates cache    

     main.py

     # Start both servers in the same process using uvicorn
     import uvicorn, asyncio
     from app.proxy.server import proxy_app
     from app.admin.server import admin_app

     async def main():
         config = uvicorn.Config(proxy_app, host="127.0.0.1", port=3000)        
         config2 = uvicorn.Config(admin_app, host="127.0.0.1", port=3001)       
         await asyncio.gather(
             uvicorn.Server(config).serve(),
             uvicorn.Server(config2).serve(),
         )

     ---
     Phase 2 — Auth Middleware

     File: app/auth/middleware.py

     ACCESS_KEY_CACHE: dict[str, UserConfig] = {}  # 10s TTL

     async def require_access_key(
         x_api_key: str | None = Header(None),
         authorization: str | None = Header(None),
     ) -> UserConfig:
         key = x_api_key or (authorization.removeprefix("Bearer ") if
     authorization else None)
         if not key:
             raise HTTPException(401)
         # scan users/ dir for matching access_key (cached 10s)
         user = find_user_by_key(key)
         if not user:
             raise HTTPException(401, "Invalid Bridge API key.")
         return user

     - Scans config/users/*.yaml files to find matching access_key
     - 10s TTL cache on key → user mapping
     - No DB, no bcrypt — plain string match (keys are already in YAML)

     ---
     Phase 3 — Core Proxy

     Files: app/proxy/router.py, app/proxy/normalize.py

     proxyRequest equivalent

     @router.post("/v1/messages")
     @router.post("/v1/chat/completions")
     async def proxy_request(request: Request, user: UserConfig =
     Depends(require_access_key)):
         config = await load_config(user.user_id)
         body = await request.json()

         # 1. Normalize messages (Anthropic ↔ OpenAI format)
         body = normalize_messages(body, target_provider=active_provider)       

         # 2. Token optimization (if enabled)
         if config.token_optimization_enabled:
             body = prune_messages_to_budget(body, config.prompt_budget_tokens) 

         # 3. Response cache check
         if config.response_cache_enabled:
             cached = cache.get(body)
             if cached: return cached

         # 4. Forward to upstream with failover
         response = await forward_with_failover(body, config, request)

         # 5. Translate response back if needed (OpenAI → Anthropic SSE)        
         # 6. Log request
         return response

     normalize.py — 4-phase pipeline

     Port the existing normalizeMessages() logic:
     1. Format conversion — detect if body is Anthropic format, convert to      
     provider's expected format
     2. Turn merging — merge consecutive same-role messages (required for       
     Gemini)
     3. System message hoisting — move system content to top-level system field 
     4. Gemini tool-call/response alignment — enforce strict
     tool_call/tool_result parity

     Provider-specific quirks to port:
     - NIM: tool_choice object → string, content array flattening
     - Gemini: consecutive same-role merge, tool parity
     - EcomAgent: remap all Claude variants → claude-opus-4-6
     - Timy: model ID dots → hyphens
     - GitHub Models: /inference path prefix, Accept headers
     - AgentRouter: originator/user-agent headers

     failover.py

     async def forward_with_failover(body, config, original_request):
         providers = get_active_providers(config)
         for attempt in range(config.chat_max_upstream_attempts):
             provider = providers[attempt % len(providers)]
             try:
                 resp = await httpx_client.post(provider.base_url, ...)
                 if resp.status_code == 429:
                     rotate_api_key(provider)  # try next key same provider     
                     continue
                 if resp.status_code in (400, 403, 404, 503):
                     continue  # try next provider
                 return resp
             except Exception:
                 continue
         raise HTTPException(502, "All upstream attempts failed")

     ---
     Phase 4 — Token Optimization

     File: app/proxy/optimize.py

     Port pruneMessagesToBudget() and summarizeMessagesToBudget():

     - prune_messages_to_budget(messages, budget_tokens) — drop oldest
     non-system messages until under budget
     - summarize_messages_to_budget(messages, budget_tokens, provider) — call   
     upstream to summarize oldest messages into a single summary message        
     - Token counting: use tiktoken (cl100k_base) as approximation

     ---
     Phase 5 — Response Cache

     File: app/proxy/cache.py

     from cachetools import TTLCache

     _cache: dict[str, TTLCache] = {}  # per-user TTLCache instances

     def get_cache(user_id: str, ttl: int) -> TTLCache:
         if user_id not in _cache:
             _cache[user_id] = TTLCache(maxsize=100, ttl=ttl)
         return _cache[user_id]

     def cache_key(body: dict) -> str:
         # hash of model + messages (exclude stream flag)
         return hashlib.sha256(json.dumps({k: body[k] for k in
     ('model','messages') if k in body}, sort_keys=True).encode()).hexdigest()  

     ---
     Phase 6 — Logger

     File: app/logger.py

     from collections import deque

     _logs: dict[str, deque] = {}   # user_id → deque(maxlen=50)
     _stats: dict[str, dict] = {}   # user_id → {total, tokens, errors}

     def add_log(user_id: str, entry: dict):
         _logs.setdefault(user_id, deque(maxlen=50)).appendleft(entry)
         # update _stats[user_id]

     def get_logs(user_id: str, limit=50) -> list:
         return list(_logs.get(user_id, []))[:limit]

     def get_stats(user_id: str | None) -> dict:
         if user_id is None:
             # aggregate all users
             ...
         return _stats.get(user_id, {})

     Log entry fields: timestamp, method, path, model, status, latency_ms,      
     prompt_tokens, completion_tokens, total_tokens, streaming, provider,       
     optimization, error

     ---
     Phase 8 — Admin API

     File: app/admin/routes.py

     All routes require require_access_key — same access key used for the proxy.      No Google OAuth, no sessions.

     GET  /api/status          → runtime state + stats + latest log
     GET  /api/config          → current user config (access_key masked)        
     POST /api/config          → update config fields → write to YAML
     GET  /api/logs            → last 50 logs for user
     DELETE /api/logs          → clear logs for user
     GET  /api/models          → model list from config
     GET  /api/providers/health → inspect config (no live ping), return status  

     POST /api/config accepted fields mirror the JS ALLOWED_CONFIG_FIELDS list. 

     ---
     Phase 9 — Special Endpoints

     File: app/proxy/router.py

     @router.post("/v1/messages/count_tokens")
     async def count_tokens(body: dict, user = Depends(require_access_key)):    
         # Local estimation — no upstream call
         tokens = estimate_prompt_tokens(body.get("system"),
     body.get("messages", []))
         return {"input_tokens": tokens}

     @router.get("/v1/models")
     async def list_models(user = Depends(require_access_key)):
         config = await load_config(user.user_id)
         return {"data": config.model_catalog or [], "object": "list"}

     @router.get("/v1/models/{model}")
     async def get_model(model: str):
         return {"id": model, "object": "model", "created": 0, "owned_by":      
     "system"}

     ---
     Dependencies (requirements.txt)

     fastapi>=0.111
     uvicorn[standard]>=0.29
     httpx>=0.27
     pyyaml>=6.0
     pydantic>=2.7
     cachetools>=5.3
     tiktoken>=0.7
     python-multipart>=0.0.9

     ---
     Implementation Order

     1. Phase 1 — scaffold + config system (YAML loader, Pydantic schema, TTL   
     cache)
     2. Phase 2 — auth middleware (key scan + 10s cache)
     3. Phase 3 — proxy router + normalize pipeline (core, most complex)        
     4. Phase 4 — failover logic
     5. Phase 5 — token optimization
     6. Phase 6 — response cache
     7. Phase 7 — logger
     8. Phase 8 — admin API
     9. Phase 9 — special endpoints + wire both servers in main.py

     ---
     Verification

     # Start both servers
     python main.py

     # Test proxy auth
     curl -H "x-api-key: <key>" http://localhost:3000/v1/models

     # Test proxy request (Claude CLI compatible)
     curl -H "x-api-key: <key>" -H "Content-Type: application/json" \
       -d '{"model":"claude-opus-4-6","messages":[{"role":"user","content":"hi"}     ],"max_tokens":10}' \
       http://localhost:3000/v1/messages

     # Test token count (local, no upstream)
     curl -H "x-api-key: <key>" -d '{"model":"x","messages":[]}' \
       http://localhost:3000/v1/messages/count_tokens

     # Test admin API
     curl -H "x-api-key: <key>" http://localhost:3001/api/status
     curl -H "x-api-key: <key>" http://localhost:3001/api/config

     # Test config update
     curl -X POST -H "x-api-key: <key>" -H "Content-Type: application/json" \   
       -d '{"active_provider_id":"ollama"}' http://localhost:3001/api/config    

     Point Claude Code CLI at http://localhost:3000 with any configured access  
     key to do an end-to-end test