# Codexa Core HTTP benchmark results

Generated: 2026-10-20T13:26:40.159Z

Artifact: Local generated Codexa Core with npm:jetrouter@0.2.0

Core source SHA-256: d7296dc4f353309e5b980780c3bc84936be6aa541a67b564501b1ac585592170

Load: 50 connections, pipelining 1, 3s discarded warmup and 10s measured per workload; 3 rounds with fresh processes and rotated framework/workload order.

Host: Intel(R) Core(TM) i7-7500U CPU @ 2.70GHz; 4 logical CPUs; Windows_NT 10.0.19045 (x64); 24.21.0; deno 2.9.7 (stable, release, x86_64-pc-windows-msvc).

Validation: 108 timed samples, 22,252,810 checked responses, 1,917 preflight checks. Every body, status and counter audit passed. 68 samples crossed the client CPU warning threshold.

All frameworks use the same Zod version and schema, route definitions, input bodies and deterministic output. NestJS uses its normal controller pipeline and Express adapter. Thunder uses its unmodified file-discovery and hook dispatcher; optional database bootstrap is excluded. Fastify uses the common Zod validation without an additional response schema.

## GET /hello

| HTTP stack | Median req/s | Min–max | CV | Median average latency ms | Median p99 ms | Client CPU % | Warning runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codexa Core + JetRouter / Deno | 22,469 | 11,795–22,677 | 26.8% | 1.67 | 9.00 | 92.3 | 2/3 |
| Express / Node | 16,396 | 8,693–18,131 | 28.5% | 2.48 | 6.00 | 83.3 | 1/3 |
| Oak / Deno | 14,263 | 11,596–16,506 | 14.2% | 2.94 | 10.00 | 74.5 | 0/3 |
| Fastify / Node | 22,975 | 21,823–25,313 | 6.2% | 1.54 | 4.00 | 97.5 | 3/3 |
| Hono / Deno | 30,064 | 26,393–30,255 | 6.1% | 1.16 | 3.00 | 99.7 | 3/3 |
| NestJS (Express adapter) / Node | 16,580 | 14,218–17,489 | 8.6% | 2.42 | 4.00 | 86.2 | 2/3 |
| Thunder / Deno | 27,891 | 23,564–28,230 | 8.0% | 1.27 | 3.00 | 98.9 | 3/3 |
| Raw Deno.serve (manual routes) | 27,682 | 27,351–30,207 | 4.5% | 1.25 | 4.00 | 97.2 | 3/3 |
| Identical raw Deno control | 28,258 | 26,242–29,311 | 4.6% | 1.25 | 5.00 | 97.5 | 3/3 |

## GET /users/:id

| HTTP stack | Median req/s | Min–max | CV | Median average latency ms | Median p99 ms | Client CPU % | Warning runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codexa Core + JetRouter / Deno | 24,224 | 23,222–24,472 | 2.3% | 1.56 | 9.00 | 92.7 | 3/3 |
| Express / Node | 15,649 | 12,778–16,052 | 9.8% | 2.62 | 7.00 | 82.6 | 0/3 |
| Oak / Deno | 14,820 | 11,264–17,502 | 17.6% | 2.80 | 8.00 | 79.0 | 0/3 |
| Fastify / Node | 23,436 | 20,918–25,080 | 7.4% | 1.48 | 4.00 | 96.4 | 3/3 |
| Hono / Deno | 25,660 | 23,506–29,863 | 10.0% | 1.38 | 4.00 | 97.5 | 3/3 |
| NestJS (Express adapter) / Node | 15,250 | 14,507–16,573 | 5.5% | 2.74 | 9.00 | 82.5 | 1/3 |
| Thunder / Deno | 24,920 | 17,381–26,574 | 17.4% | 1.45 | 4.00 | 97.3 | 3/3 |
| Raw Deno.serve (manual routes) | 27,750 | 26,418–31,153 | 7.0% | 1.27 | 5.00 | 97.4 | 3/3 |
| Identical raw Deno control | 27,572 | 22,908–28,073 | 8.9% | 1.27 | 4.00 | 96.6 | 3/3 |

## GET varied deep routes (1,000 registrations)

| HTTP stack | Median req/s | Min–max | CV | Median average latency ms | Median p99 ms | Client CPU % | Warning runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codexa Core + JetRouter / Deno | 17,622 | 14,784–23,746 | 20.0% | 2.25 | 14.00 | 81.7 | 1/3 |
| Express / Node | 4,979 | 1,098–5,571 | 51.1% | 9.50 | 26.00 | 38.1 | 0/3 |
| Oak / Deno | 4,616 | 4,568–5,625 | 9.9% | 10.26 | 26.00 | 37.7 | 0/3 |
| Fastify / Node | 24,632 | 17,479–24,666 | 15.2% | 1.35 | 3.00 | 98.1 | 3/3 |
| Hono / Deno | 26,670 | 22,342–27,149 | 8.5% | 1.36 | 4.00 | 99.3 | 3/3 |
| NestJS (Express adapter) / Node | 5,305 | 4,361–5,768 | 11.4% | 8.89 | 22.00 | 37.9 | 0/3 |
| Thunder / Deno | 19,136 | 17,445–20,280 | 6.1% | 2.16 | 5.00 | 83.5 | 0/3 |
| Raw Deno.serve (manual routes) | 29,472 | 25,476–29,865 | 7.0% | 1.18 | 3.00 | 98.5 | 3/3 |
| Identical raw Deno control | 28,328 | 26,701–29,949 | 4.7% | 1.22 | 4.00 | 98.9 | 3/3 |

## POST JSON /users

| HTTP stack | Median req/s | Min–max | CV | Median average latency ms | Median p99 ms | Client CPU % | Warning runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codexa Core + JetRouter / Deno | 20,582 | 12,303–21,683 | 23.0% | 1.80 | 10.00 | 86.2 | 2/3 |
| Express / Node | 10,835 | 5,026–12,680 | 34.3% | 4.07 | 12.00 | 69.3 | 0/3 |
| Oak / Deno | 12,812 | 8,110–13,919 | 21.7% | 3.46 | 8.00 | 73.4 | 0/3 |
| Fastify / Node | 16,836 | 15,438–19,001 | 8.6% | 2.45 | 8.00 | 85.9 | 2/3 |
| Hono / Deno | 25,704 | 22,289–26,053 | 6.9% | 1.46 | 4.00 | 97.2 | 3/3 |
| NestJS (Express adapter) / Node | 11,666 | 10,512–11,695 | 4.9% | 3.71 | 8.00 | 69.7 | 0/3 |
| Thunder / Deno | 25,683 | 24,242–26,240 | 3.3% | 1.35 | 4.00 | 93.1 | 3/3 |
| Raw Deno.serve (manual routes) | 24,256 | 22,069–24,921 | 5.1% | 1.49 | 4.00 | 97.5 | 3/3 |
| Identical raw Deno control | 24,643 | 22,642–25,623 | 5.1% | 1.45 | 4.00 | 97.7 | 3/3 |

## Identical raw Deno control

| Workload | Control / baseline | Drift | Over 10% |
| --- | ---: | ---: | --- |
| hello | 1.021 | 2.1% | no |
| user | 0.994 | 0.6% | no |
| deep | 0.961 | 3.9% | no |
| post | 1.016 | 1.6% | no |

## Limits

- Client and server share one developer machine; rates describe the measured HTTP stacks, including their runtimes.
- An identical raw Deno control measures run-order and machine variation. Differences smaller than that drift are inconclusive.
- Client CPU over 85% of one core is flagged as potentially load-generator-limited.
- Per-run p99 values are summarized by their median; this is not a pooled latency percentile.
- Codexa is a local generated build using JetRouter, not a published JSR release. Historical results use a different release and environment.
- This is a 1,004-route workload without databases, authentication or network services. It does not establish production capacity or a universal framework ranking.

## Reproduction

```sh
cd benchmarks/http
npm ci --ignore-scripts
npm run prepare
npm run validate
node run.mjs --rounds=3 --warmup=3 --duration=10 --connections=50
node report.mjs results/http-YYYY-MM-DDTHH-MM-SS-SSSZ
```

The run directory retains every raw sample, per-path and per-second counters, latency data, server logs, request manifest and source hashes. See sources.json and package-lock.json for pinned sources and dependencies.
