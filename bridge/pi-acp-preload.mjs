// Loaded into pi-acp with `node --import` by pi-acp-wrapper.mjs: its session-map writes
// become temp-file + rename (see pi-acp-store.mjs for why). pi-acp binds `writeFileSync`
// with an ESM named import of "fs", so the patched function is published to ESM importers.
import { syncBuiltinESMExports } from "node:module";
import { atomicMapWrites } from "./pi-acp-store.mjs";

atomicMapWrites();
syncBuiltinESMExports();
