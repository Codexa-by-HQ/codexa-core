/**
 * Test 3: Store — Key-Value Store
 *
 * Demonstrates:
 * - Memory store initialization
 * - CRUD operations (set/get/del/exists)
 * - TTL expiry
 * - Counter operations (incr/decr/incrby/decrby)
 * - Pattern-based key lookup
 */

import { closeStore, initializeStore, store } from "@codexa/core/store";
import { createLogger } from "@codexa/core/logger";

const log = createLogger("StoreTest");

async function main() {
  log.info("═══ Test: Key-Value Store ═══");

  // ── Initialize memory store ──────────────────────────────────────────────
  await initializeStore({ mode: "memory" });

  // ── CRUD ─────────────────────────────────────────────────────────────────
  log.info("\n── CRUD Operations ──");

  // Set
  await store.set("user:1", { id: "1", name: "Alice", role: "admin" });
  await store.set("user:2", { id: "2", name: "Bob", role: "user" });
  await store.set("user:3", { id: "3", name: "Charlie", role: "user" });

  // Get (typed)
  const alice = await store.get<{ id: string; name: string; role: string }>(
    "user:1",
  );
  log.info(`Get user:1 → ${JSON.stringify(alice)}`);

  // Exists
  const exists = await store.exists("user:1");
  log.info(`Exists user:1 → ${exists}`); // 1

  const notExists = await store.exists("user:999");
  log.info(`Exists user:999 → ${notExists}`); // 0

  // Del
  await store.del("user:3");
  const gone = await store.get("user:3");
  log.info(`After del user:3 → ${gone}`); // null

  // ── TTL ──────────────────────────────────────────────────────────────────
  log.info("\n── TTL Expiry ──");

  await store.set("session:temp", { token: "abc123" }, { ttl: 1 });
  const before = await store.get("session:temp");
  log.info(`Before expiry → ${JSON.stringify(before)}`);

  log.info("Waiting 1.2s for TTL expiry…");
  await new Promise((r) => setTimeout(r, 1200));

  const after = await store.get("session:temp");
  log.info(`After expiry → ${after}`); // null

  // ── Counters ─────────────────────────────────────────────────────────────
  log.info("\n── Counters ──");

  await store.set("views", 0);
  await store.incr("views");
  await store.incr("views");
  await store.incr("views");
  log.info(`After 3x incr → ${await store.get("views")}`); // 3

  await store.decr("views");
  log.info(`After decr → ${await store.get("views")}`); // 2

  await store.incrby("views", 100);
  log.info(`After incrby(100) → ${await store.get("views")}`); // 102

  await store.decrby("views", 50);
  log.info(`After decrby(50) → ${await store.get("views")}`); // 52

  // ── Keys pattern matching ────────────────────────────────────────────────
  log.info("\n── Keys Pattern ──");

  const userKeys = await store.keys("user:*");
  log.info(`Keys matching 'user:*' → ${JSON.stringify(userKeys)}`);

  const allKeys = await store.keys("*");
  log.info(`All keys → ${JSON.stringify(allKeys)}`);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  closeStore();
  log.info("\n✅ Store test passed!");
}

main().catch((e) => {
  console.error("❌ Store test failed:", e);
  Deno.exit(1);
});
