# Codexa Core benchmark results

Generated: 2026-09-03T20:13:32.268Z

Load: 50 connections, 10s duration, pipelining 1, 3s warmup (discarded) per endpoint per framework.

Machine: Intel(R) Core(TM) i7-7500U CPU @ 2.70GHz, 4 cores, Windows_NT 10.0.19045 (x64). Node 24.14.0, Deno 2.9.6 (stable, release, x86_64-pc-windows-msvc).

These numbers are from one developer machine, not a dedicated benchmark server. Treat them as directional, not authoritative, and reproduce with `npm run bench` before relying on them.

## POST /users

| Framework | req/s (avg) | latency avg (ms) | latency p99 (ms) |
| --- | --- | --- | --- |
| Codexa Core | 19938 | 2.10 | 10.00 |
| Deno (no framework) | 19056 | 2.14 | 14.00 |
| Oak (Deno) | 15945 | 2.52 | 8.00 |
| Express (Node) | 8660 | 5.28 | 13.00 |
| Hono (Deno) | 22857 | 1.61 | 6.00 |

## GET /hello

| Framework | req/s (avg) | latency avg (ms) | latency p99 (ms) |
| --- | --- | --- | --- |
| Codexa Core | 18732 | 2.19 | 16.00 |
| Deno (no framework) | 23982 | 1.59 | 7.00 |
| Oak (Deno) | 17042 | 2.54 | 14.00 |
| Express (Node) | 9379 | 4.86 | 21.00 |
| Hono (Deno) | 23600 | 1.61 | 6.00 |

## GET /users/:id

| Framework | req/s (avg) | latency avg (ms) | latency p99 (ms) |
| --- | --- | --- | --- |
| Codexa Core | 14758 | 2.88 | 22.00 |
| Deno (no framework) | 26107 | 1.41 | 4.00 |
| Oak (Deno) | 16635 | 2.65 | 14.00 |
| Express (Node) | 9735 | 4.65 | 17.00 |
| Hono (Deno) | 24021 | 1.55 | 5.00 |
