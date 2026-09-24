# Protocol Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the simulator's serialized messages, Python forwarding, TypeScript types, frontend consumption, tests, and protocol documentation.

**Architecture:** Keep the WebSocket envelope (`type`, `cycle`, `state`) distinct from the CPU state payload. Treat C++ serialization as the source of cycle-state field values, Python as a transparent transport/command adapter, TypeScript as the consumer contract, and the Markdown protocol as the canonical human-readable contract.

**Tech Stack:** C++17, Python 3 asyncio/websockets/aiohttp, Vue 3, TypeScript, Markdown

**Spec:** `docs/PROTOCOL.md`

## Global Constraints

- Preserve existing command names and transport addresses.
- Do not add duplicate `cycle` data inside `state`; consume the envelope value in the frontend.
- Serialize `branch.taken` as a JSON boolean.
- Keep the public WebSocket/HTTP contract concise in `PROTOCOL.md`; move exhaustive schemas and internal C++ protocol details to `INTERFACE_REFERENCE.md`.
- Verify with backend protocol tests and a production frontend build.

---

### Task 1: Align serialization and frontend types

**Files:**
- Modify: `backend/cpp/src/rv_core.cpp`
- Modify: `backend/python/cpp_bridge.py`
- Modify: `backend/python/ws_handler.py`
- Modify: `frontend/src/types/simulation.ts`
- Modify: `frontend/src/stores/simulator.ts`
- Modify: `frontend/src/components/panels/WaveformPanel.vue`

**Interfaces:**
- Consumes: C++ `cycle_state_to_json` output.
- Produces: `CycleStateMessage` envelope and `CycleSnapshot` frontend history item.

- [x] Serialize `branch.taken` as a JSON boolean.
- [x] Separate `CycleState` from the outer message cycle number in TypeScript.
- [x] Build a `CycleSnapshot` from `msg.cycle` and `msg.state` before storing it.
- [x] Update waveform history typing.
- [x] Prevent duplicate final-cycle forwarding and normalize `load_elf` failures.

### Task 2: Strengthen protocol regression tests

**Files:**
- Modify: `backend/test/test_sim.py`
- Modify: `backend/test/test_server.py`

**Interfaces:**
- Consumes: C++ JSON and public WebSocket messages.
- Produces: assertions for envelope fields, nested field groups, boolean types, and event payloads.

- [x] Assert the complete top-level `cycle_state` envelope.
- [x] Assert `csr`, `trap`, nested structures, register count, and `branch.taken` type.
- [x] Assert WebSocket `ready`, `loaded`, `cycle_state`, `memory_dump`, and halt payload fields.

### Task 3: Restructure protocol documentation

**Files:**
- Modify: `docs/PROTOCOL.md`
- Create: `docs/INTERFACE_REFERENCE.md`

**Interfaces:**
- Consumes: verified source and test behavior.
- Produces: concise public protocol plus expanded field-level/internal reference.

- [x] Rewrite `PROTOCOL.md` as the canonical quick contract.
- [x] Document current frontend execution path separately from supported backend commands.
- [x] Add exhaustive message schemas, C++ stdin/stdout mapping, frontend consumption matrix, invariants, and sync checklist to `INTERFACE_REFERENCE.md`.
- [x] Record optional/conditional fields accurately.

### Task 4: Verify

**Files:**
- Test: `backend/test/test_rv32.py`
- Test: `backend/test/test_sim.py`
- Test: `backend/test/test_server.py`
- Test: `frontend/package.json`

**Interfaces:**
- Consumes: all synchronized changes.
- Produces: passing backend suites and frontend type/build verification.

- [x] Rebuild the C++ simulator.
- [x] Run all three backend test suites.
- [x] Run the frontend production build.
- [x] Scan docs and source for stale protocol field names.
