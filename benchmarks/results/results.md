# Codexa Core benchmark results

Generated: 2026-09-04T06:13:58.116Z

Load: 50 connections, 10s duration, pipelining 1, 3s warmup (discarded) per endpoint per framework.

Machine: Intel(R) Core(TM) i7-7500U CPU @ 2.70GHz, 4 cores, Windows_NT 10.0.19045 (x64). Node 24.14.0, Deno 2.9.6 (stable, release, x86_64-pc-windows-msvc).

These numbers are from one developer machine, not a dedicated benchmark server. Treat them as directional, not authoritative, and reproduce with `npm run bench` before relying on them.

## POST /users

| Framework | req/s (avg) | latency avg (ms) | latency p99 (ms) |
| --- | --- | --- | --- |
| Codexa Core | 17208 | 2.54 | 13.00 |
| Deno (no framework) | 17798 | 2.35 | 12.00 |
| Oak (Deno) | 8464 | 5.37 | 34.00 |
| Express (Node) | 6598 | 7.08 | 41.00 |
| Hono (Deno) | 15062 | 2.79 | 17.00 |
| Thunder (Deno) | 17385 | 2.32 | 11.00 |

## GET /hello

| Framework | req/s (avg) | latency avg (ms) | latency p99 (ms) |
| --- | --- | --- | --- |
| Codexa Core | 12256 | 3.58 | 32.00 |
| Deno (no framework) | 23390 | 1.67 | 7.00 |
| Oak (Deno) | 5705 | 8.32 | 61.00 |
| Express (Node) | 10390 | 4.34 | 15.00 |
| Hono (Deno) | 13348 | 3.27 | 31.00 |
| Thunder (Deno) | 21512 | 1.83 | 8.00 |

## GET /users/:id

| Framework | req/s (avg) | latency avg (ms) | latency p99 (ms) |
| --- | --- | --- | --- |
| Codexa Core | 9415 | 4.81 | 36.00 |
| Deno (no framework) | 24366 | 1.59 | 6.00 |
| Oak (Deno) | 10125 | 4.48 | 20.00 |
| Express (Node) | 6830 | 6.76 | 45.00 |
| Hono (Deno) | 20389 | 1.96 | 12.00 |
| Thunder (Deno) | 18676 | 2.18 | 12.00 |
