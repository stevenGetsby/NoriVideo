# Customer White-Label vs Internal Full Model View Architecture

Date: 2026-11-27
Status: Implemented (staging `/tmp/prov`, pending release build & production config activation)

## 1. Problem & Goal

When onboarding external customers to LanMiaoTV / FrameOS:
- **External customers** must only see clean, white-labeled **model names** (e.g. `Seedance 2.5`, `Seedance 2.5 国际版`, `Seedance 2.0`), with **zero exposure** of upstream provider/aggregator names (`Kuaizi`, `Huimengi / 绘梦工坊`, `AILink`, `OpenLux`, `TopenRouter`, `DeepSeek 官方`), internal endpoints (`kzep_...`), or upstream routing keys (`kuaizi::...`).
- **Internal operator accounts** (`caoshuang` and `王卓 / wangzhuo`) see the **complete list of configured usable provider models** across every upstream provider (`供应商 · 模型名`, e.g. `Kuaizi · Seedance 2.5 国际版`, `绘梦工坊 · seedance-2.5`, `AILink · doubao-seedance-2-5`, `TopenRouter · doubao-seedance-2-5-260628`), including models hidden from customers, **subject to the global video `modelEnabled` switch**: turning a video model OFF (`modelEnabled[key] === false`) immediately hides it from internal accounts and blocks internal execution (`MODEL_NOT_ADMIN_ENABLED`).
- **Per-customer extensibility (Visibility + Provider Routing)**: Operators must be able to customize, per customer tenant/workspace or individual account:
  1. Which white-label models (`nori::*`) are visible or hidden (`customerModelOverrides`), AND
  2. Which underlying upstream provider model (`provider::modelId`, e.g. Kuaizi vs 绘梦工坊 vs AILink vs TopenRouter vs OpenLux) executes each white-label model (`customerModelRoutingOverrides`), via configuration alone with zero code changes and zero provider exposure to the customer.

## 2. Production Account Mapping (`14.103.65.61`)

Queried from production `User` table (read-only, no credentials inspected):

| Account Name | Role | `User.id` (`actorId`) | `workspaceOwnerId` | Recommended View |
|---|---|---|---|---|
| `caoshuang` | `admin` | `9de17f61-92a4-4fc6-8bd2-d97551663e15` | `null` | Internal Full View |
| `王卓` (`wangzhuo`) | `admin` | `5e389e8d-29a5-4298-8d70-935e034f8cb1` | `null` | Internal Full View |
| `admin@caoshuang` | `super_admin` | `919094eb-5fe3-43f5-ab8e-3f862b1d0763` | `null` | Optional Internal Full View |
| Sub-accounts (e.g. `曹宇航`) | `storyboard` | `c57834d3-...` | `9de17f61-...` | Customer White-Label View |

> **Workspace inheritance rule**: Internal view matching checks **`actorId` OR `workspaceOwnerId`** (`session.user.actorId || session.user.id`, or `session.user.workspaceOwnerId`). Adding an internal main account (`caoshuang`, `王卓`, `admin@caoshuang`) to `internalModelViewUserIds` automatically grants the internal full view to all sub-accounts under that workspace as well, while external customer workspaces and their sub-accounts remain strictly on the Customer White-Label View.

## 3. Two-View Architecture

```
                         GET /api/frameos/generation-config
                         GET /api/user/models
                         GET /api/user/api-config
                                       │
                        isInternalModelViewer(config, actorId)
                           ┌───────────┴───────────┐
                           ▼                       ▼
               [Internal Full View]      [Customer White-Label View]
               (caoshuang, 王卓)          (all other accounts)
               - All configured usable    - Only customer-visible `nori::*`
                 provider models across     business models (global +
                 all providers (even if     per-customer overrides)
                 hidden from customers)   - Clean model names only (no
               - Label: 供应商 · 模型名      provider prefix)
               - Includes runtimeModelKey - Omits runtimeModelKey & provider
                 & full health details      names from JSON/health/aliases
               - Direct provider::modelId - Legacy direct keys mapped safely
                 callable in generation     to allowed nori::* or 403 denied
```

## 4. Configuration Schema (`services.prod.json` -> `llm`)

All controls live under `llm` in `/opt/norivideo/data/services.prod.json` (hot-reloaded on file change, editable via Admin Services Console):

```json
{
  "llm": {
    "internalModelViewUserIds": [
      "9de17f61-92a4-4fc6-8bd2-d97551663e15",
      "5e389e8d-29a5-4298-8d70-935e034f8cb1",
      "919094eb-5fe3-43f5-ab8e-3f862b1d0763"
    ],
    "customerVisibleModels": {
      "nori::nori-gpt": true,
      "nori::nori-gpt-max": true,
      "nori::nori-image-mini": true,
      "nori::nori-image-fast": true,
      "nori::nori-image": true,
      "nori::nori-image-pro": true,
      "nori::nori-image-2.6": true,
      "nori::nori-image-2.6-pro": true,
      "nori::norivideo2.5": true,
      "nori::norivideo2.5-intl": true,
      "nori::seedance2.0": true,
      "nori::seedance2.0-fast": true,
      "nori::seedance2.0-mini": true,
      "nori::nori-audio": true
    },
    "customerModelOverrides": {
      "<customer-workspace-owner-or-user-id>": {
        "nori::norivideo2.5-intl": false
      }
    },
    "customerModelRoutingOverrides": {
      "<customer-workspace-owner-or-user-id>": {
        "nori::norivideo2.5": "huimengi::seedance-2.5",
        "nori::nori-image": "huimengi::seedream-5.0-pro"
      }
    }
  }
}
```

### Resolution Precedence for Customer Viewers
1. **Model Visibility (`isCustomerModelVisibleForViewer`)**:
   - `customerModelOverrides[actorId][businessModelKey]` (individual account override)
   - `customerModelOverrides[workspaceOwnerId][businessModelKey]` (customer tenant/workspace override)
   - `customerVisibleModels[businessModelKey]` (global customer default)
2. **Upstream Provider Routing (`resolveBusinessModelRouteForViewer` / `resolveNoriModelRoute`)**:
   - `customerModelRoutingOverrides[actorId][businessModelKey]` (individual account override)
   - `customerModelRoutingOverrides[workspaceOwnerId][businessModelKey]` (customer tenant/workspace override)
   - `modelRouting[businessModelKey]` (global default route)
   - **Authoritative override rule**: If an explicit customer provider override points to a misconfigured/unkeyed provider (or `kuaizi::doubao-seedance-2-5-260628-intl` without `seedance25IntlKzep`), that model is reported unavailable rather than silently routing to a different provider.
   - **Independent from global `modelEnabled` (with Admin UI warnings)**: Turning a video model OFF in `modelEnabled` hides it from internal full-view accounts immediately. For external customers, a runtime provider model explicitly assigned via `customerModelRoutingOverrides` or customer-visible `modelRouting` remains executable (non-breaking), while Admin UI (`/admin/models` and `/admin/customer-models`) surfaces prominent configuration warnings whenever an external customer route points to a globally disabled video service.
   - **Request & Worker Propagation**: Both HTTP API routes (via `setAccountActorContext`) and background BullMQ workers (via `withTaskQuotaContext` restoring `payload.meta.quotaUserId`) expose `{ actorId, workspaceOwnerId }` through `getAccountActorContext()`, so `resolveModelSelection`, `resolveRuntimeModelKey`, capability checks, billing (`calcVideo`/`calcImage`/`calcText`/`calcVoice`), and `recordServiceUsage` all honor each customer's routed provider automatically.
   - **Internal Full-View Isolation**: Accounts in `internalModelViewUserIds` (`caoshuang`, `王卓`, `admin@caoshuang`) match `actorId` only and remain unaffected by customer visibility or customer routing overrides.

### Backwards-Compatible Defaults
When `services.prod.json` has not yet saved `customerVisibleModels` / `internalModelViewUserIds` / `customerModelOverrides` / `customerModelRoutingOverrides`:
- `internalModelViewUserIds` defaults to `[]`.
- `customerModelOverrides` defaults to `{}`.
- `customerModelRoutingOverrides` defaults to `{}`.
- `customerVisibleModels` defaults per business model:
  - Video business models: `true` if the routed target is enabled in `modelEnabled` (and has usable `kzep` for `nori::norivideo2.5-intl`).
  - LLM / Image / Audio business models: `true` if `modelRouting[key]` is non-empty.

## 5. Customer White-Label Display Names

| Business Model Key | Type | Customer Display Name | Default Backend Route |
|---|---|---|---|
| `nori::norivideo2.5` | video | `Seedance 2.5` | `kuaizi::doubao-seedance-2-5-260628` |
| `nori::norivideo2.5-intl` | video | `Seedance 2.5 国际版` | `kuaizi::doubao-seedance-2-5-260628-intl` |
| `nori::seedance2.0` | video | `Seedance 2.0` | `kuaizi::doubao-seedance-2-0-260128` |
| `nori::seedance2.0-fast` | video | `Seedance 2.0 Fast` | `kuaizi::doubao-seedance-2-0-fast-260128` |
| `nori::seedance2.0-mini` | video | `Seedance 2.0 Mini` | `kuaizi::doubao-seedance-2-0-mini-260615` |
| `nori::nori-image-mini` | image | `GPT Image 2.5 Mini` | `openlux::gpt-image-2.5-flare` |
| `nori::nori-image-fast` | image | `GPT Image 2.5 Fast` | `openlux::gpt-image-2.5-flare` |
| `nori::nori-image` | image | `GPT Image 2.5` | `openlux::gpt-image-2.5-sunburst` |
| `nori::nori-image-pro` | image | `GPT Image 2.5 Pro` | `openlux::gpt-image-2.5-sunburst` |
| `nori::nori-image-2.6` | image | `GPT Image 2.6` | `openlux::gpt-image-2.6-flare-c` |
| `nori::nori-image-2.6-pro` | image | `GPT Image 2.6 Pro` | `openlux::gpt-image-2.6-sunburst-c` |
| `nori::nori-gpt` | llm | `Nori GPT` | `deepseek::deepseek-chat` |
| `nori::nori-gpt-max` | llm | `Nori GPT Max` | `deepseek::deepseek-reasoner` |
| `nori::nori-gemini` | llm | `Nori Gemini` | `deepseek::deepseek-reasoner` |
| `nori::nori-deepseek` | llm | `Nori DeepSeek` | `deepseek::deepseek-chat` |
| `nori::nori-audio` | audio | `Nori Audio` | `kuaizi::speech-2.8-hd` |
| `nori::nori-music` | audio | `Nori Music` | _(optional)_ |
| `nori::nori-sfx` | audio | `Nori SFX` | _(optional)_ |

## 6. Security, Redaction & Legacy Compatibility

1. **Zero provider leakage in customer API responses**:
   - `GET /api/frameos/generation-config`: omits `runtimeModelKey`, returns `modelAliases: {}`, sets `modelViewMode: 'customer'`, sanitizes `healthMessage` & `unavailableReason`, and adds neutral `audioModels[i].usesReferenceAudio: boolean` so UI never parses `runtimeModelKey`.
   - `GET /api/user/models`: returns only customer-visible `nori::*` models with clean `customerName`.
   - `GET /api/user/api-config`: returns `providers: []` and only customer-visible `nori::*` models (`provider: 'nori'`).
   - `GET /api/projects/[projectId]/canvas/[canvasId]/agent/models`: omits `providerId` for customer viewers.
2. **Error scrubbing (`src/lib/errors/sanitize-public-error.ts`)**:
   - Strips upstream provider names (`Kuaizi`, `Huimengi`, `AILink`, `OpenLux`, `TopenRouter`, `筷子`, `绘梦工坊`, `火山引擎`, `方舟`), provider domains (`chinadatapay.com`, `kuaizi.cn`, `huimengi.com`, `openlux.ai`, `jinghua.security`), and `kzep_...` endpoint IDs before errors reach users or persisted failure messages.
3. **Server-side authorization on generation endpoints**:
   - `POST /api/frameos/toolbox/generate`, `POST /api/novel-promotion/[projectId]/generate-video`, and `POST /api/novel-promotion/[projectId]/character-audition` validate requested models via `resolveModelKeyForViewer`.
   - Internal viewers can invoke any configured usable provider model (both in HTTP submission and inside background BullMQ workers via `resolveModelSelection(userId, ...)`).
   - Customer viewers are strictly restricted to their visible `nori::*` models (403 `FORBIDDEN` for unauthorized direct provider keys).
4. **Legacy canvas compatibility**:
   - If a customer opens an existing canvas node whose saved `modelKey` is a direct upstream key (e.g. `kuaizi::doubao-seedance-2-5-260628`), and that key matches the currently routed backend of an allowed customer model (`nori::norivideo2.5`), `resolveModelKeyForViewer` and `resolveSelectableModelKeyForViewer` transparently map it to `nori::norivideo2.5` without exposing the upstream key or breaking old canvases.

## 7. Operational Runbook (Post-Deploy)

1. Deploy the release and verify `/api/admin/services` renders the new **客户可见模型 (`customerVisibleModels`)**, **内部全量视角账号 (`internalModelViewUserIds`)**, and **单客户覆盖 (`customerModelOverrides`)** controls.
2. Set `internalModelViewUserIds` to `caoshuang` (`9de17f61-92a4-4fc6-8bd2-d97551663e15`) and `王卓` (`5e389e8d-29a5-4298-8d70-935e034f8cb1`) (plus `admin@caoshuang` if desired) in Admin UI or `/opt/norivideo/data/services.prod.json`.
3. Enable desired `nori::*` models in `customerVisibleModels` (e.g. `nori::norivideo2.5` + `nori::norivideo2.5-intl`).
4. Verify with a customer test account: `GET /api/frameos/generation-config` returns `modelViewMode: "customer"`, zero provider names, no `runtimeModelKey`, and 403 on direct unauthorized `kuaizi::...` submission.
5. Verify with `caoshuang` / `王卓`: `GET /api/frameos/generation-config` returns `modelViewMode: "internal"` with all configured provider models across Kuaizi / 绘梦工坊 / AILink / TopenRouter / OpenLux.
