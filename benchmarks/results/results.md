# Codexa Core benchmark results

Generated: 2026-09-07T05:27:20.884Z

Load: 50 connections, 10s duration, pipelining 1, 3s warmup (discarded) per endpoint per framework. Each number below is the **median of 3 independent full runs**, not a single sample.

Machine: Intel(R) Core(TM) i7-7500U CPU @ 2.70GHz, 4 cores, Windows_NT 10.0.19045 (x64). Deno 2.9.6 (stable, release, x86_64-pc-windows-msvc).

These numbers are from one developer machine, not a dedicated benchmark server. Treat them as directional, not authoritative, and reproduce with the harness described in the docs before relying on them.

## GET /hello

| Framework | req/s (median of 3) | latency avg (ms) | latency p99 (ms) |
| --- | --- | --- | --- |
| Codexa Core | 25134 | 1.49 | 8.00 |
| Deno (no framework) | 29213 | 1.26 | 4.00 |
| Oak (Deno) | 20972 | 2.01 | 5.00 |
| Express (Node) | 13297 | 3.34 | 6.00 |
| Hono (Deno) | 28282 | 1.32 | 4.00 |
| Thunder (Deno) | 25490 | 1.47 | 3.00 |

## GET /users/:id

| Framework | req/s (median of 3) | latency avg (ms) | latency p99 (ms) |
| --- | --- | --- | --- |
| Codexa Core | 23832 | 1.52 | 9.00 |
| Deno (no framework) | 28461 | 1.29 | 4.00 |
| Oak (Deno) | 19963 | 2.12 | 5.00 |
| Express (Node) | 12027 | 3.62 | 7.00 |
| Hono (Deno) | 24528 | 1.56 | 5.00 |
| Thunder (Deno) | 25350 | 1.48 | 4.00 |

## POST /users

| Framework | req/s (median of 3) | latency avg (ms) | latency p99 (ms) |
| --- | --- | --- | --- |
| Codexa Core | 17063 | 2.52 | 12.00 |
| Deno (no framework) | 26920 | 1.41 | 4.00 |
| Oak (Deno) | 14575 | 2.83 | 6.00 |
| Express (Node) | 9093 | 4.98 | 9.00 |
| Hono (Deno) | 23912 | 1.52 | 5.00 |
| Thunder (Deno) | 22283 | 1.64 | 4.00 |
