# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.8.0] - 2026-09-10

### Added

- **The AI Assistant panel is now a tool-calling agent, and it shares one execution path with browser agents.** Until now the panel was a single-shot text generator: one reply holding a ```flowdrop block, then a click to apply, with the whole node-type catalogue re-sent on every message and no way to ask before acting, save, run, or watch a run. In the new **tools mode** (behaviour setting **`chatMode: 'tools'`**, the default) a user message is one _turn_: the panel sends its tool catalogue with the message, the server answers with tool calls, the panel runs them and posts the results, and the loop continues until the assistant answers in text. The tools are the editor's WebMCP editor tools — `describe_type`, `search_types`, `batch`, `save`, `run`, `run_status`and the rest — run through the **same runtime the WebMCP registration uses**: same argument validation, same layout opt-out, same approval dialog (reads run unasked; document changes ask once per round with the batch summary;`save`and`run` always ask), same one-transaction-one-undo-step, same teaching errors. The transcript shows each call as a compact status line — reading, waiting for approval, applied with the dialog's own summary, rejected, failed — and a rejection is a result the model reads, not the end of the turn.
  - **Protocol.** The first request of a turn is a `ChatTurnRequest` — the existing `ChatRequest` plus `tools: ChatToolDefinition[]` (`{name, description, input_schema, readOnly}`, bare verbs, no prefix). The server answers a `ChatTurnResponse` (`turnId`, `toolCalls?: [{id, name, args}]`, `content?`, `done`). Tool results go to a new endpoint, **`chat.toolResults`** (`POST /workflows/{id}/chat/turns/{turnId}/tool-results`, body `{results: [{toolCallId, content, isError?}]}`), via **`chatService.sendToolResults()`**. The endpoint is optional in `EndpointConfig`; the default preset carries it.
  - **Graceful with an older backend.** A server that ignores `tools` and answers a plain `ChatResponse` (no `turnId`) puts the panel into the text mode for the rest of the session, with one notice in the transcript. **`chatMode: 'dsl'`** selects the text mode outright; it is deprecated and will be removed one minor after tools mode ships in fddo, together with `chatAutoRetry` and the panel's use of `CommandPreview`.
  - **fdnpm owns the catalogue.** `toToolDefinitions(runtime)` (new, `@flowdrop/flowdrop/chat`) projects the runtime's descriptors; the server holds no copy of the schemas. Measured 2026-09-09: 13.3 kB with all 25 tools, 10.7 kB without `view` and the host tools; `catalogueBytes()` is exported for hosts that want to check.
  - **One gate per editor.** Whichever agent surface comes first — the WebMCP registration or the panel — creates the approval gate and publishes it as **`instance.approvalGate`**; the other reuses it. One "don't ask again for edits" covers both surfaces, and two dialogs never stack. The dialog still says who is asking: `GateRequest` gained **`title`**, `ToolRuntimeOptions` gained **`dialogTitle(editorName)`**, and the panel passes its own wording through them. `ToolPreview` now reports what `runTool` will actually do — `commands` after the layout opt-out, the **`skipped`** layout commands, and **`asks`**, true only when the call will wait on the gate (not under `approval: 'auto'`, not once edits are pre-approved, always for `save` and `run`); the transcript's "waiting for your approval" line comes from `asks`. A server that continues a turn (`done: false`) with no tool calls is reported as an `aborted` outcome, not rendered as an empty reply. `summarizeCommands` moved to the descriptors module (still exported from `@flowdrop/flowdrop/webmcp`); `WebMCPConfirm` takes `title` instead of `editorName`.
  - **Host hooks reach the panel.** `mountFlowDropApp` now publishes its `onSave` (its own Save) and the `onRun`/`onRunStatus` hooks on the instance as **`instance.host`** (`HostHooksStore`), whether or not WebMCP is on, so the assistant persists and runs exactly the way a browser agent does — and exactly the way clicking Save does. A new mount option **`host: { onSave?, onRun?, onRunStatus? }`** carries them; hooks given inside the `webmcp` option take precedence and, the other way round, `webmcp: true` now picks up the `host` hooks, so a Drupal host passes them once and both surfaces share them. Svelte hosts set `instance.host.set({...})` themselves.
- **`createToolRuntime()`** (new, `@flowdrop/flowdrop/webmcp`) — the execution body behind every WebMCP tool, extracted from the registration as one `runTool(name, input): Promise<ToolResult>` over editor tools and host tools alike, plus `preview(name, input)` (what a call would do), `descriptors`, `hostTools`, `gate`, `dispose()`. `attachWebMCP` is now registration only and behaves identically. Also exported: `buildHostToolDescriptors(hooks)`, `createApprovalGate`, `summarizeCommands`, `GateBusyError`, and the types `ToolRuntime`, `ToolRuntimeOptions`, `ToolPreview`, `HostHooks`, `HostToolDescriptor`, `ApprovalGate`, `GateRequest`, `CreateGateOptions`. An unknown tool name answers `UNKNOWN_TOOL` with the names it has.
- **`runTurn(request, deps)`** (new, `@flowdrop/flowdrop/chat`) — the turn driver, free of Svelte and the DOM: `send` → for each call `runTool` → `sendToolResults` → until `done`, emitting `TurnEvent`s (`reading`, `awaiting-approval`, `applied`, `rejected`, `failed`, `round-complete`, `final`) and returning a `TurnOutcome` (`final` | `legacy` | `aborted`). A client-side `maxRounds` (default 32) backstops the server's own bound. With `parseOutcome`, `toolResultText` and the types `TurnDriverDeps`, `TurnEvent`, `TurnOutcome`, `ToolOutcome`.
- **New chat types** in `@flowdrop/flowdrop/chat`: `ChatToolDefinition`, `ChatToolCall`, `ChatToolResult`, `ChatToolResultsRequest`, `ChatTurnRequest`, `ChatTurnResponse`. New strings under `defaultMessages.chat.tools` (`reading`, `read`, `awaitingApproval`, `applied`, `rejected`, `failed`, `rounds`, `legacyFallback`, `aborted`, and `confirmTitle` — the approval dialog says the assistant is asking, not a browser agent). The Settings panel gained "AI Assistant Mode". The MSW mock backend scripts one round of reads for a tool-calling turn so the dev pages exercise the mode.

- **API refusals arrive with their reasons.** `ApiError.details` holds the server's reasons behind `message` — for a fddo validation failure the `details[].message` strings, for a 403 the permission the user lacks. Error toasts render them as a list under the headline, the WebMCP `save` tool relays them to the agent, and the exported `ToastOptions.details` / `ToastOptions.id` let a host do the same. New exports: `parseApiErrorBody`, `errorDetails`.
- **Hosts can hide the Command Console and the AI Assistant.** Two new feature flags, **`features.console`** and **`features.assistant`** (both default `true`), drop the matching tab from the console / AI Assistant group wherever it is hosted (sidebar, bottom panel, modal). With one tab left the strip collapses to a plain panel; with both off the canvas toggle button and its backtick shortcut disappear too. Independent of the flag, the AI Assistant tab is now offered only when the endpoint configuration carries a `chat` group — before, a host without a chat backend still got the tab with a dead "requires backend configuration" notice. Browser agents (WebMCP) are unaffected either way; they drive the tool runtime, not the panel.
- **Tools mode reports a failed turn deterministically, instead of trusting the model's closing prose.** A `batch` call that fails and rolls back no longer lets the assistant's final text claim success unchallenged: `runTurn`'s final `TurnOutcome` and `'final'` `TurnEvent` now carry `failed`/`rejected` counts over the whole turn, and the panel shows a warning under the reply (`defaultMessages.chat.tools.failedSummary`) whenever `failed > 0`.
- **Interim model text now shows up in the trace.** A non-final `ChatTurnResponse` can carry `content` alongside `toolCalls` — text the model wrote next to its calls, e.g. "this node has no url input port". The driver emits it as a new `'note'` `TurnEvent`, and the panel renders it as an italic note line in the tool trace.
- New tool-line status `'note'` and `DisplayMessage.warning` in `AIChatPanel.svelte`.

- **`ApprovalGate.asks`** — whether the gate can ask at all (`false` under `approval: 'auto'`). `ToolPreview.asks` reads it, so the transcript's "waiting for your approval" line is honest for a shared gate too: before, a runtime given another surface's gate assumed it asked.

### Fixed

- **The AI Assistant panel no longer clears an approval gate it did not publish.** Closing the console after a tools-mode message used to null `instance.approvalGate` even when the WebMCP registration had published it, so the next panel built a second gate — one "don't ask again" per surface, and two dialogs could stack. The panel now clears only the gate it created. A turn still in flight when the panel unmounts keeps its runtime until the turn ends instead of answering `DETACHED` to the model for the rest of the round, and the transcript scrolls as tool lines and the reply grow.

### Changed

- **Error and warning toasts stay until dismissed.** `TOAST_DURATION.ERROR` and `TOAST_DURATION.WARNING` are now `Infinity`; both toasts carry a close button, and a toast with the same text replaces the one already showing instead of stacking. This is a policy change for the exported `showWarning`: the editor treats a warning as something the user should act on, not a "done, by the way". A caller that wants an informational warning passes a finite `duration`. Warnings also wear their own icon and colour instead of the error's.
- **The API client retries only what can change.** Network failures, 408, 429 and 5xx are retried; every other 4xx is a refusal and is thrown at once. A stale save used to send three PUTs and get three 409s.
- **The WebMCP approval dialog now looks like the rest of the editor.** `WebMCPConfirm` follows the Settings modal shell — blurred backdrop, header / body / footer on the `xl` spacing rhythm, an `lg` title, the command list as a bordered card, a 16px checkbox, an enter animation, a bottom-sheet layout under 640px — and its buttons compose on `.flowdrop-btn` (`--primary` / `--outline`) instead of one-off styles. Test ids are unchanged.

## [2.7.0] - 2026-09-09

### Added

- **A browser agent can now _finish_ a workflow, not just edit one.** Building a four-node fetch-and-convert flow through the 2.6.0 tools showed the gaps: an agent could not learn a node type's ports or config without adding a node first, could not tell whether the result was valid, and could not run it. The editor-tool set closes them, on one rule — **the tools read only what the editor has already fetched** (the node type catalog and the open workflow); no new endpoints, no per-tool round trips.
  - **`describe_type`** (new command and tool, read-only) describes a node type before it is used: input and output ports with data type and required flag, every config key with type, enum, default and description, and — when the host publishes them — the **confirmation policy** (`ask` means a run pauses for a person at this node), what the user may do with it (`can`) and host-written guidance (`agent`). Three new optional fields on `NodeMetadata` carry those: `confirmation`, `can`, `agent`; the library passes them through verbatim.
  - **`search_types { query }`** (new command and tool, read-only) finds node types by a case-insensitive substring of id, name, description or tags; a blank query is refused with `EMPTY_QUERY` (new `CommandErrorCode`) instead of returning the catalog. **`list_types` rows now carry `description` and `tags`.** The text DSL gained `describe <type>` and `search <text>` to match, and the command console formats both.
  - **`get_config` returns the schema next to the value**, and its `key` is optional: without one it answers every current value under `values` and the whole config schema. `get <nodeId>` works in the DSL too. The result is one of two shapes — `GetConfigKeyResultData` (`key`, `value`, `schema?`) or `GetConfigAllResultData` (`values`, `schema[]`) — narrow on `'key' in data`.
  - **Errors teach.** A failure names the valid alternatives instead of stopping at "not found": an unknown node lists the workflow's nodes (or says to `add_node` first on an empty canvas); an unknown type names near misses and points at `list_types`; an unknown port lists the node's ports on both sides; a missing edge lists the edges leaving that node; an unknown config key lists the keys. Lists are capped at 15. `set_config` on a key the schema does not declare is still stored (hosts keep config open) but now carries an **`unknown_key` warning** with the declared keys — fatal only under `strict`.
  - **Tool descriptions carry the call order.** `add_node`, `set_config`, `swap_node` and `batch` — the tools that take a type or a config key — end with "call `describe_type` before adding or configuring a type you have not seen; group several changes in one `batch`; `save` when done", and examples use type ids that exist (`http_request`, not `llm_node`).
  - **`run` and `run_status`** tools, behind two new host hooks on `attachWebMCP` and the `webmcp` mount option: **`onRun(inputs) → Promise<HostEnvelope<RunStarted>>`** and **`onRunStatus(runId) → Promise<HostEnvelope<RunStatus>>`**. `run` is gated like `save` and flagged consequential; `run_status` is a read. A paused run is relayed as **`code: 'PENDING'`** with the node id and message it waits on — a person must act in the editor; no tool answers an interrupt, on purpose. `run_status` is registered only when both hooks are given; neither tool exists without its hook.
  - **One result envelope for host hooks.** `onSave`, `onRun` and `onRunStatus` may answer `{ ok, code?, message?, data?, can? }` (`HostEnvelope`), with the codes `FORBIDDEN`, `UNAVAILABLE`, `NEEDS_APPROVAL`, `INVALID`, `CONFLICT`, `PENDING`, `NOT_FOUND` — aligned with fddo's API-8 `error_code` vocabulary where the two meet. The tool relays `code`, `message`, `data` and `can` untouched. `onSave` may still resolve to nothing (saved) or throw (`SAVE_FAILED`); a thrown error that is a 409 or carries `errorData.error_code === 'CONFLICT'` is relayed as **`CONFLICT`** with a reload hint.
  - **The server stays the authority; the client pre-empts.** A workflow payload may now carry **`can: { save, run, … }`** and a **`revision`** (two new optional fields on `Workflow`). `save` and `run` answer `FORBIDDEN` before opening a dialog when `can` says no; when the host says nothing, the server decides. The save path sends the loaded `revision` back so a server that checks it can refuse a stale write, and takes the new `revision`/`can` from the response (`instance.workflow.acknowledgeServer()` — bookkeeping only, no history entry, no dirty flag).
  - **The confirm dialog summarises a batch** — "4 changes — adds 2 nodes, connects 1 edge, sets 1 config key." — above the line list, and offers **"Apply further edits from any agent on this page without asking, until this page is closed"** — worded as what it does: the gate cannot tell one agent from another, so once ticked every caller on the page is covered. Ticked (and approved), later _edits_ run without the dialog; `save` and `run` always ask and never offer the box. Off with **`rememberEdits: false`**. Nine new strings under `defaultMessages.webmcp` (`runLine`, `runHint`, `summary*`, `batchSummary`, `rememberEdits`); Tab now cycles Apply → Reject → checkbox.
- **A browser agent can now save.** Feedback from the first WebMCP release: the first batch of nodes an agent added vanished on reload because nothing had persisted them — `flowdrop_add_node` and friends change the in-memory workflow, but only the editor's own Save button wrote it to the server. There is now a **`flowdrop_save`** tool: registered whenever `attachWebMCP` is given an **`onSave: () => Promise<void>`**, and automatically on the `mountFlowDropApp` path, where it defaults to the mount's own Save unless the host supplies its own `onSave`. Like any change, it asks — a save cannot be undone from the editor — and its `annotations` carry the new **`consequentialHint: true`** (added to the WebMCP spec 2026-09-03: "executing the tool will result in consequential actions that are significant, real-world, or non-reversible"). Approval callbacks (`WebMCPApproval` functions) now receive a second argument, `(commands, { tool })` — additive, existing one-argument callbacks keep working; for `save` the `commands` array is empty and `request.tool === 'save'`.
- **A bridge to desktop MCP clients, for browsers without the origin trial** (`installBridgedModelContext`, `createBridgedModelContext` in `@flowdrop/flowdrop/webmcp`). Presents the same `modelContext` surface over a page-side relay widget of the [`@jason.today/webmcp`](https://github.com/jasonjmcghee/webmcp) shape (`registerTool(name, description, inputSchema, execute)`), so Claude Code, Claude Desktop or Cursor can call the editor tools through a localhost MCP server the user runs and authorises with a token. Install it before the editor mounts; it is a no-op when a real runtime exists. The widget cannot unregister a tool, so after the editor is destroyed its tools answer a structured `UNAVAILABLE` until the page unloads. The relay's server times a tool call out after 30 seconds — a confirm dialog left open longer returns a timeout to the agent while the dialog stays up. The gate, `can` and the server's permissions apply unchanged; hosts should make the bridge an explicit opt-in.
- **New exported types** from `@flowdrop/flowdrop/core` and `/commands`: `DescribeTypeCommand`, `SearchTypesCommand`, `TypeSummary`, `PortDescription`, `ConfigKeyDescription`, `DescribeTypeResultData`, `SearchTypesResultData`, `GetConfigKeyResultData`, `GetConfigAllResultData`; from `/webmcp`: `HostCode`, `HostEnvelope`, `RunStarted`, `RunPending`, `RunStatus`, `WebMCPApprovalRequest`, `WebMCPWidgetLike`, `BridgedModelContext`. `NodeMetadata` gained `confirmation`, `can`, `agent` (`NodeConfirmation`, `NodeAgentGuidance`); `Workflow` gained `can`, `revision`.

### Fixed

- **`mountFlowDropApp(...).save()` and `globalSaveWorkflow()` resolve `true` when the workflow was written and `false` when nothing was saved** (no workflow, or `onBeforeSave` cancelled). Before, both resolved to nothing either way, and the mount path's default `save` tool reported "Workflow saved" on a cancelled save. It now answers `{ ok: false, code: 'UNAVAILABLE' }`. Widening `void` to `boolean` is additive for callers.
- **The WebMCP confirm dialog no longer renders in the browser's serif fallback on Drupal.** The dialog mounts on `document.body`, outside the editor, and used `font-family: inherit` — on admin themes that scope their font to a wrapper, that is Times. It now uses a new public token **`--fd-font-sans`** (a system-ui stack), with an explicit size and line-height, so it reads like the editor wherever it is mounted. Hosts can override the token at `:root`.
- **`set_config` no longer warns "Expected type 'string,boolean' but got 'string'"** when a node config property declares several JSON Schema types; the warning now reads `Expected type 'string' or 'boolean' but got 'number'` and fires only when the value matches none of them.

## [2.6.0] - 2026-09-03

### Added

- **The editor's commands are now WebMCP editor tools.** A browser-resident agent — Chrome 149+ and Edge 150+ behind the WebMCP origin trial, Brave Leo, ChatGPT Desktop — can discover the open editor's tools on the page and drive it: `flowdrop_list_types`, `flowdrop_add_node`, `flowdrop_connect`, `flowdrop_set_config`, `flowdrop_info`, `flowdrop_undo`, a `flowdrop_batch` that runs several as one transaction, and the rest of the command layer; one tool per command, each with a JSON Schema derived from the `Command` union, so the agent gets structured errors and argument completion rather than a text grammar to guess at. New subpath **`@flowdrop/flowdrop/webmcp`**: `attachWebMCP(instance, { nodeTypes, … })` for Svelte hosts, and a **`webmcp: true | WebMCPMountOptions`** option on `mountFlowDropApp` for vanilla and Drupal hosts, which loads the adapter on demand so the core entry is unchanged. No-op in a browser without the API.
  - **These are tools for editing a workflow in the browser.** They are unrelated to the tools a running workflow hands to an LLM node; the docs call them _editor tools_ and nothing else.
  - **Reads run; changes ask.** Classification is the chat panel's `isMutatingCommand`, unchanged. A mutating call opens a confirm dialog inside the page listing exactly what will run, and nothing touches the workflow until the person at the keyboard clicks Apply. `approval: 'auto'` turns that off for hosts that already trust every agent on the page; `approval: (commands) => Promise<boolean>` plugs in your own gate. While one decision is pending a second mutating call is refused with `BUSY` — dialogs never stack. This matters because WebMCP's permission model is about which origins may _see_ tools, not whether a given call may change the user's document: any agent or extension on the page can call them.
  - **Every call is one transaction and one undo step**, like an approved chat batch; a batch whose third command fails leaves the workflow exactly as it was and says so. The layout opt-out (`chatAllowLayoutChanges`) is honoured with the chat panel's wording — same setting, no new one.
  - **`clear` is never exposed.** An agent can delete nodes one at a time and each deletion is gated. `help` is not exposed either; the schemas are the help. A test asserts every literal in the `Command` union is either mapped or on that exclusion list, so the next DSL verb cannot slip through unclassified.
  - **Two editors on one page** need distinct `prefix`es; the second `attachWebMCP` with the same prefix throws rather than silently shadowing. Every tool description carries the workflow's name so an agent facing two editors can tell them apart.
  - **`view` needs a host.** The `flowdrop_view` tool (select node, open config, zoom, pan) is registered only when `onUIAction` is supplied, because the mount path has no handler for it; the `webmcp` mount option therefore registers everything except `view`.
  - The spec is an origin trial and has changed shape once already. The adapter probes `document.modelContext` and, structurally, the earlier `navigator.modelContext`; registers under an `AbortSignal` (the spec's only removal path) and also calls `unregisterTool` where a pre-spec runtime has one; and touches the runtime from one file. `createFakeModelContext()` is exported for hosts' own tests — CI has no browser agent, and neither does the storybook, which drives the tools from a fake-agent side panel instead.
  - **A `view` call does not ask.** Selecting a node, opening its config panel, and moving the canvas viewport change what the editor shows and nothing in the workflow — there is nothing to undo — so they run without the dialog even under `approval: 'confirm'`. The classifier gained a third class for this, `isViewCommand()` and `VIEW_COMMAND_TYPES` in `@flowdrop/flowdrop/chat`; `isMutatingCommand()` is unchanged, so the AI Assistant panel still treats them as click-to-apply. `undo` and `redo` change the document and still ask. A batch that mixes view and change items asks once, for the whole batch, and lists every line.
  - **`handle.tools` lists what the runtime accepted.** Registration is asynchronous in the spec, so the handle gained **`ready: Promise<void>`**, which resolves once every registration has settled; a tool the runtime refuses is warned about once through the library logger and never appears in `tools`. Hosts that only read `app.webmcp?.tools` after the fact need not care.
  - **The `webmcp` mount option costs no request and no time.** `mountFlowDropApp` resolves as before; the adapter attaches in the background once the workflow is loaded and reads node types from the instance rather than fetching them a second time. `app.webmcp` is therefore `undefined` for a moment after mount even when the browser has the API. The **`nodeTypes` option of `attachWebMCP` is now optional** and defaults to the instance's list.
  - **The confirm dialog is translatable.** Its four strings live under a new **`webmcp`** group in `defaultMessages` (`confirmTitle`, `confirmCount`, `reject`, `apply`); `attachWebMCP` and the `webmcp` mount option take a `messages` override in the same shape as the `messages` prop. The dialog also keeps focus inside itself — Tab moves between Reject and Apply, Escape rejects — instead of listening on the window.
  - Every tool description names the workflow, so attachment waits until the workflow is loaded; the name is the one at attach time and a later rename is not re-registered.
- **`instance.onDestroy(fn)`** registers a callback for when a `FlowDropInstance` is destroyed and returns an unsubscribe. The WebMCP adapter uses it to detach itself; a host integration that binds to an instance can hook its own teardown there instead of wrapping `destroy`.
- **`instance.nodeTypes`** holds the node types the editor currently knows — what `App` fetched or was given, merged with the format-provided nodes — as a small store with `current` and `set()`. Anything outside the component tree that needs the list reads it here instead of fetching again.

- **"Add input" / "Add output" in the workflow interface editor opens an inline composer instead of dropping in a blank row.** A clearly separate two-step draft form asks first whether the new entry should bind to an existing port. _Yes_ opens a custom port picker: ports nothing is using yet are listed first under **Available**, then the ones that already have an edge or are already published, each row showing the port's type, `node › port`, description and a **Connected** / **Published as …** / **Required** badge — the metadata a native select cannot show — with a search box and full keyboard support (arrows, Home/End, Enter to add, Escape to close). Picking a port adds an entry pulled from it: bound, with name, type, description, required and default copied and the id seeded from the port's own id (suffixed if taken). _No_ adds an empty, unbound entry exactly as before. Two new pure helpers in `utils/workflowInterface`, `rankBindablePorts()` and `entryFromBindablePort()`, back the picker. Each row wears the same two chips a port row wears on the canvas — the shape symbol in the lane's colour and the outlined lane-name chip — so a candidate is recognisable as the port it points at, and the fixed-width symbol keeps the rows aligned. The editor takes an optional `checker` prop (`fd.portCompatibility`) for this, defaulting to a checker over the built-in port config.
- **An existing entry's "Bound port" is the same picker.** The native select and the separate "bound port, said back" line are one control now: a select-shaped button showing the bound port the way the canvas shows it — shape symbol, `node › port`, lane chip — that unfolds the same searchable, grouped listbox the composer uses, with the entry's own port marked **Current** and an **Unbind** action beside Cancel. A click binds and folds the picker away; a dangling binding shows its raw `node › port` ids in red. **Pull from port** moved into _More options_, the fields it fills. The listbox itself is a new component, `BindablePortListbox`, and `bindablePortKey()` in `utils/workflowInterface` is the key both callers compare bindings by.

### Changed

- **Each side of the interface ends in its insertion slot.** The **Add input** / **Add output** action left the section header for a dashed, full-width slot after the last entry — where the new entry will land — and the composer opens in that slot's place, so the draft sits exactly where the entry it becomes will sit. An empty side is now just its slot; the "No inputs declared yet." / "No outputs declared yet." placeholders are gone, and their message keys `workflowInterface.noInputs` / `noOutputs` with them. The `.wf-interface__add` class now names the slot, and `.wf-interface__empty` no longer exists.
- **The entry health dot is gone.** The small coloured circle beside each interface entry said what the card already says: a bad binding gets the card's error border and a sentence under the field or in the footer, and an entry that is fine says nothing — neutral is the good state. `.wf-interface__dot` no longer exists.
- **The workflow interface editor now looks like the rest of the settings panel.** Entries are cards on the panel's card surface, using the shared `Input`, `Select`, `Button` and `IconButton` controls and the settings form's label voice, so the Interface tab no longer reads as a foreign screen next to the Settings tab. A bound entry says its target back as a type chip and `node › port` line with the pull action beside it; the entry health dot has a soft halo; status messages are tinted callouts instead of bare coloured text; the empty state is a quiet dashed placeholder; section titles carry an inputs/outputs glyph and an entry count. Markup, message strings and the `wf-interface__*` class names are unchanged, so existing overrides and tests keep working.
- **A `tool` input can now be published in the workflow interface.** The binding picker in the interface editor offers a consumer node's `tool`-typed input (a ToolBox's or LLM node's `tools`) alongside data ports, so a parent workflow can hand its tools to a sub-workflow through the child's declared contract instead of the child carrying its own copy of every tool node. Tools are a typed argument of a workflow's execution (fddo DF9); the server decides what binding them means. `trigger` ports, the `loop_back` port and `tool` _outputs_ remain intra-graph control flow and stay out of the picker.
- **Small buttons are 28px.** `.flowdrop-btn--sm` was 32px tall while `IconButton`'s `sm` was 28px, so the two could not share a row without the caller overriding one of them; the interface editor had grown three such overrides. `.flowdrop-btn--sm` now sizes from the same token (`--fd-size-icon-btn`) with no block padding, and the overrides are gone. **Every `size="sm"` button in the library is 4px shorter** — the settings panel, the interface tab, the chat panel and the toolbar all use it.

- **Unit tests resolve Svelte's client build.** `vite.config.ts` sets `resolve.conditions: ['browser']` under Vitest, as the Svelte testing docs recommend; without it `mount()` resolved to the server build and threw `lifecycle_function_unavailable`. Existing suites are unaffected (1716 tests, all green); it is listed because it changes what a new component test can do.

## [2.5.0] - 2026-08-23

### Changed

- **Six port lanes change colour, and two hues become reserved.** The lane palette had grown by accretion and had stopped carrying information: `file`/`file[]` wore red alongside `error`, so a failed run and a PDF read the same on the canvas; `video` and `messages` sat in the same family; `trigger` was purple, shared with `boolean`, and matched neither its own wire nor the colour the server sent. `tool` needed no move — it was already amber, and is now reserved there. The re-cut: **`file`/`file[]` red → teal**, **`video` teal → fuchsia**, **`messages` fuchsia → orange**, **`array` amber → violet**, **`trigger` purple → ink**. **This is a visible change on every canvas** — handles, chips and shape glyphs on those lanes are a different colour — and it is a change to `DEFAULT_PORT_CONFIG` only, so an app serving its own port config is untouched.
  - **`--fd-node-red` is reserved for `error` and `--fd-node-amber` for `tool`.** Point a data lane at either and you undo the one distinction the palette exists to carry. `amber` and the new `ink` must also track their wires — `--fd-edge-tool` and `--fd-edge-trigger` — or an edge changes colour halfway along its length.
  - The rule behind the rest: **a complex lane wears the hue of the shape it is made of.** `messages` joins `json`/`json[]` on orange because a message list is an array of objects; a _typed_ array inherits its element's hue (`string[]` emerald, `file[]` teal), which is why only the untyped `array` needs a token of its own; and an unclear shape falls back to the sink's slate. `docs/theming.md` now lists which lanes wear which token and states all of this, instead of printing a bare hex table.
  - Two new tokens, both `@public`: **`--fd-node-violet`** (`#7c3aed` light, `#a78bfa` dark) for the untyped `array`, and **`--fd-node-ink`** for `trigger` — deliberately not a hue, resolving to `--_gray-9` / `--_gray-3` exactly as `--fd-edge-trigger` does. A fixed `#18181c` here disappears against the dark canvas.
  - `flowdrop` (the Drupal module) moves its served payload identically, so an editor running against library defaults and one running against that payload agree on **all 24 lanes** — verified pairwise.
  - Also documented in `docs/theming.md`, because it is the trap under all of this: if you redeclare `--fd-node-*` in a stylesheet that loads **after** this library's, redeclare the dark block too. A bare `:root` override loading later wins in both themes at equal specificity and silently flattens dark mode to the light values.

- **`WorkflowInterfaceEntry.schema` is a property fragment, not an object schema.** It was typed `InputSchema | OutputSchema` — a whole `{properties: {…}}` object — while nothing in the library populated it, which would have been wrong the moment something did. It is now `WorkflowInterfaceSchema` (`Partial<InputProperty>`): one port's JSON Schema fragment, every key optional, derived from the existing property type rather than restated. No runtime behaviour changes; nothing read or wrote this key.

- **The server's `dataType` on an interface entry is now the port's lane.** This library has always typed `WorkflowInterfaceEntry.dataType` as `NodeDataType` and rendered it through the lane-vocabulary picker, but fddo filled it with the fragment's JSON Schema `type` — so an `error` port arrived as `object` and a `messages` port as `array`, and the panel's lane chip contradicted the port the entry was bound to. fddo now sends the lane there and the JSON Schema fragment in `schema`. Nothing changes on this side of the wire; the values simply stop lying. **Needs a backend that serves it** — an older fddo still sends the JSON Schema word.
  - Unchanged, and worth knowing: the server derives both keys from the bound inner port and **ignores them on write**. An author picking a lane in the interface panel is choosing a value the next read replaces. Persisting an author-chosen lane needs a server column that does not exist yet.

## [2.4.0] - 2026-08-23

### Added

- **A port's shape now comes from the server when the server declares one.** fddo 2.x serves a JSON Schema per lane (`PortDataTypeConfig.schema`, from its port-shape registry), and `portShape()` reads that schema's `type` ahead of the client's static lane table. The table stays as the fallback — it is what answers on an older fddo, on a third-party server implementing only the port-config endpoint, and on the library's offline defaults, which carry no schemas on purpose. A site's own shape now shapes its own lane: declare `Order` as `type: object` and its ports draw `{}` without this library having heard of it.

- **Template variables drill into the fields a port's lane declares.** A template author could reach an `error` port and nothing inside it. A port with no schema of its own now resolves one from its lane, so the four fields of an error payload are offered as `error.message`, `error.code`, `error.node_id` and `error.retryable` — declared once on the lane, restated nowhere. `NodePort.schema` stays empty and stays the per-port refinement slot: what wants it is the narrower schema a run observed for this port on this node, which is per-instance information and could never travel on a payload cached per node type.
  - **This needs a backend that serves it.** fddo serves lane schemas on `2.x`; anything older serves none, and autocomplete then stops at the port exactly as it did before. One caveat worth knowing: a site with a stored `port_config` entry for a lane replaces the composed entry outright, `schema` included — so a site that once customised the `error` lane sees no field list until it re-adds one. That is the port-config overlay's existing whole-entry merge semantics, not a new rule.

### Changed

- **`getVariableSchema()`'s trailing arguments became one context object.** It had grown to eight positionals, the last three optional and one of them a service, so a call site read `..., workflowId, authProvider, fd.portCompatibility)` and could not be read without counting commas. It is now `(endpointConfig, node, nodes, edges, config, {workflowId, authProvider, portCompatibility})`. **Not a public break** — `variableService` is not exported from any package entry point; the change is listed because its docblock's examples were wrong in the released source (they omitted the first argument entirely) and are now correct.

### Deprecated

- **`portGlyph()`** — use `SHAPE_GLYPH[portShape(checker, port)]`, which is what it does. Both it and the map shipped in 2.3.0's public surface and only one of them needed to. It keeps working until 3.0.0.

### Fixed

- **The reserved `error` port drew `?` on every node.** fddo declares the `error` lane as `type: object` and has since its shape registry shipped; the client's lane table has no `error` entry, so the shape fell through to `unknown` while the lane chip beside it was correctly coloured red and — after the change above — while autocomplete was offering the payload's four fields. It draws `{}` now. Same class of disagreement for any served lane the table does not name.

- **Six responsive utility classes had never matched anything.** `.flowdrop-sm\:flex`, `.flowdrop-md\:hidden` and their siblings escaped the colon twice, so the selectors were never valid; nothing in the library or the demo apps used them, and this repo lints no CSS, so nothing was ever going to say so. Removed rather than repaired — two display utilities across three breakpoints is not a responsive system, and a consumer needing one can write it against their own breakpoints.

## [2.3.0] - 2026-08-22

### Added

- **A port says what SHAPE it carries, separately from which LANE it belongs to** — every port row on the canvas and in the inspector now draws a small coloured glyph for its JSON-Schema shape (`S` text, `#` number, `B` true/false, `[]` list, `{}` object, `?` unknown, `T` trigger, `()` callable) beside a quiet outlined chip holding the lane's name. Colour used to carry both facts at once and so carried neither well: `messages` and `json` are different lanes with different colours, but nothing on screen said one was a list and the other an object. Now the glyph says the shape, the colour still says the lane, and the whole treatment survives with colour stripped.
  - **This is a visual change on every node.** The lane chip is outlined rather than filled, and it now reads the lane's served display name (`String Array`) where it used to print the raw id (`string[]`). The id moves into the chip's tooltip, which previously just repeated the text. Badging the id is why authors read `datetime` and `messages` on a canvas, and why naming pressure landed on lane ids that other repos pin — with the name in the chip, ids go back to being machine keys and a site can ship a lane called "Customer Order" whose id is `order`.
  - **The row is laid out as two columns.** The shape glyph sits against the node's outer edge beside its handle and the lane chip against the node's inside, with the port name filling the space between and ellipsizing when it runs out. Both columns hold their x-position down the whole node, so shape is scannable vertically — which is what earns it the row's one saturated mark. The cost is that the chip now sits further from the name it describes.
  - **Where the shape comes from.** The server's `NodePort` carries no JSON Schema type — `schema?` has been declared "for template autocomplete" since 2.0 and no producer has ever populated it — so the shape is derived from the lane by a static table. That ships against every backend, including older fddo and third-party servers implementing only the port-config endpoint. It cannot tell `integer` from `number` (the server already collapses both onto lane `number`, so nothing is lost) and it answers `?` for a site-defined lane, which is honest rather than wrong.
  - **The media lanes `file`, `image`, `audio`, and `video` draw `?`.** Asked directly, the reference backend has no answer: they are served vocabulary with no declaring port, and its schema-type→lane resolver cannot emit them. "A URI string" was a plausible guess with nothing behind it.
  - **A gateway's branch rows get the same treatment, in the same order** — a branch reads `(Trigger) Name [T]` against the node's right edge like every other output row, so the shape glyphs line up as one column beside their handles. The gateway draws its rows through `PortTypeBadge` instead of composing them itself, which is the only reason the order can no longer disagree between the two; the badge grew a `label`, an `active` flag and a leading slot for it, because a branch is an authored control-flow path with no port id and no port name. `active` is a flag rather than a class name on purpose: Svelte's scoped CSS does not reach into a child component, so a caller passing its own class would hand over one that never applies.
  - **The lane id is now mouse-only.** It lives in the chip's `title`, which is not reachable by keyboard or screen reader; the served name in the chip text is. The glyph itself is `aria-hidden`: it restates the lane beside it, so announcing it would add an utterance per port and no information.
  - New exports from `@flowdrop/flowdrop/editor`: `portShape`, `portGlyph`, `SHAPE_GLYPH`, the `PortShape` type, and the `PortTypeBadge` component. New public CSS classes `.flowdrop-port-symbol`, `.flowdrop-badge--outline`, and `.flowdrop-badge--sm`. The symbol chip takes only its colour inline, as `--fd-port-symbol-color`; everything else about it — including the tint ratios and the `--fd-port-skin-color` override — is in the stylesheet, so a consumer can restyle it without `!important`.
  - `portShape(checker, port)` is the seam for improving the source: a release where the server declares a shape per lane, or populates `NodePort.schema`, changes that one function and no call site. It takes the port-compatibility checker — the same source colour reads — so a lane resolves to a shape exactly as it resolves to a colour: aliases followed, casing ignored, served vocabulary first. A lane with a colour and no shape would draw a coloured `?`; the two tables are now asserted total over each other.

- **`pipelineSignalService` has tests** — it had none. Every refusal it returns drives a different user-visible explanation, and the mapping was entirely unasserted. Both classification paths are now pinned, along with accepted-is-not-applied, the unsupported-backend case, and the synthesized-message fallback.

### Fixed

- **On library defaults, no port could connect to anything** — `createDefaultConfig()` shipped `ports` as `{dataTypes: [], compatibilityRules: [], defaultDataType: 'mixed'}`. That reads as a permissive default and is the exact opposite of one: `buildCompatibilityMap()` seeds itself from `dataTypes`, so an empty list means every port refuses every edge, and the `mixed` default named a lane the list never declared. It points at `DEFAULT_PORT_CONFIG` now — the shipped defaults are the default.

- **`DEFAULT_PORT_CONFIG` was missing three lanes** — `any`, `mixed` and `messages`. Absent is not "unstyled": a lane the list never declares is compatible with nothing, not even another port of its own lane, so a `messages` port on library defaults would not wire up at all. `mixed` is now the sink and carries rules in both directions — it is worn by outputs as much as inputs, so letting things in is only half the job, and an alias of `trigger` would not have covered the other half because aliases copy the outgoing set only. `defaultDataType` becomes `mixed`: a port with no declared lane constrains nothing. The ids now match the backend's `PortDataType` enum exactly, and nothing enforces that they keep matching — until the port config is generated, a lane added server-side has to be added here in the same change.

- **The `messages` lane had no colour at all** — its config named `var(--fd-node-fuchsia)`, a token referenced in exactly one place in the library and defined in none. Every use resolved to nothing: the chip tint, the shape symbol and the port handle all fell out as invalid at computed-value time, and the `--fd-node-slate` fallback could not catch it (the property _was_ set — to a string naming an undefined property). The token is now defined in both themes, `#d946ef` light and `#e879f9` dark, following the ramp's own construction. It also stopped being survivable: deriving the fallback colour map from the shipped config (below) copies the broken value into the pre-load path, where `messages` previously fell through to a valid slate.

### Changed

- **The sink `mixed` is slate, not teal** — a port that constrains nothing has nothing to claim, and slate is already the colour an unrecognised lane falls back to. On teal it sat in the media family beside `video`, sharing a hue with the one thing it is definitionally not. Its glyph was already `?`; now the colour agrees. **The served port config decides this at runtime** — a backend still serving teal for `mixed` still renders teal, so fddo moves with it.

- **The fallback data-type colour map is derived from the shipped port config, not hand-maintained** — `DEFAULT_DATA_TYPE_COLORS` was a third, independent colour list, and it had drifted from `DEFAULT_PORT_CONFIG`: `mixed` was orange against the config's teal, and the typed-array lanes (`string[]`, `json[]`, …) and `messages` had no entry at all, so they painted slate. It only applies before the backend's port config loads — which is exactly when the first render happens, so it was seen. The legacy spellings that were never lane ids (`text`, `list`, `integer`, `float`, `object`, `document`, `picture`, `sound`, `movie`, `branch`) survive as an explicit alias layer.

- **Pipeline signal refusals are classified by the backend's `error_code`, not by its prose**
  - All three of the reference backend's signal refusals answer `409`, so `classifyRefusal()` told them apart by matching substrings of the human `error` string — `terminal`, `already pending`, `no active pause`. That made the server's wording load-bearing across a repository boundary: a reword that dropped a substring silently reclassified the refusal, the operator was shown the wrong explanation, and nothing errored on either side. The backend now publishes a stable `error_code` beside `error` (`PIPELINE_TERMINAL`, `INWARD_SIGNAL_ALREADY_PENDING`, `NO_ACTIVE_PAUSE`), and it is preferred whenever present.
  - **The substring path stays as the fallback**, because this client talks to backends it does not ship with and one predating the codes still answers a 409 with nothing but prose. It is removed when the oldest supported backend emits codes, not when the newest does.
  - An `error_code` this client does not recognise now yields `rejected` rather than falling through to the substring guess: an unmapped code still proves the backend classified the refusal deliberately, so guessing from its wording would override a considered answer.

## [2.2.2] - 2026-08-18

### Fixed

- **The interface's last entry could not be removed.** Removing the only remaining entry did nothing — the row stayed on screen. It surfaced most often as "I cannot delete the output entry", since that is usually the last one standing. An emptied interface was reported as `undefined`, which is indistinguishable from "no interface supplied, leave it alone", so the removal was dropped before it reached the store — and, because the save omitted the key for the same reason, a cleared interface came back on reload even once the row had gone.

## [2.2.1] - 2026-08-18

### Fixed

- **Authoring examples on a workflow interface input was impossible.** The entry card rendered its "More options" disclosure as a reactive attribute, so every edit inside the card — adding an example, committing one — re-ran it and forced the disclosure shut. Because the examples list lives inside that disclosure, the fields collapsed out from under the author mid-edit: focus fell to `<body>` and every keystroke after it was silently dropped. The disclosure is now state, seeded once from whether the entry needs attention and owned by the author from then on.
- **A card's open fields stayed behind when entries were reordered.** Interface entries had no identity to key on, so the entry list was keyed by position and per-row state belonged to the slot rather than to the entry. Reordering two entries left the open card behind, and removing an entry handed its open state to a neighbour. Rows now carry a client-side identity, kept out of the wire format, that moves with the entry.

## [2.2.0] - 2026-08-18

### Added

- **`workflowFormats` mount option.** Pass the format ids a host actually supports (e.g. `['flowdrop']`) to scope the "Workflow Format" select in Workflow Settings to that set. With one or zero options remaining the field is hidden entirely rather than rendered as a single-choice select, and an unknown id filters to nothing instead of erroring. Omit the option to keep offering every registered format.

### Fixed

- **Applying workflow settings could rewrite a non-default format.** When the format field is absent from the settings form the applied config carries no `format` key, and the handler fell back to `DEFAULT_WORKFLOW_FORMAT` — silently rewriting a workflow's stored format on an unrelated name or description edit. It now falls back to the workflow's current format.

## [2.1.1] - 2026-08-18

### Fixed

- **Interface bindings resolved against the wrong side of a node.** A `PortBinding` carries no direction, and resolution re-derived one by searching a node's inputs first. Because a `portId` is only unique within one side of a node, any node declaring an input and an output under the same id resolved to the wrong port — `chat_output` ships exactly that shape (input `message`, output `message`), so every output entry bound to it reported a spurious direction mismatch against a port the binding picker never offered. Resolution now prefers the owning entry's own direction and falls back to the other side, so a genuinely misdirected binding is still reported. This also corrects the `hidden` exposure check, the `type-mismatch` check, and the bound-port ring, all of which were reading the opposite port for such nodes.
- **Saving or exporting a workflow stripped its declared interface.** `globalSaveWorkflow` and `globalExportWorkflow` rebuild the workflow from an explicit key list and neither named `interface`; since an absent `interface` means "declares no contract," a save dropped the contract and an export/re-import round trip lost it.

## [2.1.0] - 2026-08-18

**The workflow interface release.** A workflow can now declare its public call signature — named inputs and outputs bound to internal node ports — and author it in a dedicated settings panel. Entirely additive: workflows without an `interface` behave exactly as before.

### Added

- **`Workflow.interface`** — the workflow's public contract. New `/core` types `WorkflowInterface`, `WorkflowInterfaceEntry`, and `PortBinding`: each entry maps a stable public `id` (plus optional `name`, `description`, `dataType`, `required`, `defaultValue`, `examples`, `schema`, and server-owned `meta`) to exactly one internal port binding. Control-flow ports (`trigger`/`tool` data types and the loop-back port) are not bindable — they are orchestration, not call signature.
- **Interface panel in workflow settings.** The workflow settings dialog gains an Interface tab powered by the new `WorkflowInterfaceEditor`: per-entry status dot (ok, unbound, dangling, hidden, over-bound, type mismatch) with plain-language explanations, a binding picker limited to exposed ports, and an inline "already receives a value from …" conflict message when a bound input port also has an incoming edge.
- **Progressive disclosure + "Pull from port".** An entry's resting state is just its public id and binding; name, data type (with a one-click "Use port type" mismatch fix), required, description, default value, and examples sit behind a "More options" disclosure that auto-opens on a type mismatch. A "Pull from port" button copies the bound port's declared fields into the entry — it never derives the public `id` from the internal port name.
- **Example values for callers.** `WorkflowInterfaceEntry.examples` (inputs only, never validated against `schema`) with add/remove editing in the panel.
- **Launch preflight.** `workflowLaunchService` accepts the `workflow` in its launch options and validates the provided inputs against the declared interface before any network call — unknown input keys and missing required inputs (honoring `defaultValue`) return an `invalid-input` result locally.
- **Canvas marker for bound ports.** Port handles referenced by an interface binding render a ring (themeable via `--fd-ring`), so the workflow's public surface is visible on the canvas itself.
- **Data types from the instance vocabulary.** The panel's data-type select is sourced from the instance's port configuration (`fd.portCompatibility.getEnabledDataTypes()`); a stored value outside the vocabulary is kept as an extra option instead of being silently dropped.
- **API surface.** `interface` schemas in the OpenAPI spec and the generated workflow JSON schema; the `demo_tool_workflow` mock fixture exercises the full contract. New `workflowInterface` message-catalog domain for every string in the panel.

### Changed

- **Node swap preserves the interface.** Swapping a node rewrites interface bindings to the replacement node's mapped ports in the same history entry, so undo restores both the graph and the contract together.

## [2.0.1] - 2026-08-14

### Fixed

- `dynamicPortToNodePort()` rendered a blank port label when a dynamic port was supplied without a `label`; it now falls back to the port's `name`. `DynamicPort.label` is accordingly now optional in the type definition.

## [2.0.0] - 2026-08-04

**FlowDrop 2.0 GA.** The `latest` dist-tag moves from 1.15.0 to 2.0.0; `npm install @flowdrop/flowdrop` now installs 2.x. Upgrading from 1.x is a breaking change — read [MIGRATION-2.0.md](./MIGRATION-2.0.md) first.

Code-identical to `2.0.0-beta.11` apart from a lint-hygiene fix (two `svelte-ignore` comments that no longer suppressed anything). The eleven betas published between 2026-06-07 and 2026-07-31 are the release notes for this version — each is kept below, and the full breaking-change list with per-item migration steps is in [2.0.0-beta.1](#200-beta1---2026-06-07).

### What 2.0 is

- **The explicit-instance era.** Every mount creates an isolated `FlowDropInstance` — workflow, history, playground, interrupts, categories, API config, registries, port compatibility. Multiple editors coexist on one page without clobbering each other, and SSR no longer leaks state across requests. The ~95 module-level delegates that made a page-default singleton the de-facto API are gone; state comes from `mountFlowDropApp(...).instance` or `getInstance()`.
- **An API surface that tells the truth.** Props the components never read are deleted rather than silently ignored, documented options that did nothing (`height`/`width`, `workflow` on `mountWorkflowEditor`, `spellChecker`, `required`, `placeholder`) now work, the main entry is a minimal front door instead of an `export *`, and each name has exactly one home.
- **A playground you can operate.** Slash commands, pipeline signals (`pause`/`resume`/`cancel`), message-free run launches, session reset, µs-precision job durations, and full job-detail expansion — added across the beta line.
- **Authentication through providers.** `EndpointConfig.auth` is replaced by an `AuthProvider` (`StaticAuthProvider`, `CallbackAuthProvider`, `NoAuthProvider`), and draft storage is configurable (`draftStorage`) with an end-user opt-out.

### Breaking Changes since 1.15.0

Summarized here; each item is documented in full under [2.0.0-beta.1](#200-beta1---2026-06-07) with its migration path.

- Module-level store APIs removed — instances are the API.
- API access, registries, and port compatibility are instance-scoped (`fd.api`, `fd.nodes`/`fd.fields`/`fd.formats`, `fd.portCompatibility`).
- `EndpointConfig.auth` removed — use an `AuthProvider`.
- The main entry exports only the bootstrap surface; barrels no longer re-export each other's names.
- `mode` prop replaces `readOnly` + `lockWorkflow`; `<App>` event handlers are flat `on*` props.
- v1.8-deprecated message props and the `ChatPanel` `showChatInput`/`showRunButton`/`showLogs` flags are removed.
- Workflow `metadata` is required and `metadata.version` is now `metadata.schemaVersion` (1.x JSON heals on load).
- localStorage keys are instance-scoped (existing drafts migrate on first read).
- `mountWorkflowEditor` drops `nodes`; `WorkflowEditor` drops six never-read props.

### Fixed

- Two `svelte-ignore a11y_click_events_have_key_events` comments in `ConfigPanel` and `SurfaceOverlay` suppressed a warning that no longer fires (both backdrops handle `onkeydown`), tripping `svelte/no-unused-svelte-ignore`. Removed; no runtime change.

## [2.0.0-beta.11] - 2026-07-31

Eleventh 2.0 beta, published under the npm `beta` dist-tag (`npm install @flowdrop/flowdrop@beta`). `latest` remains 1.15.0 until 2.0.0 GA. This release gives the playground an **operator control lane**: slash commands typed in the composer act on a session or on a running pipeline without entering the conversation as chat turns, and a run can now be started without fabricating a user message. It also stops the AI assistant re-arranging hand-made layouts unasked, tells it what actually happened to the commands it emitted, and fixes an empty config panel for node types that contribute no schema.

### Added

- **Slash commands in the playground composer.** A leading `/` routes input to the control plane instead of the pipeline, so composer input stops meaning exactly one thing ("launch a run with this as input"). Ships `/help`, `/run`, `/new`, `/stop`, `/reset`, `/delete`, `/pause`, `/resume` and `/cancel`. Commands never become session messages — control traffic that entered the conversation would be replayed as chat input on the following turn — and their results render as transient composer feedback instead. Opt-in per surface via `enableCommands` (default `false`), because the lane is only safe where the send handler actually dispatches commands: a surface that forwards input straight to a backend would post `/stop` as literal text. `//` escapes a literal leading slash, consuming exactly one so the rule composes, and an unrecognised command reports itself as unknown with distance-1 suggestions rather than being forwarded as a message — a typo must not launch a run with `/stpo` as its input.
- **Pipeline signals — `pause`, `resume`, `cancel`.** Signals travel _into_ a running pipeline, the opposite direction from interrupts, which a node raises and awaits. Acceptance is not application: backends observe signals cooperatively between steps, so the in-flight step always finishes first and the new `PipelineSignalService` reports `accepted` rather than claiming the run is paused, leaving the status poll to report what actually happened. Refusals ("the run already finished", "not paused", "already pending") come back as typed results rather than thrown errors, since they are outcomes to render. New `signals` endpoint block, with its own group-level `baseUrl`.
- **Starting a run without posting a message.** New `WorkflowLaunchService` and a `workflows.run` endpoint. Sending a message to start a run fabricates a user turn that is indistinguishable downstream from something the user actually typed; hosts that wire `onRunWorkflow` get a RUN button and a `/run` command that launch instead. `/run --key=value` passes named inputs. A rejected launch distinguishes bad inputs (the caller's to fix) from an invalid workflow (an authoring problem), surfacing the backend's own per-field locators.
- **Command autocomplete palette.** Typing `/` offers the commands available against the current configuration, reusing the editor console's listbox so both surfaces look and behave alike. Completes command _names_ only — argument values would mean guessing a workflow's declared launch inputs, which live server-side, and offering inputs the backend then rejects.
- **Optional session reset endpoint.** `playground.resetSession` plus `PlaygroundService.resetSession()`, for returning a stuck session to idle.
- **`behavior.chatAllowLayoutChanges` (default `true`).** When off, `AIChatPanel` skips layout commands rather than executing them. See the layout fix below; the default preserves existing behaviour.
- **`hideLabel` on `FormToggle`.** Keeps the state text as the switch's accessible name without rendering it. Defaults to `false`, so every other toggle is unchanged.

Commands are available **only where their endpoint is configured** — a host pointed at a backend without session reset gets no `/reset`, rather than a command that 404s. Commands bind to endpoint _keys_, never to paths or to any one backend's vocabulary, so this works against any API implementing the shape.

### Fixed

- **The assistant re-arranged hand-made layouts unasked (#36).** Auto-beautify re-positions every node, so an unrequested `layout auto` / `layout beautify` destroyed a hand-crafted layout. The root cause was the prompt rather than the executor: the DSL prompt docs told the assistant to auto-arrange after building and to always end with `canvas fitview`. Both mandates are gone, layout commands are marked user-requested-only and must be emitted alone so they can be undone independently. Since the library cannot control how a remote backend renders those prompts, `chatAllowLayoutChanges` adds a local enforcement point.
- **Triple-quoted blocks swallowed every later command (#35).** The response _extractor_ only closed a `"""` block when a line was exactly `"""`; an assistant that put the closer at the end of a content line left the buffer open, collapsing 7 commands to 2 and consuming the closing fence and trailing prose. Both the extractor and the parser now track delimiter _parity_ (escaped `\"""` excluded), so a closer is valid inline or on its own line.
- **The assistant was never told what happened to its commands (#35).** `getHistory()` sent only the explanation, and approve/dismiss outcomes lived purely in UI state — which is what drove the duplicate-node loop on "try again". History now carries the raw response plus a per-command outcome report (APPLIED / FAILED / SKIPPED / DISMISSED / NOT APPLIED YET), read at send time so it is always current.
- **Node-level settings vanished for node types with no config schema (#34).** `ConfigForm` rendered its whole form inside one `{:else if configSchema}` branch, so a node whose type contributes no schema fell through to "No configuration options available" — taking the node-level settings the editor owns (port order and exposure) down with it. A reserved `ports` field is now composed into the node's effective schema, so a schema-less node with ports simply has a schema. No-op when a backend already serves a `ports` property, when there is no node, or when the node has no ports to configure. Nothing is persisted on panel open.
- **Port drags started a text selection in Safari (#37).** Dragging from a port handle text-selected content outside the canvas. xyflow sets `user-select: none`, but WebKit still _begins_ a selection drag from a mousedown on unselectable content, anchoring at the nearest selectable text; node and pane drags call `preventDefault()`, xyflow's `Handle` does not. A capture-phase `mousedown` on the canvas wrapper now suppresses the gesture for primary-button presses inside `.svelte-flow__handle` and re-applies the focus the default action would have moved.

### Changed

- **`CommandExecutionStatus` gains `'skipped'`.** A widened union: consumers switching exhaustively on it will need to handle the new member. A skip is a non-failure, so the rest of a batch still applies and no retry feedback is generated.
- **Port rows in the ports widget are more compact.** The written "Exposed"/"Hidden" label next to each switch reserved a label column and let long port names widen the row. The switch alone now carries the state; a hidden row's name and type badge are dimmed to stay legible, and both ellipsize with `title` attributes preserving the full text.
- **`buildEndpointUrl` accepts a base-URL override**, so a group of endpoints can sit under a different prefix from the rest of the config. Additive — existing three-argument calls are unchanged.

### Internal

- The range field's one-time step inference reads its initial value inside `untrack()`, making the read-once intent explicit and clearing a `state_referenced_locally` warning. No behaviour change.
- Restored the missing `## [2.0.0-beta.9]` heading below: that release's summary and its "Fixed" section had been absorbed into beta.10's section since the beta.10 release commit.

## [2.0.0-beta.10] - 2026-07-22

Tenth 2.0 beta, published under the npm `beta` dist-tag (`npm install @flowdrop/flowdrop@beta`). `latest` remains 1.15.0 until 2.0.0 GA. This release reworks how node-config edits are committed and how the undo stack records state, fixing two editor bugs (a Safari save failure and a multi-step undo that reverted more than one edit) and the freeze that the prior on-blur commit was working around. It also re-establishes the editor font on the standalone `ConfigModal` export.

### Fixed

- **Safari dropped config edits toggled with a checkbox or select (#38).** Node config committed only on the config form's `focusout`, but WebKit doesn't focus checkboxes/selects on click — so toggling one and clicking Save never fired `focusout` and the edit was lost. Node config now commits **live** per change (no focus dependency), making the bug structurally impossible. Workflow settings keep the blur-commit path but retain an immediate commit for discrete controls, so they stay correct on Safari too.
- **A single undo reverted more than one edit (#39).** The undo stack stored the _pre-change_ state of each mutation, so after two or more sequential edits a single undo skipped a step (reverting two edits at once) and redo could not reconstruct the intermediate state. The stack now stores **post-change** snapshots — the stack top is the current committed state — so one undo == one edit. `WorkflowStore` mutations (`addNode`/`removeNode`/`addEdge`/`removeEdge`/`updateNode`/`batchUpdate`/`swapNode`) push after mutating, and config-edit transactions commit their final state.
- **The editor no longer freezes while typing in a config field.** The old on-blur commit was itself a workaround for committing on every change deep-cloning the whole workflow onto the undo stack, pushing a per-keystroke undo entry, firing `onWorkflowChange`, and recomputing edge geometry — all per keystroke. A field-editing session now applies each change cheaply inside a lazily-opened history transaction and coalesces into a single undo step; the workflow event fires and edges refresh once per session, on finalize.
- **Standalone `ConfigModal` inherited the host page's font.** `ConfigModal` (exported via `@flowdrop/flowdrop/editor`) is mounted standalone by embedders on bare host pages, so its `font-family: inherit` text fell back to the host theme font (e.g. serif on Drupal) instead of the FlowDrop sans. It now declares its own `font-family` on the modal root, mirroring the `SurfaceOverlay` / `ConfigPanel` fix from beta.9.

### Changed

- **History commits now require the final state, and undo/redo finalize any open edit first.** Hardening follow-up to the #39 fix: `commitTransaction(finalWorkflow)` is now required (the pre-change `?? transactionSnapshot` fallback that could silently reintroduce the off-by-one is gone). The service no longer guesses at the live state to auto-commit a dangling transaction inside `undo()`/`redo()`; instead the state owners finalize first (a `HistoryStore` before-navigate hook wired to `finalizeNodeConfig()`, and command-dispatch undo/redo), and if the service still finds an open transaction it abandons it with a warning rather than committing wrong state. New shared `clearTransaction()` internally.

## [2.0.0-beta.9] - 2026-07-12

Ninth 2.0 beta, published under the npm `beta` dist-tag (`npm install @flowdrop/flowdrop@beta`). `latest` remains 1.15.0 until 2.0.0 GA. A follow-up fix to the relocatable surfaces shipped in beta.8: config surfaces hosted in the modal placement (and the config panel's pop-out) now keep the editor's font instead of falling back to the host page's default.

### Fixed

- **Modal config surfaces no longer inherit the host page's font.** The `SurfaceOverlay` (modal placement) and the `ConfigPanel` pop-out both portal to `document.body` so their fixed backdrop escapes any ancestor that establishes a containing block. That also moved them out of the mount container that carries the app font, so — since the library sets no base font of its own and relies on inheriting the host's — the modal fell back to the page default (rendering as serif on a bare Drupal editor page, whose `<body>` resolves to `Times`) while the rest of the editor stayed sans-serif. Each portalled backdrop now re-declares `font-family: var(--fd-font-family, system-ui, -apple-system, sans-serif)`, mirroring the mount container's own declaration, so a portalled surface matches the editor and still honours a consumer's `--fd-font-family` override.

## [2.0.0-beta.8] - 2026-07-11

Eighth 2.0 beta, published under the npm `beta` dist-tag (`npm install @flowdrop/flowdrop@beta`). `latest` remains 1.15.0 until 2.0.0 GA. This release makes auxiliary surfaces relocatable: the config panel and the console/AI Assistant group are no longer pinned to fixed spots — each can be hosted in the **right sidebar**, a **centered modal overlay**, or the **bottom panel**, chosen independently per surface. Surfaces routed to the same host coexist as tabs. Defaults are unchanged (config in the sidebar, console/chat in the bottom panel), so existing embeds look and behave exactly as before.

### Added

- **Configurable surface placement.** A new `SurfacePlacement` enum (`'sidebar' | 'modal' | 'below'`) with two UI settings — `configPlacement` (default `sidebar`) and `consolePlacement` (default `below`) — controls where the config panel and the console/AI Assistant group are hosted. Both are exposed in the Settings panel and as `configPlacement` / `consolePlacement` mount options; the mount options **seed** the setting on first load without overriding a returning user's persisted choice (library default < host default < user snapshot), via the new `seedUiDefaults` store helper. Modelled as one enum per surface so invalid combinations (two hosts at once, or none) are unrepresentable.
- **`TabbedSurface` component.** A reusable tabbed container that hosts one or more surfaces in the sidebar, bottom panel, or modal. All tab bodies stay mounted (toggled via `display`) so surface state — console scrollback, chat history, in-progress form edits — survives tab switches, and the tab bar hides itself when only a single surface is present so a lone surface reads as a plain panel.
- **`SurfaceOverlay` component + `portal` action.** A modal shell that hosts a surface (or a `TabbedSurface` of several) in the `modal` placement, closable via Esc, backdrop click, or the close button. It portals to `document.body` through a new `portal` Svelte action so its fixed backdrop escapes any ancestor that establishes a containing block (`transform`, `filter`, `backdrop-filter`, …); the action is a no-op during SSR.

## [2.0.0-beta.7] - 2026-07-09

Seventh 2.0 beta, published under the npm `beta` dist-tag (`npm install @flowdrop/flowdrop@beta`). `latest` remains 1.15.0 until 2.0.0 GA. Dynamic config schemas become composable and self-refreshing. A dynamic-schema endpoint can now **layer onto** a node's static schema instead of replacing the whole form — merging in the fields it owns, or targeting a single region — so an endpoint only returns what it actually drives and the rest of the form stays exactly as authored. The fetched form also **refetches on its own** when a config value its URL depends on changes (e.g. picking a different trigger `event_type`), rather than loading only once on mount. All additive: the historical whole-form `replace` behaviour is still the default, so existing dynamic-schema configs are unchanged.

### Added

- **Dynamic config schema can layer onto the static schema (`mergeStrategy` + `target`).** `DynamicSchemaEndpoint` gains two optional fields. `mergeStrategy: 'replace' | 'merge'` — `merge` combines the fetched schema with the node's static schema (`schema` prop / `metadata.configSchema`): properties are merged (fetched wins per key), `required` is unioned, so an endpoint only has to return the fields it drives. `target` — a dot-path of property keys (e.g. `"advanced"` or `"advanced.retry"`) that restricts the fetch to one region of the form, splicing the fetched schema in at that location and leaving every other field static; `mergeStrategy` then decides replace-vs-merge at that node. Both default to whole-form `replace`, matching prior behaviour. When `merge`/`target` is configured, the schema is now fetched even if a static schema is present (previously a static schema suppressed the fetch). New `applyFetchedSchema` util backs the combination.
- **Dynamic schema auto-refetches when its inputs change.** `ConfigForm` now watches the resolved endpoint URL — template variables substituted from the node context — as a reactive key and refetches whenever it changes, so choosing a different value that the endpoint depends on (e.g. a trigger's `event_type`) reloads the matching schema instead of showing the schema captured at mount. A fetch already in flight is left to settle before the next one runs, and the key only reflects what the URL actually references, so static endpoints never spuriously refetch. New `resolveDynamicSchemaKey` export.
- **Dynamic schema endpoints can return a companion `uiSchema`.** When the endpoint response includes a `uiSchema` (read from `uiSchema`, `data.uiSchema`, or `schema.uiSchema`), `ConfigForm` uses it to lay out the fetched schema and caches it alongside the schema. It takes precedence over the node's static-metadata `uiSchema` — which can only reference the static schema's fields and would mislay a server-hydrated form — while a directly-passed `uiSchema` prop still wins. `DynamicSchemaResult` and the cache entry gain an optional `uiSchema`.

### Fixed

- **Config values are no longer silently dropped on save.** `ConfigForm` rebuilt the saved config solely from the active schema's properties, so any stored config key the schema didn't render — for example after a dynamic schema returned a narrower field set — was lost on the next blur/save. The commit paths (`onChange` on blur, and explicit save) now preserve config keys the active schema doesn't own, with the rendered fields still taking precedence.
- **`invalidateSchemaCache` now matches the fetch cache key.** It built the node context without the `workflowId`, so for endpoints whose URL references `{workflowId}` it resolved a different cache key than `fetchDynamicSchema` and failed to evict the entry — a manual schema refresh then re-served the stale cached schema. It now accepts `workflowId` (matching the fetch context); the context-building for schema-URL, external-edit-URL, and cache-key resolution was consolidated so they can no longer drift apart.

## [2.0.0-beta.6] - 2026-06-22

Sixth 2.0 beta, published under the npm `beta` dist-tag (`npm install @flowdrop/flowdrop@beta`). `latest` remains 1.15.0 until 2.0.0 GA. This release unifies port **order** and **exposure** into a single per-instance `data.config.ports` value and makes exposure semantic — "what you see is what runs": a not-exposed port is hidden on the canvas, not wireable, and not runtime-overridable. The two older, separate mechanisms (`extensions.ui.portOrder` for order and `hideUnconnectedHandles` for visibility) are removed. A single combined "Ports" widget in the config panel now handles both reorder and expose/hide per port, and reserved ports (the `error` output and `trigger`/`tool` control ports) sort to the bottom automatically.

### Breaking Changes

- **Port order + exposure unified into `data.config.ports`.** Order and exposure are now one per-direction ordered list of `{ id, exposed? }` entries (`PortsConfig`): array position encodes display order, and the optional `exposed` flag overrides the port's metadata `exposedByDefault` — stored only when it diverges. An untouched node persists no `ports` key. This replaces `extensions.ui.portOrder` (removed) and the interim `exposedPorts` map. Consumers that read or write either must migrate to `config.ports`; the OpenAPI/JSON schema (`PortsConfig`, `PortConfigEntry`, `NodePort.displayOrder`) was updated to match.
- **`hideUnconnectedHandles` removed end-to-end.** Visibility is no longer derived from connection state. A port renders iff it is exposed (`config.ports` override, else metadata `exposedByDefault`, which defaults to exposed). Dropped from `NodeUIExtensions`, every node renderer, the config form, fixtures, and the schema; `hiddenPorts` retired with it.

### Added

- **Combined `FormPorts` widget.** A single "Ports" group in the config panel renders one row per port with reorder (up/down) and an expose/hide toggle, replacing the separate Port Order panel and the interim exposed-ports widget. Edits write the minimal `config.ports` value and collapse back to `undefined` on the default order with no exposure override.
- **`NodePort.displayOrder` + automatic reserved-port ordering.** A cosmetic default sort weight (ascending; ties on declaration order). Reserved ports — the `error` output and `trigger`/`tool` control ports — sink to the bottom of their direction automatically via `RESERVED_PORT_DISPLAY_ORDER`, with no value required from authors; an explicit `displayOrder` overrides. New `byDefaultOrder`, `orderPortsFor`, `isPortExposed`, and `isReservedPort` utilities.

### Fixed

- **OpenAPI `NodeMetadata` aligned with the `node_type_id` rename.** Follow-up to beta.5: the spec's `NodeMetadata` now references `node_type_id` consistently (the bundled spec shipped in the package was regenerated).

### Docs

- **`maxRetries` added to the reserved config-property table.**

## [2.0.0-beta.5] - 2026-06-20

Fifth 2.0 beta, published under the npm `beta` dist-tag (`npm install @flowdrop/flowdrop@beta`). `latest` remains 1.15.0 until 2.0.0 GA. This release is a node-identity cleanup: node components now derive their instance id from the canonical `id` prop SvelteFlow already passes, dropping the duplicate `data.nodeId` copy and its load-time healing, and the node-_type_ entity id is renamed `metadata.id` → `metadata.node_type_id` to disambiguate it from the instance id. Six node components were also moved off the type-erasing `$props<T>()` onto a typed `interface Props`, which surfaced and fixed latent config-access errors in `ToolNode`.

### Breaking Changes

- **Node-type entity id renamed `metadata.id` → `metadata.node_type_id`.** The node-type entity id collided conceptually with the node _instance_ id; it is now `metadata.node_type_id` to disambiguate the two. It is a server-owned wire field, so the library preserves the snake_case name as a non-opinionated passthrough — adapters, the command type-map, connection validation, and the dynamic-schema paths were all updated to match. Consumers reading `metadata.id` for the node type must read `metadata.node_type_id`. **Backend impact:** the `GET /nodes` response and `metadata` blocks in persisted workflows must now use `node_type_id`; the OpenAPI spec (`NodeMetadata`) and the bundled spec shipped in the package were updated accordingly.
- **Dropped the duplicate `data.nodeId` field.** Node components now derive their id from the canonical `id` prop that SvelteFlow already passes to every node, instead of a copy stored in `data.nodeId`. Handle ids, config-open callbacks, and status overlays read `id` directly. The field and its load-time "healing" are gone, so an intact graph can no longer look corrupted from a missing copy. `WorkflowNode.data.nodeId` was also removed from the OpenAPI spec.

### Changed (internal — no API change)

- **Six node components typed properly.** The node components that used `$props<T>()` — which returns `any` and silently disabled type-checking — now declare an `interface Props` with `let props: Props = $props()`. This surfaced and fixed latent config-access errors in `ToolNode`.

## [2.0.0-beta.4] - 2026-06-13

Fourth 2.0 beta, published under the npm `beta` dist-tag (`npm install @flowdrop/flowdrop@beta`). `latest` remains 1.15.0 until 2.0.0 GA. This release is mostly an internal design-system consolidation pass — new shared `Button` / `IconButton` / `Input` / `Select` / `Textarea` primitives route every control through the `base.css` class system as the single source of truth, so themes (including Drafter) style fields and buttons consistently. User-visible changes are a navbar `end` snippet for embedding custom trailing controls, a new `--fd-control-radius` theming token, a range-slider fill fix, and opaque Drafter buttons. The archived Astro docs site is retired in favor of the Mintlify docs at `flowdrop.mintlify.app`.

### Added

- **`end` snippet on the navbar.** A new `end` snippet prop renders custom trailing content in the navbar (before the settings gear), letting consuming apps inject their own controls — e.g. a theme toggle — without forking the navbar.
- **`--fd-control-radius` theming token.** Form controls (inputs, selects, textareas, the array action buttons, fieldset/checkbox-group/config-form borders) now read their corner radius from `--fd-control-radius`, so themes can tighten field corners independently of cards and panels. Drafter sets it to `2px` for its crisp blueprint look; other themes inherit the existing radius.

### Fixed

- **Range slider fill now tracks the thumb center.** The colored fill measured 0–100% of the raw track width while the browser keeps the thumb inside the track, so the fill and thumb drifted apart — worst at the extremes and visible on load. The fill now mirrors the thumb's actual travel (`thumb/2` to `100% − thumb/2`) via a new `--fd-range-fill` calc, with the thumb size tokenized.
- **Drafter buttons are opaque and flat.** Several buttons in the Drafter skin (file-upload node config, canvas toggles) rendered with translucent backgrounds and read as see-through; they are now flat and opaque.

### Changed (internal — no API change)

- **Shared form-control and button primitives.** New typed `Button`, `IconButton`, `Input`, `Select`, and `Textarea` wrappers sit over the existing `.flowdrop-btn*` / `.flowdrop-input*` / `.flowdrop-btn--icon*` classes in `base.css`, making it the single source for control look (`:disabled` is the only muted state). `ThemeToggle`, the config form, sidebar search, the node swap picker, `FormArray` move/delete buttons, `InputCollector`, and the playground inputs were migrated onto them, dropping their hand-rolled, duplicated CSS. The primitives are internal (not exported), so their APIs aren't frozen before GA; public component prop APIs (e.g. `ThemeToggle`) are unchanged.
- **`EditorStatusBar` extracted onto the shared button system.** The endpoint-error banner — previously inline in `App.svelte` with its own button CSS and a centered `80rem` layout — is now an `EditorStatusBar` component that routes actions through the `Button` primitive, spans the editor chrome flush, and uses a proper `CloseIcon` for dismissal. Added Storybook stories for `Button` and `EditorStatusBar`.
- **Navbar control heights from one token.** Three hardcoded `height: 2.5rem` rules now use `var(--fd-size-btn-min)`, sharing a single source of truth with `.flowdrop-btn`.
- **Extracted shared logic flagged by the duplication review.** `connections.ts` gains a shared `detectCycles()` (used by both `hasCycles` / `hasInvalidCycles`); `svelte-app.ts` extracts a `configureInstance()` shared by `mountFlowDropApp` / `mountWorkflowEditor`; and `FormField` / `FormFieldLight` share a `resolveBaseFieldType()` for the basic-type switch (with a unit test pinning resolution order) while keeping the deliberate full/light rendering split for the bundle-guard contract. No behavioral change.

### Docs

- **Retired the archived Astro/Starlight docs site (`apps/docs`)** and its docker-publish workflow; the Mintlify site at `flowdrop.mintlify.app` is canonical. All live documentation links (README, AGENTS, quick-start, i18n guide, API README, dev playground navbar, docker-playground landing, interrupt-feature doc) were repointed there. `apps/api-docs` is kept only to back the `api:lint` / `api:bundle` tooling and CI. Corrected the local dev-server port reference to the recommended Express demo.

## [2.0.0-beta.3] - 2026-06-12

Third 2.0 beta, published under the npm `beta` dist-tag (`npm install @flowdrop/flowdrop@beta`). `latest` remains 1.15.0 until 2.0.0 GA. This release finishes the navbar/theme defaults pass started in beta.2 (navbar opt-in everywhere, light as the default theme, the FlowDrop wordmark in the header), adds the **Drafter** blueprint theme with per-theme canvas grids, and lands a keyboard-navigation and focus-ring overhaul alongside the 20px node-grid alignment.

### Breaking Changes

- **`mountPlaygroundApp` / `<PlaygroundApp>` no longer render the navbar by default.** `showNavbar` now defaults to `false`, matching `mountFlowDropApp` / `<App>` — so every mount path is navbar-off by default and embedding FlowDrop into a page that already has its own header never double-stacks a header. Pass `showNavbar: true` to opt back into the FlowDrop navbar (logo, branding, settings modal) when FlowDrop owns the whole page.

### Added

- **Drafter blueprint theme.** A third built-in editor theme (`'drafter'`), shipping light + dark variants: a blueprint aesthetic with a soft mint canvas, a subtle emerald line grid, and translucent green-tinted flat nodes. Data-type port colors and category icon colors are left untouched so they keep popping against the muted draft surface. Selectable from the Settings → UI Theme picker; the `FlowDropSkinName` / theme / skin name unions gain `'drafter'`.
- **Per-theme canvas grid.** A new `FlowDropGridVariant` type (`'dots' | 'lines' | 'cross'`) and `themeConfig.canvas.grid` config let any theme drive the editor's background grid (previously hardcoded to dots). The grid pattern color is the `--fd-grid-pattern-color` token, whose default matches xyflow's dot color, so the default/minimal themes render unchanged. `resolveTheme` now merges `config.canvas` alongside `config.sidebar`.
- **`features.builtinEditors` opt-out.** The built-in markdown/code/template editors are batteries-included in the full editor by default. Pass `features: { builtinEditors: false }` to `mountFlowDropApp` (or `builtinEditors: false` to `mountWorkflowEditor` / `<WorkflowEditor>`) to skip registering them — keeping the textarea fallback or leaving room to register your own field components via `instance.fields.register(...)`. The corrected fallback hint now points at the registry-scoped API (`registerMarkdownEditorField(instance.fields)`).
- **FlowDrop wordmark logo in the navbar.** The header now renders the FlowDrop wordmark in place of the plain text title.

### Changed

- **The default theme preference is now `'light'` (was `'dark'`).** `DEFAULT_THEME_SETTINGS.preference` was hardcoded to `'dark'`, so any embed with no persisted theme choice rendered dark. Embeds now default to light; hosts that want dark by default should set the preference explicitly.
- **Editor / node / chrome surface tokens are scoped per surface,** refining how themes (including Drafter) tint the canvas, nodes, and surrounding chrome independently.

### Fixed

- **Nodes are a single tab stop again.** The node config (gear) button sat in the tab order, so leaving a node required a second `Tab` press. The gear button is removed from the tab order (it stays mouse/Enter-activatable), and node focus defers to xyflow's own node focus — Tab now moves one node per press. `nodesFocusable` redundancy was removed to eliminate the duplicate stop.
- **The full editor renders markdown/code/config editors out of the box again.** The beta.2 light-entry split made the heavy form editors opt-in everywhere, which inadvertently left `<WorkflowEditor>` / `<App>` / the playground showing the "Editor component not registered" textarea fallback for node config fields with `format: 'markdown' | 'code' | 'template'`. The full editor now registers the built-in editors on its own instance's field registry on mount. Registration uses a dynamic `import()`, so the chunks stay code-split (loaded lazily) and the light `/editor` static bundle is unaffected — the bundle guard still passes. The standalone `@flowdrop/flowdrop/form` primitive is unchanged and remains opt-in.
- **`<App navbarActions>` accepts the full `NavbarAction` shape.** The component prop was typed with an inline subset that silently dropped `external` and `group`, even though the underlying `<Navbar>` (and the `mountFlowDropApp` option) already supported them. It now uses the canonical `NavbarAction` type, so external-link and grouped actions type-check through the component as they always did through the mount API.
- **The node header no longer shows a top-accent line.**

### Changed (internal — no API change)

- **One centralized focus ring across the whole component library.** New `--fd-ring-width` / `--fd-ring-offset` tokens and a single `.flowdrop-root :focus-visible` rule in `base.css` replace ~200 lines of component-local focus CSS (mismatched outlines, hardcoded `rgba(59,130,246)` box-shadow glows, `color-mix` rings) removed across 41 files. CodeMirror editors in `overflow:hidden` containers use a `:focus-within` ring (outline paints outside the box and would clip); range-input thumbs ring on the parent.
- **Extracted shared `NodeConfigButton` and `CanvasIconButton` components,** replacing per-node config-button and per-canvas floating-button duplication (including an inline-SVG cog) with one keyboard-correct implementation each.
- **Node geometry converted from `rem` to `px` and snapped to a 20px grid** across all eight node types — header, port rows (fixed 60px), icon sizes, paddings, gaps, and font sizes — so nodes stay aligned to the canvas coordinate grid regardless of the host's root font-size.
- **The code / markdown / template editors now rest on the shared input surface** instead of carrying their own background.

## [2.0.0-beta.2] - 2026-06-09

Second 2.0 beta, published under the npm `beta` dist-tag (`npm install @flowdrop/flowdrop@beta`). This release tightens the 2.0 package boundaries, finishes `AuthProvider` propagation across the editor and playground runtime surfaces, and adds a regression guard for light-entry bundle size.

### Breaking Changes

- **Heavy dependencies no longer leak into the light entries.** Three exports moved so that `@flowdrop/flowdrop/core` and the light `@flowdrop/flowdrop/form` never statically pull CodeMirror, `marked`, DOMPurify, or `@xyflow/svelte` (enforced by a new CI bundle guard, see below):
  - `sanitizeHtml` moved from `@flowdrop/flowdrop/core` to `@flowdrop/flowdrop/display` (it is DOMPurify-backed; `/core` is the zero-heavy-dep entry).
  - `FormFieldFull` moved from `@flowdrop/flowdrop/form` to `@flowdrop/flowdrop/form/full` — it statically bundles every editor (CodeMirror), so keeping it in the light `/form` entry pulled CodeMirror into every `SchemaForm` import. The `FormField` exported from `/form` remains the registry-based light factory.
  - Service singleton _instances_ (`playgroundService`, `interruptService` from `/playground`; `nodeExecutionService` from `/editor`; `agentSpecExecutionService` from `/core`) are no longer exported — they were constructed eagerly at import time, pulling the service and its dependencies into the entry's static graph. The classes (`PlaygroundService`, `InterruptService`, `NodeExecutionService`, `AgentSpecExecutionService`) remain; call `getInstance()` for the shared instance. See [MIGRATION-2.0.md section 4](./MIGRATION-2.0.md#keeping-heavy-dependencies-out-of-the-light-entries).

### Changed (internal — no API change)

- `SchemaForm`, `ConfigForm`, and the UISchema renderer now use the registry-based light `FormFieldLight` internally, so importing `SchemaForm` no longer statically pulls CodeMirror (heavy editors stay opt-in via `/form/code` and `/form/markdown`).
- Built-in node **type metadata** (aliases, `resolveBuiltinAlias`, `isBuiltinType`) split into a component-free `registry/builtinNodeTypes` module so `/core`'s node-type utilities no longer drag in the node components (and transitively `marked`/DOMPurify).
- `utils/edgeStyling` and the `ConnectionLineType` reference in `types/index.ts` use type-only imports of `@xyflow/svelte`, removing the runtime `@xyflow/svelte` dependency from the headless command DSL reachable from `/core`.

### Added

- **Bundle-size guard (`pnpm run check:bundle`)** and a CI workflow that walk each published entry's static import graph and fail if a heavy dependency (CodeMirror, `@xyflow/svelte`, `marked`, DOMPurify) becomes statically reachable from a light entry (`/core`, `/form`, `/editor`). Dynamic `import()` — how `/form/code` lazy-loads CodeMirror — is intentionally ignored.
- **500-node editor render benchmark.** The e2e performance suite now includes a large trigger-chain workflow fixture so regressions in large-canvas rendering show up before release.

### Fixed

- **`AuthProvider` now reaches all documented runtime surfaces.** Playground, chat, interrupt, settings, editor, and pipeline requests now consistently route through the configured provider, including standalone playground mounts and the editor/pipeline views that previously dropped auth headers on secondary requests.
- **Theme skin tokens clear when switching back to the default skin.** Returning from a custom/base skin to the default theme no longer leaves stale CSS custom properties behind.

### Changed

- **`AuthProvider` request handling is centralized.** Services now share the `fetchWithAuth` path, and the public provider interface is slimmer while preserving bearer, API-key, custom-header, and callback authentication behavior.

## [2.0.0-beta.1] - 2026-06-07

Pre-release of 2.0.0, published under the npm `beta` dist-tag (`npm install @flowdrop/flowdrop@beta`). `latest` remains 1.15.0 until 2.0.0 GA. See [MIGRATION-2.0.md](./MIGRATION-2.0.md) for the upgrade guide.

### Breaking Changes

- **Module-level store APIs removed — instances are the API.** The ~95 module-level functions that delegated to the page-default instance (`getWorkflowStore`, `workflowActions`, `historyService`, `getMessages`, `playgroundActions`, `getCategories`, `getHistoryState`, the whole get*/set*/actions surface of `@flowdrop/flowdrop/editor` and `@flowdrop/flowdrop/playground`) are gone. Every mount handle now exposes its state container: `mountFlowDropApp(...).instance` — so `workflowActions.addNode(...)` becomes `app.instance.workflow.actions.addNode(...)`, `historyService.undo()` becomes `app.instance.history.undo()`. Inside components, `getInstance()` is unchanged (including the browser fallback that makes single-editor embeds work without a provider). The `PlaygroundStore`, `InterruptStore`, and `PortCoordinateStore` classes are newly exported for hosts constructing state manually. Settings remain page-global by design.
- **localStorage keys are instance-scoped.** The page-default instance writes `flowdrop:draft:default:<workflowId>` (was `flowdrop:draft:<workflowId>`) and `fd-pipeline-panel-open:default` (was bare). Existing data migrates automatically on first read — drafts in progress survive the upgrade. Only hosts reading the keys directly need to update; `clearAllDrafts()` still matches everything under `flowdrop:draft:`.
- **v1.8-deprecated message props removed.** `SchemaForm` loses `saveLabel`/`cancelLabel`, `AIChatPanel` loses `placeholder` — use the `messages` mount option (`messages.form.schema.save`/`.cancel`, `messages.chat.placeholder`). The `warnDeprecatedProp` helper is gone. `FormToggle.onLabel`/`offLabel` and `FormArray.addLabel` were **un-deprecated** instead: they express per-instance labels the global messages system cannot (a visibility toggle's "Hidden"/"Visible", a schema-derived "Add Header" button) and are now documented overrides.
- **`ChatPanel` loses `showChatInput`, `showRunButton`, `showLogs`.** ChatPanel is the conversational surface — view-only feeds use the `MessageStream` primitive directly or `ControlPanel` (which keeps both flags as supported config); log visibility is store-managed (`fd.playground.setShowLogs`). The orphaned message keys `playground.states.{viewOnlyTitle,viewOnlyText,readyTitle,readyText}` are removed with the branches that read them.
- **`mountWorkflowEditor` options:** `workflow` now actually loads the workflow (1.x accepted and silently ignored it); `nodes` is removed (it fed a prop the editor never read — use `mountFlowDropApp` to pre-seed node metadata).
- **`mode` prop replaces `readOnly` + `lockWorkflow`** on `<App>`, `<WorkflowEditor>`, and the `mountFlowDropApp` options bag. The new prop/option is `mode?: 'edit' | 'readonly' | 'locked'` (default `'edit'`). In 1.x the two booleans gated the exact same interactions (node drag/connect/select, proximity-connect, node swap, bottom console panel) and were always combined as `!readOnly && !lockWorkflow`, so every combination collapsed to "edit" or "fully disabled" — there was no orthogonal behavior to lose. `'readonly'` and `'locked'` behave identically today; the two names are preserved as distinct intents for future differentiation. Mapping: `readOnly` → `mode="readonly"`, `lockWorkflow` → `mode="locked"`. See [MIGRATION-2.0.md section 6.2](./MIGRATION-2.0.md#62-mode-prop-replaces-readonly--lockworkflow).
- **`<App>` event handlers are flat props.** The `eventHandlers={{ … }}` object prop on the `<App>` _component_ is replaced by individual `on*` props (`onBeforeSave`, `onAfterSave`, `onSaveError`, `onApiError`, `onWorkflowLoad`, `onBeforeSwap`, `onAfterSwap`), consistent with every other component. The `mountFlowDropApp` / `mountPlayground` options bag is **unchanged** — keep passing the grouped `eventHandlers` object; the mount functions wire `onDirtyStateChange`/`onWorkflowChange` into the instance store, call `onBeforeUnmount` on teardown, and forward the rest to `<App>`'s flat props. See [MIGRATION-2.0.md section 6.3](./MIGRATION-2.0.md#63-app-event-handlers-are-flat-props).
- **API access is instance-scoped (`fd.api`).** The module-level API singleton in `services/api.js` is removed: `setEndpointConfig()`, `getEndpointConfig()`, `nodeApi`, `workflowApi`, and the `api` aggregate are gone. Each instance owns an `ApiContext` at `fd.api` holding the endpoint config + auth provider and lazily building an `EnhancedFlowDropApiClient` (`fd.api.client`); `mountFlowDropApp`/`mountPlayground`/`<App>` call `fd.api.configure(config, authProvider)` for you. Services that read the singleton (playground, interrupt, chat, node-execution, dynamic-schema, variable) now take the endpoint config as their first argument — pass `fd.api.config`. See [MIGRATION-2.0.md section 2](./MIGRATION-2.0.md#2-api-access-is-instance-scoped-fdapi).
- **`EndpointConfig.auth` removed — use an `AuthProvider`.** The `auth` block on `EndpointConfig` (and its header-injection branch) is gone; authentication is supplied exclusively through an `AuthProvider` passed to the mount/`<App>` `authProvider` option (or `fd.api.configure(config, provider)`). `StaticAuthProvider` covers the former static-token cases one-to-one (`bearer`/`api_key`/`custom`); `NoAuthProvider` is the `{ type: 'none' }` replacement (or omit `authProvider`).
- **Port compatibility is instance-scoped.** `initializePortCompatibility()`, `getPortCompatibilityChecker()`, and `isPortCompatibilityInitialized()` are removed. Each instance owns a `PortCompatibilityChecker` at `fd.portCompatibility`, seeded with `DEFAULT_PORT_CONFIG` and re-initialized by mount from the backend's port config. The standalone connection helpers (`validateConnection`, `getPossibleConnections`, `getConnectionSuggestions`) now take the checker as their first argument.
- **Registries are instance-scoped — importing the editor registers nothing.** The node/field/format registries move off module singletons onto the instance (`fd.nodes`, `fd.fields`, `fd.formats`), each seeded in its constructor from read-only builtin definitions. The editor barrel's builtin-node side-effect import is gone and `package.json` `sideEffects` is now CSS-only (`["**/*.css"]`). The singleton consts `nodeComponentRegistry`/`fieldComponentRegistry`/`workflowFormatRegistry` and the module functions `registerCustomNode`/`createFlowDropPlugin`/`registerFlowDropPlugin` (and `plugin.ts`) are removed — register against the instance: `fd.nodes.registerCustom(...)`, `fd.fields.register(...)`, `createPlugin().register(fd.nodes)`. The heavy form-field installers (`registerCodeEditorField`, `registerMarkdownEditorField`, template) now take the target registry explicitly and re-check registration after their dynamic import resolves; category color/icon helpers take a `CategoriesStore` parameter. `BaseRegistry` gains a `$state` version counter so `$derived` reads invalidate on late (post-mount) registration. See [MIGRATION-2.0.md section 3](./MIGRATION-2.0.md#3-registries-are-instance-scoped--importing-the-editor-registers-nothing).
- **Barrel de-duplication — one export, one home.** The editor barrel no longer re-exports the playground surface (`Playground`, `PlaygroundModal`, `ChatPanel`, `SessionManager`, `InputCollector`, `ExecutionLogs`, `MessageBubble`, `PlaygroundService`, `playgroundService`, `PlaygroundStore`) — import them from `@flowdrop/flowdrop/playground`. The display barrel no longer re-exports `marked` — depend on `marked` directly (`npm install marked`).
- **The main entry is a minimal front door.** `@flowdrop/flowdrop` no longer `export *`s the whole library; it exposes only the bootstrap surface (`App`, `mountFlowDropApp`, `unmountFlowDropApp`, `createFlowDropInstance`, `getInstance`, `provideInstance`, `createEndpointConfig`, `defaultEndpointConfig`, `NoAuthProvider`, `StaticAuthProvider`, `CallbackAuthProvider`, plus core bootstrap types). Every other name moves to its owning sub-module (`/editor`, `/form`, `/playground`, `/display`, `/core`, `/settings`) — see the import map in [MIGRATION-2.0.md section 4](./MIGRATION-2.0.md#4-barrel-de-duplication-and-the-slim-main-entry). Tightens tree-shaking: importing `App` no longer pulls the form/display/playground/settings barrels into the bundle.
- **Workflow `metadata` is required; `metadata.version` → `metadata.schemaVersion`.** The `metadata` object is now required on the `Workflow` type and its `version` field is renamed to `schemaVersion`, disambiguating the document _format_ version from `NodeMetadata.version` (the node-type version, unchanged) and from any host-tracked revision number. Stored 1.x JSON heals automatically on load — `WorkflowStore.initialize` and `WorkflowAdapter.importWorkflow` populate missing metadata with defaults (`schemaVersion` from `WORKFLOW_SCHEMA_VERSION`) and copy legacy `version` → `schemaVersion` before dropping the old key; healing is idempotent and round-trip stable. The Agent Spec export's namespaced `flowdrop:version` key is unchanged (its source is now `metadata.schemaVersion`). The published JSON Schema (`@flowdrop/flowdrop/schema`) reflects the rename: `WorkflowMetadata.required` is `[schemaVersion, createdAt, updatedAt]`. Hosts reading workflow JSON directly should read `metadata.schemaVersion`. See [MIGRATION-2.0.md section 5](./MIGRATION-2.0.md#5-workflow-metadata-is-required-and-version--schemaversion).

### Deferred to a future release

- **Navbar snippet composition.** Replacing the `showNavbar`/`navbarTitle`/`navbarActions`/`showSettings`/`showStatus`/`showSettingsSyncButton`/`showSettingsResetButton` prop cluster with a single composable navbar snippet is a design exercise rather than a mechanical rename, and is deferred to 2.1/3.0. The individual flags are unchanged in 2.0.

### Changed (2.0)

- `fd.fields.register()` warns in dev when overwriting an existing field type. Overwriting remains supported (replacing a built-in field is legitimate); the warning exists for the accidental-duplicate case.
- Internal `DEV` gates use `esm-env` instead of `import.meta.env`, removing the package's implicit assumption of a Vite host (and the svelte-package build warning).

### Added

- **Multiple FlowDrop instances per page.** Previously all editor state lived in module-level singleton stores — mounting a second editor shared (and clobbered) the first one's workflow, undo/redo history, playground sessions, and callbacks; `destroy()` on one broke the survivor. Every mount now creates an isolated `FlowDropInstance` state container (workflow, history, playground, interrupts, categories, port coordinates, pipeline-panel state) provided to the component tree via Svelte context. The first `mountFlowDropApp`/`mountWorkflowEditor` call without the new `instanceId` option becomes the _page-default instance_ — the one `getInstance()` resolves to for single-editor embeds, with storage under the `default` scope (`flowdrop:draft:default:<workflowId>`; 1.x bare keys migrate on first read — see Breaking Changes). Additional mounts get auto-generated ids (`fd-1`, `fd-2`, …) and their own storage scope (`flowdrop:draft:<instanceId>:<workflowId>`); pass an explicit `instanceId` whenever mounting more than one editor with drafts enabled. The Svelte components (`App`, `WorkflowEditor`, `Playground`, `PlaygroundStudio`, `PlaygroundModal`, `PlaygroundApp`) accept an optional `instance` prop, and `@flowdrop/flowdrop/editor` newly exports `createFlowDropInstance`, `getDefaultInstance`, `getInstance`, `provideInstance`, `FLOWDROP_INSTANCE_KEY`, the `FlowDropInstance`/`CreateInstanceOptions` types, and the `WorkflowStore`/`HistoryStore` classes. The playground mounts take `instanceId` too — session/message _state_ is isolated, though the live-polling timer remains page-global (one active poller; use `pushMessages()` with your own transport for concurrent live updates). Still page-global by design: theme and settings (including the console/sidebar/bottom-panel UI toggles). Port-compatibility config and API endpoint config, page-global when this feature was first built, are instance-scoped as of 2.0 (`fd.portCompatibility`, `fd.api` — see Breaking Changes). As part of this work, modal/listbox/settings-tab DOM ids are generated per component instance (`$props.id()`), fixing duplicate-id a11y violations — plus a pre-existing `aria-labelledby` that pointed at a nonexistent settings-tab id. SSR note for SvelteKit consumers: the default instance is browser-only (server renders get a fresh per-render instance via the provider components), which also eliminates a cross-request state-leak hazard the old module-level stores carried.
- **Configurable draft storage backend — `draftStorage` mount option**: workflow drafts (which include node configuration values, potentially secrets) previously always landed in `localStorage`, where they persist on the device even after the tab or browser is closed. The new `draftStorage` option on `mountFlowDropApp` accepts `'local'` (default, unchanged behavior), `'session'` (tab-scoped `sessionStorage` — cleared on tab close, at the cost of crash-and-reopen recovery), or a custom `DraftStorageAdapter` (`getItem`/`setItem`/`removeItem`/`keys`). The adapter interface is **synchronous** — it suits in-memory stores and write-through caches; async backends (IndexedDB, network) need a sync cache in front. The resolved adapter is **captured per mount** (and per `DraftAutoSaveManager`), so multiple FlowDrop instances on one page can use different backends without interfering; the standalone helpers (`saveDraft`, `loadDraft`, `clearAllDrafts`, …) default to the most recent mount's backend and now accept an explicit adapter argument. `setDraftStorage`/`getDraftStorage`/`resolveDraftStorage` and the adapter types are exported from `@flowdrop/flowdrop/editor`. Note neither built-in backend protects against same-origin script access (XSS) — for secrets, prefer `features.autoSaveDraft: false` or an in-memory adapter.
- **End-user draft opt-out — "Store Drafts in Browser" behavior setting** (`behavior.storeDraftsInBrowser`, default `true`): a user-facing toggle in the settings panel's Behavior tab that gates all draft writes at runtime — including the key migration after a workflow's first save — and removes the current draft when switched off. The setting description warns that drafts may stay stored on the device even after the tab or browser is closed. Applies per tab: already-open tabs read settings at load time and keep writing drafts until reloaded. Hosts can pre-seed it via the `settings` mount option like any other setting.
- **`NavbarAction.group` — clustered flyout dropdown items**: an optional `group?: string` on `NavbarAction`. Items sharing a group cluster under a labeled header (preceded by a divider) inside the flyout dropdown; ungrouped items render first, and group order follows first occurrence in the source array. Ignored in split mode (the inline button row).
- **Playground session-UI config flags — `showNewSessionButton`, `showSessionList`**: added to `PlaygroundConfig`, and the previously orphaned `showSessionHeader` (lost in the 3-pane refactor) is re-wired to the current `ControlPanel` header. Defaults preserve existing behavior; combine the flags to lock a playground embed to a single session without exposing session-switching UI.
- **Microsecond-precision job durations across pipeline views.** A new `formatMicroseconds` helper (`src/lib/utils/duration.ts`) mirrors the backend `Duration::formatMicroseconds()` tiers (`150µs`, `2.5ms`, `1.23s`, `2m 30s`, `1h 30m`) so the playground and the Drupal admin pages render identical values. All pipeline views prefer the orchestrator-stamped `execution_time_us` from job payloads and fall back to the legacy second-granularity timestamps for jobs that predate the metadata stamp: the table view gains a right-aligned Duration column, kanban cards show a duration chip, and the canvas node-status overlay (current run + history) upgrades to µs when available. `NodeJobExecution.executionTimeUs` and `NodeExecutionInfo.lastExecutionDurationUs` are added as optional fields (additive, non-breaking).
- **Pipeline table rows expand into full job details.** The per-job detail panel now shows the completed timestamp, retry count (`retryCount` / `maxRetries`, shown only when retries occurred), and collapsible pretty-printed **Input data** / **Output data** sections (`input_data` / `output_data` from the job payload; empty objects and arrays are treated as "nothing to show").

### Changed

- **Playground `ControlPanel` starts at minimum height**: the initial `controlPanelHeight` drops from 280 to 140 (the floor of the existing clamp), giving the `ExecutionConsole` more room by default. The draggable resizer is unchanged — users can still expand the pane.
- **i18n: "Sessions" label renamed to "Session"**: singular reads more naturally given that most playground configurations focus on a single active session. Hosts overriding `messages` should update the corresponding key.
- **Dead interaction plumbing removed (internal).** Sidebar node items no longer carry `role="button"`/`tabindex` and no-op click/keydown handlers — they are drag-only and now present as plain list items (`role="list"`/`listitem`) to assistive tech. The internal `SwapMappingEditor` loses its accepted-but-ignored `checker` prop. The port coordinate store mutates a single `SvelteMap` in place (fine-grained per-key reactivity) instead of replacing the whole map per update. None of these are part of the documented API.

### Fixed

- **The theme light/dark preference is no longer reset on every page load.** Hosts passing a `settings` mount option (`mountFlowDropApp({ settings: { theme: { preference: … } } })`) reported that a user's light/dark choice "never persisted" — it reverted to the host default on each reload. `initializeSettings({ defaults })` merged the host defaults _over_ the user's saved snapshot and re-wrote it, so the host default always won. Precedence is now `DEFAULT_SETTINGS < host defaults < persisted snapshot`: host defaults seed only the values a user has never saved, and seeding no longer eagerly writes to storage (it stays user-driven, written by real changes). `initializeTheme()` is idempotent, now subscribes to the system `prefers-color-scheme` so `'auto'` tracks the OS live, and `<App>` applies the persisted `data-theme` on mount — restoring it for hosts rendering `<App>` directly, where previously only the mount helpers did.
- **Backspace-deleting a node no longer navigates the page back in embedded WebKit.** SvelteFlow's key handler deletes selected elements on Backspace but doesn't `preventDefault()`, and raw WebKit (unlike desktop Safari's UI layer) still ships the legacy "Backspace = history back" default action — so deleting a node in a WebKit-embedded host navigated away from the editor mid-delete. `WorkflowEditor` now suppresses the default for Backspace/Delete keydowns originating inside the flow canvas (inputs and contenteditable are exempt, and host-page keystrokes outside the editor are untouched). Also resolves the five long-standing webkit e2e failures, which were this bug: the test browser navigated to `about:blank` and every subsequent assertion timed out.
- **`SchemaForm` and `ConfigForm` work standalone and under SSR.** Both are documented as standalone-capable containers, but their leaf `<FormField>`s resolve the FlowDrop instance from context — a bare embed outside `<App>`/`<WorkflowEditor>` worked only via the browser's page-default fallback, and server-side rendering threw. Both forms now self-provide an instance (`provideInstance()`): nested usage reuses the ancestor's instance, bare browser usage gets the shared page-default, and a server render gets a fresh per-render instance with no cross-request leakage.
- **The documented `height`/`width` mount options now actually size the editor.** `mountFlowDropApp({ height: '600px' })` (and the same props on `App`) were accepted, forwarded, and ignored — the layout root was hardcoded to `height: 100vh; width: 100%` in CSS, which happens to match the prop defaults, so default usage never revealed the gap. `MainLayout` now exposes `height`/`width` props (CSS length strings, or numbers treated as pixels) applied via `--layout-height`/`--layout-width` custom properties, and `App` passes them through. Consumers who worked around this by sizing a wrapper element are unaffected — `height: '100%'` resolves against the wrapper as before.
- **`WorkflowEditor` drops six props it never read: `nodes`, `height`, `width`, `isConfigSidebarOpen`, `selectedNodeForConfig`, `closeConfigSidebar`.** All six were accepted and silently ignored — node metadata flows through the instance store, sizing belongs to `App`/`MainLayout` (see above), and the config sidebar is owned by `App` (`openConfigSidebar`, which `WorkflowEditor` does use, is kept). Passing the removed props was always a no-op, so runtime behavior is unchanged; TypeScript consumers passing them will now get a compile error naming the prop instead of silence. `NodeStatusOverlay`'s previously-unused `nodeId` prop is now rendered as a `data-node-id` attribute on the overlay root, giving tests and host pages a stable per-node selector.
- **Documented form props that were silently ignored now work.** Three `ConfigProperty` options documented in the OpenAPI schema (and 1.14.0 changelog) were accepted by their components and never used: `spellChecker` now toggles browser spellcheck on the markdown editor's CodeMirror content, `required` is now set on the range field's input, and `placeholder` is now shown inside the template editor while the document is empty (the separate `placeholderExample` block below the editor is unchanged).
- **Command Console `swap` no longer produces a node whose edges vanish from the canvas.** `executeSwap` hand-assembled the replacement node's `data` without `nodeId` — but node components derive their handle IDs from `data.nodeId`, so the swapped node rendered with zero handles and SvelteFlow silently dropped every edge anchored to it. The entity, status bar count, and pipeline execution all stayed correct, making an intact graph look corrupted. The replacement node now carries `data.nodeId` like palette-added nodes, and `WorkflowStore.initialize()` heals any legacy node missing it (`nodeId = node.id`) on load, so previously-swapped workflows repair themselves on next open.
- **Swap preserves every edge on multi-connection ports (e.g. tool fan-ins).** Port matching claimed a new-node port per _edge_ instead of per _old port_, so on a port with N edges (a `tools` fan-in, an output fan-out) only the first survived — the rest found the port "used" and were dropped or fuzzily rewired. Matches are now memoized per old port: all edges sharing an old port map to the same new port, while two _different_ old ports still can't claim the same new port. Applies to `computeSwapPreview` and `computeSwapPreviewWithOptions` (including the strategy/override cascade).
- **Swap port matching is exact-only — the fuzzy dataType fallback is removed.** The third matching pass ("first available port with compatible dataType") silently rewired edges to the wrong port when the right one was taken (e.g. a `text` output edge coming back as `assistant_message`). Matching is now exact port-ID, then exact name (case-insensitive); an edge whose port has no exact counterpart is dropped and reported rather than mis-wired.
- **`swap` command output names each dropped edge.** The summary now reads `(2 edge(s) dropped: node.1:text → node.2:message, …)` instead of a bare count. The inline list caps at 5 (`… and N more`); the full list is always available on `SwapNodeResultData.droppedEdgeDetails` for programmatic consumers. Internally, `computeSwapPreview` is now a thin wrapper over `computeSwapPreviewWithOptions` — one matching algorithm instead of two parallel copies.
- **Skipped node status preserved on the playground canvas overlay**: skipped nodes rendered as "Completed" and flickered between the two labels as fetches resolved, because two paths wrote node `executionInfo.status` — `WorkflowEditor`'s own fetcher (correct) and a parallel `nodeStatuses` prop through `App` that collapsed skipped/paused/interrupted into a 4-value enum. The parallel channel is removed; `WorkflowEditor.loadNodeExecutionInfo()` is now the single writer (signaled via `refreshTrigger`) and is self-canceling so the `pipelineId`-change and `refreshTrigger`-bump callers can't race.
- **AI Assistant batch no longer discarded wholesale on a single bad command.** Since 1.10.0, if _any_ command in an approved batch failed to parse (e.g. a low-quality model emitting a multiline `set` without a closing `"""`), the entire batch was refused upfront and auto-retry was skipped — so nothing applied and the assistant never tried to correct itself, even when most commands were valid. `handleApproveCommands` now **isolates** unparseable commands and executes the healthy subset, restoring the long-standing "applied to a certain extent" behavior. The atomic rollback on _execution_ failure (1.5.0) is unchanged.
- **Parse failures now feed specific, actionable feedback back to the assistant.** A new `buildRetryFeedback` (extracted to `src/lib/chat/batchFeedback.ts`) reports _which_ command failed and _why_ — the exact parser reason and offending text — alongside the live workflow state. Auto-retry on parse errors is re-enabled because the model now gets a concrete, different correction target; the original "retry reproduces the same malformed shape" cascade only happened because the old generic ask never named the failing line. Still bounded by `MAX_AUTO_RETRIES` and gated by the `chatAutoRetry` setting.

## [1.15.0] - 2026-05-28

### Fixed

- **Dependent autocomplete preserves values on undo, redo, and external config replacement (#33)**: `FormAutocomplete`'s `params`-driven `$effect` used to fire `onChange('')` whenever a mapped dependency field changed, regardless of _who_ changed it. The child couldn't tell "user picked a new account" from "undo restored the old account" — so undoing a parent-field change cascaded a value-clear on the dependents, corrupting an otherwise valid snapshot. The clearing policy now lives in the parent form: `ConfigForm`/`SchemaForm` apply the cascade in `handleFieldChange`, which only runs on user-driven edits. Undo, redo, programmatic value replacement, and collaborative edits flow through `initialConfig` / `values` and bypass it. The reverted snapshot stays intact.
- **Dependent autocomplete preserves preloaded values on form load (#31)**: `SchemaForm` and `ConfigForm` previously initialised their internal values as `$state({})` and populated them from props via a post-mount `$effect`. A dependent `FormAutocomplete` (one declaring `autocomplete.params`) captured an empty form-values snapshot at mount, then saw the fingerprint flip from empty to populated when the parent effect ran, and fired `onChange('')` — wiping the dependent field's preloaded value. Form values are now a `$derived` over the `values` / `initialConfig` prop plus a separate `edits` `$state` map; children mount with the correct values already in place, so the spurious clear can't fire. The most visible symptom — opening a saved Jira `create_issue` node and losing the `issue_type` — is gone.
- **Undo/redo restored for committed config edits**: `ConfigForm.handleFormBlur` now discharges its `edits` buffer after the commit fires. Without this, the `edits` overlay would shadow the reverted `initialConfig` value after `historyService.undo()`, leaving the form showing the user's edit while the store held the undone value; the next field-blur then re-committed the stale edit, undoing the undo. The four-character fix (`edits = {}` after `onChange`) lets prop changes — from undo, redo, or any external source — flow through cleanly.

### Changed

- **`AutocompleteConfig.params` doc contract narrowed (technically behavioral, not API).** The TypeScript surface is unchanged — same type, same fields. What changes is _who_ clears the dependent value when a dependency moves: the parent form, only on user-driven edits via `handleFieldChange`. The component continues to abort in-flight fetches and invalidate cached suggestions on any dependency change. Consumers using `ConfigForm` or `SchemaForm` (the documented happy path) see no observable change on user-driven edits, only the bug fix on undo/redo. Consumers using `FormAutocomplete` standalone outside a FlowDrop form — already warned at mount when `params` is set without `flowdrop:getFormValues` context — need to handle dependent-value clearing themselves.
- **Behavior change: `values` prop reassignment no longer wipes in-flight edits.** The old merge-via-effect re-ran on every `values` reference change and overwrote any keys the user had edited. Edits are now preserved per-key across parent re-renders; only a `schema` reference change resets them. Consumers that relied on "reset the form by passing a new `values`" should instead change the `schema` reference or remount via `{#key resetCounter}<ConfigForm ... />{/key}`.
- **Behavior change: mid-typing undo shows the user's keystroke, not the reverted value.** Previously the merge effect wholesale-wiped `formValues` on every prop change, including reverts that arrived while the user was still typing — yanking the keystroke out from under them. The new design keeps the user's in-flight edit visible until they commit (blur) or discard focus. The store is correct either way; only the displayed value differs while focus is held.

## [1.14.0] - 2026-05-27

### Added

- **OpenAPI spec ships with the package** (`@flowdrop/flowdrop/openapi`): The full backend API spec is copied into `dist/openapi/v1/openapi.yaml` during packaging and exposed via the `@flowdrop/flowdrop/openapi` (and `/openapi/v1`) export, version-matched to the installed release. Consumers — and their AI assistants — can read the node-config (`ConfigProperty`), playground-message, and endpoint schemas without needing the monorepo or api.flowdrop.io. Still browsable at [api.flowdrop.io](https://api.flowdrop.io).
- **Editor-tuning properties documented in `ConfigProperty`**: `readOnly`, `height`, `darkTheme`, `autoFormat`, `showToolbar`, `showStatusBar`, `spellChecker`, and `placeholderExample` are read by the form renderer for the code/JSON, markdown, and template editor fields but were never declared in the OpenAPI schema. They are now documented, so consumers validating node config against the published spec no longer see them as unknown properties.
- **Pipeline nesting fields on playground messages — `parentPipelineId`, `rootPipelineId`**: `PlaygroundMessage` now carries authoritative lineage fields so clients can distinguish main-pipeline messages from nested sub-flow messages (the display-only `hierarchy` is not a reliable nesting signal). `parentPipelineId` is `null` for top-level messages; `rootPipelineId` equals the message's own `executionId` for main runs. A session's `executions` list is documented as containing main runs only.
- **Backward pagination for playground messages**:
  - API: `GET /playground/sessions/{sessionId}/messages` gains optional `before` (backward cursor) and `latest` (fetch the tail) query params plus a `hasOlder` response field. Additive and non-breaking — omitting them preserves the legacy oldest-first behavior.
  - Client: `getMessages` takes an options object (`since` / `before` / `latest` / `limit`), the messages response type gains `hasOlder`, and a `messagePageSize` config option is added.
  - UI: the chat loads the most recent page first and seeds polling from the newest sequence, then pages older messages on scroll-up via an IntersectionObserver sentinel that anchors the viewport so prepends don't shift the reading position.

### Changed

- **Main pipeline kept in focus; sub-flows excluded from the run-switcher**: Runs are classified from their messages' `parentPipelineId`; the sidebar stays on the most recent main run and sub-flow executions are excluded from the run-switcher (selecting one can't render its own graph, so listing them was dead UI). A new main run auto-follows by clearing the pin. All still-running executions are marked terminal when the session ends, since sub-flows mean a session can track more than one execution at once.

### Fixed

- **Playground message-load races**: `loadSession` is guarded against stale concurrent loads, an older-message page is dropped if the session changed mid-fetch, and autoscroll no longer fights the scroll-up anchor.
- **Run/session dropdown height**: session and run dropdowns are capped in height so the controls below them stay reachable.

## [1.13.0] - 2026-05-23

### Added

- **Server-driven playground message annotations — `hierarchy`, `tags`, `display`**: `PlaygroundMessage` now carries three optional server-emitted fields that let the server fully control message presentation without any client-side derivation:
  - `hierarchy: MessageHierarchyItem[]` — ordered path (e.g. workflow > sub-workflow > iteration), rendered as a chevron-separated trail. Display-only — this is not a navigation breadcrumb.
  - `tags: MessageTag[]` — classification chips with a closed-enum `color` (`muted | primary | success | warning | error | info`) and `variant` (`subtle | solid | outline`). When the server emits tags, the client renders exactly those — no merge with client-side defaults.
  - `display: PlaygroundMessageDisplay` — layout hint (`bubble | log | notice | card`). When omitted, the client picks a default from the role.
  - Pure `resolveMessageDisplay(message, options)` helper is exported alongside the types so consumers can mirror the dispatch.
  - Full contract documented in `api/README.md`.

- **`m().playground.messageAnnotations.hierarchyOf({ path })` i18n function**: Names a message's hierarchy trail by the path itself (e.g. `"From: ForEach Loop / Greeter"`). Hosts overriding `messages` should provide a localised function that accepts the joined path string. The tag strip has no aria-label — each chip self-labels and a generic group label was noise.

- **`awaiting_input` added to `PlaygroundSessionStatus` OpenAPI enum**: The TypeScript type already accepted this value; the schema is now in sync.

- **Dependent autocomplete fields via `autocomplete.params`**: `AutocompleteConfig` gains an optional `params` map (`{ paramName: fieldName }`) that wires sibling form values into the suggestion-fetch URL as query parameters. `FormAutocomplete` reactively clears the selected value and invalidates the suggestion cache when any dependency changes, guarded against firing on initial mount so restored config values are preserved. Added to the OpenAPI YAML schema and regenerated JSON Schema.

- **`FORM_VALUES_KEY` context key and `FormValuesGetter` type**: Both are now exported from `@flowdrop/flowdrop/form`. Custom field components registered via `fieldComponentRegistry` can call `getContext(FORM_VALUES_KEY)` to receive a `() => Record<string, unknown>` getter that always returns the current values of all sibling fields in the form. The context is set by both `ConfigForm` and `SchemaForm`. This is the stable public API for building cross-field interactions such as dependent autocomplete fields.

- **`schema` prop on registered autocomplete components**: Custom components registered to handle `format: "autocomplete"` fields (via `fieldComponentRegistry`) now receive the full `FieldSchema` object as a `schema` prop. This gives access to any custom property on the schema definition — for example a `dependencies` map — without FlowDrop needing to anticipate and forward each one individually.

- **`FormAutocomplete` exposed via `@flowdrop/flowdrop/form/autocomplete` subpath**: Consumers can now import and wrap `FormAutocomplete` directly to build custom autocomplete UIs without reimplementing type-ahead, debounce, and abort logic. `FormField` and `FormFieldLight` also consult `fieldComponentRegistry` for autocomplete fields, rendering registered overrides with the full prop set (including `node`, `edges`, and the resolved `autocomplete` config) before falling through to the built-in component.

- **Mobile responsiveness for the playground**: At ≤768 px viewports, `PlaygroundStudio` switches from side-by-side panes to one-at-a-time fullscreen. The pipeline panel takes the full viewport when open and exposes a "Back to chat" affordance; the drag resizer is hidden. Message bubbles, log rows, system notices, cards, and interrupt footers now flex-wrap and tighten padding at small widths; hierarchy labels truncate to 5 rem and log timestamps hide to recover horizontal space.

- **Container-query log layout**: `.message-stream` is now a CSS container (`container-name: fd-message-stream`). When the stream is ≤480 px wide, log rows stack onto three lines — meta/hierarchy on row 1, message body on row 2, tags on row 3 (indented to align with the body); timestamps hide. Triggered by container size, not viewport, so it fires correctly in narrow embedded mounts regardless of window size. A medium 2-row variant is also available.

- **Accessibility pass on the message stream**: Message bubbles and cards are `<article>` with role-named aria-labels; log rows carry `role="listitem"` + level/source aria-labels; system notices use `role="status"`. Tag groups are `role="group" aria-label="tags"`, individual chips include any `tag.type` in their aria-label, hierarchy trails wrap their `<ol>` in `<nav aria-label="message hierarchy">` and mark the last crumb with `aria-current`. Timestamps are `<time datetime=…>` with natural-language aria-labels. All decorative Iconify icons are `aria-hidden`. `prefers-reduced-motion` is respected on bubble/card fade-in and `InterruptBubble`'s slide-in.

### Fixed

- **Auth headers on `fetchCategories` and `fetchPortConfig`** (#27): Both functions hardcoded only `Content-Type` and ignored both the legacy `endpointConfig.auth` and the `AuthProvider` path. They now accept an optional `AuthProvider`, merge its headers on top of `getEndpointHeaders`, and `mountWorkflowEditor` exposes the same option.

- **`FormAutocomplete` correctness pass**: Four issues fixed —
  - Dependency-change guard replaced with value-comparison (`prevDepFingerprint`) so it works reliably on deferred and SSR mounts.
  - `AbortController` timeout race: the 5 s timeout closure now captures the controller in a local const and `clearTimeout` runs in `finally`, so the right request is always aborted regardless of exit path.
  - Suggestions cleared on blur when `params` is configured, so `fetchOnFocus` always re-fetches with current dependency values instead of showing stale results.
  - Warns via logger when `params` is non-empty but the `flowdrop:getFormValues` context is absent (silent failure in standalone usage).

- **Compact log rows in narrow panes**: Log rows no longer crammed together in narrow chat panes / embedded mounts — driven by the new container-query layout above.

### Changed

- **`MessageBubble` internals split into per-layout components**: `MessageBubble.svelte` is now a thin dispatcher (~50 lines) over `ChatBubble`, `LogRow`, `MessageNotice`, and `MessageCard`. Shared primitives `HierarchyTrail`, `MessageTagStrip`, and `MessageMarkdown` deduplicate the markup. `MessageTagChip` is driven by CSS custom properties. Public props on `MessageBubble` are unchanged, so this is internal-only.

## [1.12.0] - 2026-05-16

### Added

- **Kanban pipeline view**: A new `kanban` view in `PipelinePanel` renders a board where columns are driven by the server's `kanban_config` field on the pipeline response. Each column maps one or more execution statuses via `KanbanColumnDef.statuses`, so the board layout is entirely server-configurable without a client-side code change.
- **`KanbanColumnDef` and `KanbanConfig` types**: New exported types that model a server-defined kanban column (`key`, `label`, `statuses[]`, optional `color`) and the top-level `kanban_config` object (`columns[]`) returned by the pipeline API.
- **`paused` and `interrupted` execution statuses**: `NodeExecutionStatus` and `ExecutionStatus` now include `'paused'` (orange) and `'interrupted'` (cyan). Both statuses have dedicated icons, color tokens, and labels across the table, graph, and kanban views.
- **`status_summary` extensions**: `JobStatusSummary` gains `skipped`, `paused`, and `interrupted` count fields, mirroring the API schema update.
- **Pipeline table accordion rows**: Clicking a row in the pipeline table expands an inline accordion panel showing per-node execution details (start/end times, status, output). A second click collapses it.
- **`PipelineViewDef` extensibility**: `mountPlaygroundStudio()` now accepts a `pipelineViews` option and `PlaygroundStudio` accepts an `extraPipelineViews` prop. Each entry defines a `key`, `icon`, `label`, and a Svelte component that receives `PipelineViewProps`. The view key is persisted in `localStorage` and validated against built-ins + injected views on restore. `PipelineViewDef` and `PipelineViewProps` are exported from `@flowdrop/flowdrop/playground`.
- **New playground sub-components exported**: `MessageStream`, `ChatInput`, `ExecutionConsole`, and `ControlPanel` are now exported from `@flowdrop/flowdrop/playground` for hosts that need to compose custom playground layouts.
- **`getShowLogs()` store helper**: Exposed from `@flowdrop/flowdrop/playground` to read the playground log-panel visibility state.
- **Locked workflow graph in playground**: When no pipeline execution is running the playground now renders the workflow graph in read-only mode instead of a blank panel, giving users a visual reference of the workflow structure at all times.
- **Create session button**: When a playground has no sessions at all a prominent "Create session" button is shown directly in the empty state instead of an uninformative blank screen.
- **Full status coverage in table and graph views**: The pipeline table and execution graph now render distinct icons and color badges for every `NodeExecutionStatus` value, including the new `paused` and `interrupted` states.

### Fixed

- **Polling survives interrupts and terminal statuses**: The playground polling loop was silently cancelled when a pipeline reached a terminal status or transitioned through `awaiting_input`. Polling now resumes correctly after an interrupt is resolved and continues until the session is genuinely idle.
- **Unreported nodes no longer default to `pending`**: Nodes not mentioned in a pipeline response were being shown as `pending`. They are now left in their previous state (typically `idle`) until the server explicitly reports them.
- **Panel size re-clamp on container resize**: Draggable panel widths were not re-clamped when the viewport resized, causing the pipeline panel to overflow or jump. A `ResizeObserver` now re-applies the min/max constraints whenever the container dimensions change.
- **Node type label shows `metadata.id`**: The pipeline table was displaying the internal `universalNode` discriminator instead of the human-readable `metadata.id` value as the node type.
- **Node interaction disabled when workflow is locked or read-only**: Clicking or dragging nodes in the editor graph is now prevented when the workflow is in a locked or read-only state.
- **`showLogs` prop syncs reactively**: The log panel visibility was reading a stale prop value; it is now driven by a `$effect` that tracks the prop correctly.
- **Keyboard accessibility — interrupt prompts**: HITL interrupt dialogs can now be dismissed and confirmed with the keyboard.
- **Keyboard accessibility — session and pipeline chip dropdowns**: Both dropdowns are now fully navigable via keyboard (Arrow keys, Enter, Escape).
- **Port handles removed from keyboard tab order**: Port handles on workflow nodes are no longer reachable via Tab, reducing noise for keyboard-only users navigating the editor.
- **Keyboard-controlled horizontal resizer**: The `PlaygroundStudio` split-pane resizer responds to `ArrowLeft` / `ArrowRight` keys (10 px increments) in addition to mouse drag.

### Changed

- **Playground `i18n` — all UI strings are now message-keyed**: Every hardcoded string in the playground (button labels, status text, empty-state messages) has been extracted into the FlowDrop message map. Hosts that supply a custom `messages` object can now translate or override playground copy.
- **Playground internals refactored into `PlaygroundStudio`**: The demo `+page.svelte` and the `Playground` component have been restructured around the `PlaygroundStudio` 3-pane layout. This is an internal change with no public API impact.

## [1.11.0] - 2026-05-11

### Added

- **`PlaygroundApp` component**: A full-page playground wrapper that pairs the FlowDrop `Navbar` with `PlaygroundStudio`. Callers build their own `primaryActions` array (no hardcoded back/edit URLs), so the component can be embedded in any host that wants the standard FlowDrop chrome around the playground. The Navbar settings modal is wired through (`showSettings`, `settingsCategories`, `showSettingsSyncButton`, `showSettingsResetButton`) so hosts can restrict which tabs appear or hide the gear entirely.
- **`mountPlaygroundApp()`**: Vanilla JS / framework-agnostic mount function for `PlaygroundApp`, alongside a matching `PlaygroundAppMountOptions` type. Mirrors `mountPlaygroundStudio` so non-Svelte hosts (e.g. Drupal) can embed the full chrome.
- **`settings` option on all playground mount functions**: `mountPlayground`, `mountPlaygroundStudio`, and `mountPlaygroundApp` now accept a deep-merged `PartialSettings` value, mirroring `mountFlowDropApp`. Theme is re-initialized on every mount, after validation, so failed calls do not mutate global theme state.
- **Shared `NavbarAction` type**: Extracted to `types/navbar.ts` as the single source of truth and re-exported from the package entry points.

### Fixed

- **Mount runtime validation for `mode: 'modal'`**: `mountPlaygroundStudio` and `mountPlaygroundApp` now reject `mode: 'modal'` at runtime with a clear error, so JS hosts (Drupal SDC, where TS narrowing does not apply) get a useful message instead of a silent miscast.
- **`Playground` standalone height**: Switched from `height: 100vh` to `height: 100%` so the chat input is not clipped when a host wraps `Playground` with a navbar.

### Changed

- **No implicit `height`/`width: '100%'` default on playground mounts**: The previous default did not resolve inside parents that only set `min-height` (e.g. Drupal admin chrome under `.fd-fullscreen-layout`), collapsing the playground to zero. Hosts that need an inline size must now pass one explicitly via the `height` / `width` options; hosts that already size the container via CSS no longer have it overwritten. If you previously relied on the implicit cascade, pass `height: '100vh'` (or your desired value) when calling `mountPlayground` / `mountPlaygroundStudio` / `mountPlaygroundApp`.

## [1.10.0] - 2026-05-10

### Added

- **`PlaygroundStudio` component**: A drop-in split-pane component that combines `PipelinePanel` and `Playground` side by side — the same layout as the demo app, available as a single import. Accepts a `minChatWidth` prop (CSS-var backed, default 760 px).
- **`mountPlaygroundStudio()`**: Vanilla JS / framework-agnostic mount function for the split-pane layout, alongside a matching `PlaygroundStudioMountOptions` type. Mirrors `mountPlayground` so host apps can embed the integrated experience without Svelte.
- **Missing pipeline exports from 1.9.0**: `PipelinePanel`, `ExecutionList`, `PlaygroundExecution`, `getActiveExecutionId`, `getPinnedExecutionId`, `getLatestExecutionId`, `getPipelinePanelOpen`, and `pipelinePanelActions` are now all exported from the `@flowdrop/flowdrop` and `@flowdrop/flowdrop/playground` entry points.
- **`source` field on playground messages**: `PlaygroundMessageMetadata` gains an optional `source?: string` property so the subsystem that produced a message (e.g. `'pipeline'`, `'job'`, `'cron'`) can be identified. Rendered as a small pill badge before the node label in log rows and before the text in compact system notices.
- **Refresh button and `flowdrop:refresh-status` DOM event**: A Refresh button in the playground header triggers an immediate fetch of the latest messages and resumes polling if it had stopped. Host applications can also dispatch `flowdrop:refresh-status` on the mount container to trigger the same action programmatically.
- **Sequence-number polling cursor**: Incremental message fetches now use `?since=<sequenceNumber>` instead of a timestamp, matching the `PlaygroundMessage.sequenceNumber` field in the OpenAPI spec. `getLastSequenceNumber()` is exposed from `playgroundService`; `getLatestSequenceNumber()` and `getLastPollSequenceNumber()` from `playgroundStore`. `startPolling` accepts an optional `initialSequenceNumber` seed to avoid a full re-fetch on restart.
- **Automatic pipeline panel refresh**: When following the latest run (not pinned to a historical execution), the pipeline panel re-fetches pipeline data from the server on every incoming message batch. Pinned historical runs are unaffected. The panel also auto-clears the pin when a new execution is detected in incoming messages, or when the user sends a new message.
- **`PlaygroundMessagesPagination` type**: Exported from both `@flowdrop/flowdrop/playground` and the core index.
- **`getCanSendMessage()`**: New store helper that combines `isExecuting`, `awaitingInput`, and no-active-session guards into a single predicate for the send button and `handleSend`.

### Fixed

- **Automatic pagination of `getMessages`**: `playgroundService.getMessages` now follows pagination automatically — it fetches pages of 100 until `pagination.has_more` is false, then returns all messages merged. Previously only the first page was returned when a session had many messages. Also corrects `PlaygroundMessagesApiResponse` to match the actual server shape where pagination is nested under `pagination: { has_more, total, limit, offset }` rather than a top-level `hasMore` field.
- **Pipeline run picker status icon after completion**: Execution entries were stuck at `'running'` indefinitely because `updateSessionStatus()` only promoted them to `'completed'` on `'completed'` or `'failed'` — but the server returns `'idle'` when a pipeline finishes normally. `'idle'` is now mapped to `'completed'` in the `PlaygroundExecution` entry.
- **Node statuses in pipeline panel after HITL resolution**: `WorkflowEditor` accepted a `nodeStatuses` prop but never applied it, so Confirmation and Chat Output nodes remained in their pre-interrupt visual state after an interrupt resolved (since `loadNodeExecutionInfo` only fires on `pipelineId` change). A new `$effect` watches `props.nodeStatuses` and maps values onto `flowNodes[*].data.executionInfo` directly from the data already fetched by `PipelineStatus.fetchPipelineData()`.
- **Execution ID detection from interrupt metadata**: The server no longer stamps `executionId` on user messages — it now arrives only as `metadata.execution_id` (snake_case) inside interrupt messages. `syncExecutionsFromMessages` falls back to that field so new runs are correctly detected and the pipeline panel switches to the right run.
- **`PlaygroundStudio` refresh trigger**: `PlaygroundStudio` was passing `refreshTrigger={getMessages().length}` (a stale approach) instead of `getPipelineRefreshTrigger()`, which applies the pinned-vs-latest guard. Aligned with the fix already in `+page.svelte`.
- **`isExecuting` / `isPolling` desync**: `isExecuting()` was reading `playgroundService.isPolling()`, which returns `true` whenever a polling loop is active — including during `awaiting_input` when `_isExecuting` is `false`. It now reads `getIsExecuting()` from the store, which is derived from `_currentSession.status === 'running'`, so the two cannot desync. The stop button and send button guards are updated accordingly.
- **State machine edge cases**: `loadSession` seeds the polling timestamp and uses `applyServerResponse`; `handleSelectSession` resets status to `idle` before loading the next session; `handleSendMessage` guards with `getIsExecuting()` and resets to `idle` on error; `handleStopExecution` resets status in the catch block; `handleInterruptResolved` restarts polling and sets executing if the server resumed. A `visibilitychange` listener triggers an immediate catch-up fetch when the user returns to the tab.
- **Concurrent session loads**: `loadedInitialSessionId` is assigned before the first `await` in `loadInitialSession`, making the `$effect` guard visible synchronously and preventing a second concurrent load when reactive dependencies change mid-load.
- **Intra-batch message duplicates**: `addMessages` now deduplicates against the incoming batch itself (not only existing messages), preventing `each_key_duplicate` errors when the server returns the same message ID twice in one response.
- **Scroll to bottom on new messages**: Scroll anchor now fires reliably when new messages arrive, fixing cases where the message list did not scroll to the latest entry.
- **Log row icon alignment**: Icons in playground log rows are now vertically centered.

### Changed

- **Pipeline selector shows execution ID, not "Run #N"**: The pipeline chip and run picker popover now display the raw execution ID in a monospace truncated format. The `runLabel` prop is removed from `PipelineStatus`; it receives `pipelineId` directly as its label. `PlaygroundStudio` and the page component no longer need to compute a run label.
- **Pipeline refresh trigger moved into the store**: `applyServerResponse` now owns the `_pipelineRefreshTrigger` counter and increments it whenever a message batch arrives while following latest. Consumer pages call `getPipelineRefreshTrigger()` and pass it to `PipelinePanel`.

## [1.9.0] - 2026-05-09

### Added

- **Integrated pipeline view in the playground**: A toggleable side panel displays a live embedded pipeline canvas alongside the chat. The panel can be shown or hidden via a pipeline toggle in the session header, without leaving the playground.
- **Resizable pipeline panel**: Users can drag the separator between the pipeline panel and the chat panel to adjust the split to their preference.
- **Run picker and "latest" toggle in the pipeline panel header**: Select a specific run to inspect directly from the panel, or pin to the latest run automatically.
- **Session chip dropdown in standalone playground**: Replaces the previous sidebar with a compact chip that opens a dropdown for switching sessions, reducing visual clutter.
- **Global skin token propagation**: Skin design tokens are now applied from the top-level app layout so all embedded views inherit the correct theme.

### Fixed

- **Pipeline panel canvas height**: The embedded canvas now fills the panel correctly instead of expanding to `100vh`, which previously caused the panel to overflow the viewport.
- **Pipeline toggle icon**: Corrected to `mdi:source-branch` to match the icon used in the Pipelines navigation item.

### Changed

- **Session routing**: Playground sessions now navigate via dedicated URL segments for cleaner, bookmarkable URLs.
- **Pipeline and Logs toggles moved to session header**: Both controls now live beside the session title rather than being split across the navbar and chat panel.
- **Edit workflow link moved to navbar**: Relocated from the chat header for more consistent top-level navigation.
- **Playground layout**: Pipeline panel is now in the middle column; chat panel is on the right.
- **Log display**: Log entries replaced with compact terminal-style rows for denser, more readable output.
- **Chat bubble design**: Modernized visual treatment with updated typography and spacing.
- **Pipeline run chip label**: The current run label is always visible in the pipeline chip regardless of pin state.
- **Design tokens**: Hardcoded colour and sizing values in the playground replaced with `--fd-*` design tokens. Pipeline panel and embedded canvas use `--fd-muted` background.

## [1.8.1] - 2026-04-28

### Fixed

- **AI Assistant freeze on corrupted batches with unclosed `"""`**: When a low-quality LLM emitted a multiline `set` value that opened `"""` without a matching closing `"""` on its own line, `extractCommands` silently swallowed everything from the opener through end-of-input. Surviving commands referenced nodes whose `add` had been eaten, failing with `NODE_NOT_FOUND` and triggering up to three auto-retry round-trips that locked the chat input behind `isLoading`. The dangling buffer is now flushed as a (broken) command at end-of-input, the parser flags it with a clear `Unclosed """ block` error, and `handleApproveCommands` skips the auto-retry cascade when the batch already contained a parse error.

## [1.8.0] - 2026-04-28

### Added

- **`clearAllDrafts()` API**: New method on the mounted `MountedFlowDropApp` instance and as a standalone export from `@flowdrop/flowdrop/editor`. Removes every `localStorage` key beginning with `flowdrop:draft:` (plus the configured `draftStorageKey`, when called via the instance). Intended for host applications to call from their logout handler so workflow drafts do not persist across user sessions on shared browser profiles.
- **Typed, overridable messages system (i18n)**: Every user-facing label, tooltip, placeholder, and notice in the library is now rendered from a single typed `Messages` tree. Pass `messages` to `<FlowDrop>` (a `DeepPartial<Messages>` value or a callback returning one) to override any subset; missing keys fall through to the English defaults. Reactive overrides (paraglide-js, sveltekit-i18n, or any reactive store) propagate locale changes into FlowDrop without a subscription. New public exports from `@flowdrop/flowdrop`: `defaultMessages`, `mergeMessages`, `setMessages`, `getMessages`, `m`, plus the `Messages` and `MessagesOverride` types. Components used outside the `<FlowDrop>` provider fall back silently to English.

### Changed

- **"AI Chat" renamed to "AI Assistant"**: The bottom-panel tab label, panel notice, settings entry ("AI Assistant Auto-retry"), and aria-label now read "AI Assistant" to better reflect the panel's role as a workflow-building assistant rather than a generic chat. Internal component names, CSS classes, and the underlying `chat` settings/storage keys are unchanged, so no host-side migration is required.

### Deprecated

- **Per-component label props in favour of `messages`**: `SchemaForm`'s `saveLabel` / `cancelLabel`, `FormToggle`'s `onLabel` / `offLabel`, `FormArray`'s `addLabel`, and `AIChatPanel`'s `placeholder` keep working but emit a one-shot dev-mode `console.warn`. They will be removed in v2.0. Replace each with the corresponding key under `messages` (see the i18n guide for the mapping table). Workflow-level overrides on interrupt configs (`config.confirmLabel`, `config.acceptAllLabel`, etc.) are **not** deprecated — those are runtime data from the workflow author, not component-prop API.

### Fixed

- **Minimap visually distinct from canvas**: The MiniMap defaulted to `--fd-card`, which is identical to `--fd-background` in light mode, causing users to click and drag on it mistaking it for the canvas. The minimap background now uses `--fd-muted`, node fill uses `--fd-muted-foreground` for contrast in both light and dark modes, and the panel renders with a border, rounded corners, and a shadow so it reads as a floating overlay.
- **Markdown editor strings reconfigure on locale change**: `FormMarkdownEditor`'s placeholder and content `aria-label` live inside CodeMirror, which sits outside Svelte's reactivity graph. They now reconfigure via dedicated `Compartment`s when the consumer's locale changes, so translated copy reaches the editor without a remount.

### Performance

- **Identity-preserving message merge**: `mergeMessages` now lazy-allocates — when override leaves are `===` to the corresponding base values (the common case for paraglide-style overrides where `p.save()` returns the same `'Save'` string each call thanks to JS string interning), the base reference is returned unchanged at every level it applies. Stops downstream `$derived(m().branch)` reads in components from invalidating on every parent re-render when the consumer passes an inline `messages={{...}}` literal whose contents are stable but whose outer identity churns.
- **Hoisted `m()` branch reads**: Components that read the same `m().branch.*` repeatedly per render now pull the branch into a single `$derived` at the top of the script — one getter walk per render instead of N×M. Covers Navbar, NodeStatusOverlay, FormArray, all interrupt prompts, AIChatPanel, CommandPreview, ChatPanel, SessionManager, NotesNode, and the per-port `aria-label`s inside `WorkflowNode` / `GatewayNode` `{#each}` loops, plus FormAutocomplete and FormPrompt.

### Documentation

- **Logout integration recipe**: `auto-save-and-drafts.md` now documents that drafts persist in `localStorage` until explicitly cleared and shows the recommended `clearAllDrafts()` integration pattern.
- **i18n & Custom Messages guide**: New `apps/docs` page covering the `messages` prop, the `Messages` shape by domain, the paraglide-js wiring recipe, and the migration table from deprecated label props.

## [1.7.0] - 2026-04-10

### Added

- **`workflowSettingsSchema` prop**: Pass a `ConfigSchema` to the `App` component to inject additional fields into the Workflow Settings panel. Values are persisted in a new `workflow.config` field and round-trip correctly through load/save.

### Fixed

- **CodeEditor JSON string preservation**: External value updates to a `CodeEditor` field no longer strip quotes from JSON string values.
- **`workflowSettingsSchema` reserved name collision**: Consumer-supplied schema properties that shadowed built-in workflow fields (`name`, `description`, `format`) would silently overwrite the schema definition and produce a broken settings panel. Colliding keys are now filtered out and a warning is logged.
- **Port preservation on mount**: `App` no longer reinitialises the port compatibility checker when one has already been set, preserving custom port configs in SvelteKit route usage.
- **SimpleNode description fallback removed**: Nodes without a description no longer render a placeholder `"A configurable simple node"` paragraph.

### Refactored

- **Port compatibility init check**: Replaced try/catch-as-sentinel pattern with an explicit `isPortCompatibilityInitialized()` predicate, making the intent clear and reserving exceptions for genuinely unexpected conditions.

## [1.6.0] - 2026-04-08

### Added

- **Progressive command execution**: AI chat apply flow executes each command with a 100 ms inter-command delay so canvas updates are visually distinct. `executeBatch` is now async with an optional `delayBetweenMs` option; undo still covers the entire batch as a single transaction.
- **Command preview feedback states**: After clicking Apply, preview buttons are replaced with "Applying…" (spinning) then "Applied" (green). After Cancel, replaced with "Dismissed" (muted). The preview block stays mounted in both cases so chat history shows what was actioned.
- **AI response markdown rendering**: Assistant messages in the AI Chat panel are rendered as sanitised markdown instead of plain text.
- **Auto-retry on batch command failure**: When AI-generated commands fail, the panel automatically sends a structured error report back to the LLM (up to 3 attempts) so it can self-correct. Retry notices render as muted "Auto-retrying (attempt N/3)…" spinners, keeping raw error context out of the visible conversation. Controlled by a new `chatAutoRetry` setting in `BehaviorSettings` (default: `true`).

### Fixed

- **Triple-quote multiline parsing**: `chatResponseParser` and the commands parser now correctly handle triple-quoted (`"""`) multi-line strings in DSL blocks, preventing premature block truncation.

## [1.5.0] - 2026-04-03

### Added

- **Node swap**: Users can replace a node with a different node type while preserving connections and configuration. A three-pass port matching algorithm maps ports by name, type, and direction, carrying over compatible config values automatically.
- **Swap UI components**: New `NodeSwapPicker`, `SwapMappingEditor`, and `SwapConfirmBar` components with full skin-aware theming support for both default and minimal themes.
- **Swap store integration**: `workflowStore.swapNode()` action with `onBeforeSwap` and `onAfterSwap` event hooks, plus JSON schema support for swap configuration validation.
- **Interrupt prompt previews**: Human-in-the-Loop documentation now includes live interrupt prompt previews.
- **Command console**: A DSL-driven command console lets users control the canvas via typed commands — add/delete nodes, connect ports, rename, get/set config, undo/redo, select, move, swap, and auto-layout. Toggle with a toolbar button or keyboard shortcut.
- **Command autocomplete**: Context-aware autocomplete suggests command verbs, node type IDs, live node IDs, port names, and config keys as the user types.
- **Command history**: Up/Down arrow keys navigate previously executed commands within the session.
- **Multi-line paste execution**: Pasting multiple lines into the console executes each line as a separate command in sequence.
- **Rich console output**: Command results are formatted with colour-coded status, structured tables for `list`, and inline node/port detail for `info`.
- **Canvas commands**: `canvas fitview`, `canvas zoom <level>`, `canvas pan <x> <y>`, and `canvas reset` control the viewport from the command line.
- **Layout command**: `layout beautify` normalises node spacing across the canvas using dimension-aware auto-layout with increased horizontal distance (120 px).
- **AI Chat panel**: A bottom-panel chat UI sends natural-language prompts to a configurable backend chat endpoint. The assistant's response is parsed for embedded FlowDrop DSL command blocks, which are previewed and can be applied to the canvas in one click.
- **CommandPreview component**: Displays extracted DSL commands from an AI response with accept/cancel controls before they are executed.
- **Bottom panel tab system**: Extensible tab bar at the bottom of the canvas hosts the AI Chat panel and future panels.
- **Chat API service**: Typed `chatService` wraps the chat endpoint; `chatResponseParser` and `commandClassifier` are independently unit-tested.
- **MSW mock handlers**: Development and test mock handlers for the chat API endpoints ship with the library.
- **OpenAPI spec for chat endpoints**: `libs/flowdrop/api/v1/paths/chat.yaml` documents the chat request/response contract.
- **`COMMAND_HELP` export**: Machine-readable command help is exported for use by backend LLM prompts.
- **DSL prompts**: `dsl-system-prompt.md` and `dsl-llm-prompt.md` ship as reference material for integrating the FlowDrop DSL with LLM backends.

### Fixed

- **Reactive derivations**: Replaced `$derived(() => { ... })` block-style pattern with `$derived.by(() => { ... })` across components, fixing Svelte 5 reactivity warnings.
- **Sidebar search**: Eliminated duplicate filter pass in node sidebar search; now uses a plain `Set` for deduplication.
- **Cycle detection**: Cycle detection in the graph editor is cached as a `$derived` with an FSM guard, preventing redundant recomputation on unrelated state changes.

### Performance

- **Version counter dirty detection**: Replaced JSON snapshot comparison in workflow stores with an integer version counter, eliminating per-keystroke serialisation overhead.
- **`structuredClone` for history snapshots**: History snapshots now use `structuredClone` instead of `JSON.parse(JSON.stringify(...))`, cutting snapshot time roughly in half.
- **Proximity type cache**: Compatible-types lookup in the proximity connection helper is cached per `dataType` for the duration of a drag, avoiding repeated linear scans.
- **Insertion sort for playground messages**: Single-message additions to the playground message list use insertion sort rather than a full re-sort.
- **Pending interrupt count**: Pending interrupt count is derived with a counter loop rather than `.filter().length`, avoiding an intermediate array allocation.
- **Bezier path deduplication**: Redundant bezier path calculation on the edge renderer is eliminated; the result computed for rendering is reused for arrowhead positioning.
- **Edge style node lookup**: Edge style helper uses a `Map` lookup instead of `.find()` on every render, reducing per-edge cost from O(n) to O(1).
- **Port coordinate batch updates**: `portCoordinateStore` batches `SvelteMap` writes so subscribers receive a single notification per layout pass instead of one per port.

## [1.4.0] - 2026-03-16

### Added

- **Settings modal customization**: `mountFlowDropApp` now accepts `settingsTitle`, `settingsDescription`, and `settingsFields` options, allowing vanilla JS consumers to customize the settings modal without Svelte.
- **Themeable logo**: Logo colors are now driven by skin tokens (`--fd-logo-*`), adapting automatically to light/dark themes.
- **Themeable xyflow controls**: SvelteFlow Controls and MiniMap components now inherit colors from skin tokens instead of using hardcoded defaults.
- **Sidebar collapse**: Sidebar collapses fully to zero width with a floating canvas toggle button, freeing more canvas space.
- **Dynamic ports for all node types**: SimpleNode and SquareNode now support `config.dynamicInputs` and `config.dynamicOutputs`, allowing users to add custom input/output ports at runtime via the config form. Previously only WorkflowNode rendered dynamic ports.

### Fixed

- **Arrowhead alignment**: Edge arrowheads now use the exact bezier derivative at the endpoint for rotation, eliminating subtle misalignment on curved edges.
- **Navbar overflow**: Action buttons remain accessible on small screens; breadcrumbs compact to icon-only at narrow widths.
- **Storybook warnings**: Resolved `svelte-check` warnings in EdgeDecorator story and fixed incorrect `iconName` prop usage in CanvasBanner story.

### Changed

- **Sidebar header**: Removed redundant "Components" header from the node sidebar.
- **Navbar layout**: Responsive navbar now uses icon-only breadcrumbs and a compact logo on smaller viewports.

### Internal

- Converted codebase from tabs to 2-space indentation.
- Regenerated workflow JSON schema.
- Documented `SettingsPanel` and `SettingsModal` component props with vanilla JS usage examples.

## [1.3.0] - 2026-03-15

### Added

- **Port ordering**: `portOrder` field on `NodeUIExtensions` lets consumers define a custom display order for ports on WorkflowNode, SimpleNode, and SquareNode.
- **Manual port hiding**: `hiddenPorts` field on `NodeUIExtensions` allows specific ports to be explicitly hidden by ID, complementing the existing "hide unconnected ports" setting.
- **All-ports display**: SimpleNode and SquareNode now render all ports by default. The previous heuristic that limited display to at most one data port and one trigger port per side has been removed.
- **Shared port utilities**: `getPortTop` and `isPortVisible` extracted as pure, tested utilities in `portUtils.ts`, eliminating duplicated positioning and visibility logic across node components.

### Changed

- **SimpleNode**: Port rendering now uses `applyPortOrder` and iterates the full port list, matching the behavior already present in WorkflowNode and GatewayNode.
- **SquareNode**: Port rendering aligned with SimpleNode — all ports are visible by default, `portOrder` and `hiddenPorts` are respected, and node height is derived dynamically from the visible port count.

### Internal

- Replaced `$derived(() => fn())` getter anti-pattern with `$derived(fn())` across WorkflowNode, SimpleNode, and SquareNode.
- Added unit tests for `getPortTop` and `isPortVisible` (34 tests passing).

## [1.2.2] - 2026-03-13

### Fixed

- **Drag freeze**: Dragging a node caused the browser to freeze when proximity connect was enabled. A reactive `SvelteMap` was being iterated inside a Svelte 5 `$effect`, then mutated in the same call — creating an infinite reactive loop. Both `updateNodePortCoordinates` and `removeNodePortCoordinates` in the port coordinate store now wrap the read with `untrack()` to break the dependency.

## [1.2.1] - 2026-03-13

### Fixed

- **Icon theming**: Canvas banner icon color now uses `muted-foreground` so it adapts correctly in both light and dark themes instead of rendering as a fixed dark color.
- **Sidebar empty state**: Replaced emoji characters in the "No node types available" message with inline SVGs, fixing rendering inconsistencies across platforms. Loading spinner now correctly clears when the node types fetch returns an empty result (was already fixed for failed fetches in 1.2.0, this patch covers the empty-response path too).

## [1.2.0] - 2026-03-13

### Changed

- **`theme` in mount API**: `mountFlowDropApp` now accepts a `theme` field in `FlowDropMountOptions`, exposing the theme system introduced in 1.1.0 through the JS embed API. Callers can pass a named theme (`'default'` | `'minimal'`) or a custom `FlowDropTheme` object without relying on persisted user settings.

### Fixed

- **Empty canvas banner on mobile**: The "Drag components here" banner was hidden behind the sidebar on screens ≤ 768 px (where the sidebar overlays the canvas). The banner now offsets left by the sidebar width so it centers within the visible canvas area.
- **Persistent loading spinner**: The sidebar spinner continued spinning indefinitely when the node types fetch failed or returned an empty result. It now clears once the request completes, showing the "No node types available" message instead.

## [1.1.0] - 2026-03-12

### Added

- **Theme system**: New `theme` prop on `<App>` accepts a built-in theme name (`'default'` | `'minimal'`) or a custom `FlowDropTheme` object. Themes bundle a visual skin (CSS tokens) with behavioral UI config defaults.
- **Skin system**: New `FlowDropSkin` type with `tokens` (light/base) and `darkTokens` (dark mode overrides), enabling full light/dark palette control per theme. Built-in skins: `'default'` and `'slate'`.
- **Built-in themes**: `'default'` (preserves original behavior) and `'minimal'` (dark slate palette with flat sidebar layout, matching the flowdrop.io demo).
- **CSS display tokens**: New `--fd-*` tokens to toggle UI variants without custom CSS — `sidebar-header-display`, `sidebar-search-display`, `sidebar-card-display`, `sidebar-flat-display`, `node-icon-display`, `node-circle-display`.
- **Flat sidebar layout**: Sidebar can now render nodes as a compact dot+name list (controlled via `--fd-sidebar-flat-display` / `--fd-sidebar-card-display` tokens).
- **`UISettings.theme` field**: Persisted user preference for the active theme (`'default'` | `'minimal'`). Existing settings without this field default to `'default'`.
- **`NodeSidebar.categoriesDefaultOpen` prop**: Controls whether category accordions start expanded in card mode.
- **New exported types**: `FlowDropTheme`, `FlowDropThemeName`, `FlowDropSkin`, `FlowDropSkinTokens`, `FlowDropSkinName`.

### Changed

- **Navbar action rendering**: `primaryActions` are now rendered exclusively through a split-button/dropdown. Previously the first action was rendered as a separate standalone button — consumers who relied on that distinct visual treatment will see a layout change.
- **Sidebar default layout**: The minimal/slate theme uses a flat list layout instead of the accordion card layout. The default theme is unchanged.

### Internal

- Removed JavaScript-based skin logic from `NodeSidebar` in favour of CSS token control.
- Theme resolution handles named base + inline token merging (e.g. `{ name: 'minimal', skin: { tokens: { primary: '#e11d48' } } }`).

## [1.0.1] - 2026-03-11

### Fixed

- **Edge rendering**: Shortened edge paths to terminate at the arrow base instead of the tip, preventing visual overshoot at connection points
- **Duplicate workflow saves**: Fixed a bug where backends using UUIDs as primary keys would always receive `POST` instead of `PUT` on save, causing duplicate workflows to be created on every save. The fix detects existing workflows by the presence of an `id` field rather than matching a UUID regex pattern ([#26](https://github.com/flowdrop-io/flowdrop/issues/26))

### Internal

- Added unit tests for `globalSaveWorkflow` covering both legacy and enhanced client paths
- Added E2E regression test for the UUID-based workflow save behavior

## [1.0.0] - 2026-03-11

First stable release of `@flowdrop/flowdrop`. This marks the library as production-ready after extensive development during the 0.0.x series under the `@d34dman/flowdrop` namespace. See [previous changelog](CHANGELOG-pre-1.0.0.md) entries for detailed history of features, fixes, and breaking changes.
