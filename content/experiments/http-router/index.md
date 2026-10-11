---
title: "HTTP Router from First Principles"
description: "Benchmarking Linear Scan vs. Segment Trie vs. Radix Tree under CPU and RAM constraints."
status: completed
startDate: 2026-10-11
updatedDate: 2026-10-11
github: "https://github.com/bhavansh/experiments/tree/main/http-router"
remoteUrl: "https://raw.githubusercontent.com/bhavansh/experiments/refs/heads/main/http-router/README.md"
tech:
  - Java 21
  - Data Structures
  - Trie
  - Radix Tree
  - Benchmarking
featured: true
draft: false
---

# HTTP Router from First Principles: Linear Scan vs. Trie vs. Radix Tree

> A hands-on exploration of how HTTP routers work under the hood, why naive routing breaks at scale, and how **Prefix Trees (Tries)** and **Compressed Trees (Radix Trees)** eliminate algorithmic bottlenecks.

---

## 1. The Core Problem: Why Routers Are Hard

An HTTP router maps an incoming request (e.g. `GET /api/v1/users/42/items/5`) to a handler function.

Why not just use a `HashMap<String, Handler>` for $O(1)$ instant lookups?
- A `HashMap` only works for **exact static strings** (like `/api/books`).
- Modern APIs use **patterns** with dynamic parameters (like `/api/v1/users/:userId/items/:itemId`).
- When a request for `/api/v1/users/42/items/5` arrives, the literal string is not in the map—the map contains the template `.../:userId/...`.

To support dynamic parameters, routers must perform pattern matching. The choice of data structure determines whether your router handles 10,000 routes with ease or collapses under load.

---

## 2. The Three Architectures

```
                    ┌───────────────────────────┐
                    │   interface HttpRouter    │
                    └─────────────┬─────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ LinearScanRouter │    │    TrieRouter    │    │ RadixTreeRouter  │
│  (Brute Force)   │    │  (Segment Trie)  │    │ (Compressed Tree)│
│       O(N)       │    │       O(L)       │    │       O(L)       │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

### Architecture 1: Linear Scan (`LinearScanRouter`) — `O(N)`
Stores all registered routes in a list or insertion-order map (`LinkedHashMap`).

```text
Incoming: GET /api/v1/users/usr_1005/items/5

Check Route 1:    /api/v1/services/svc0/health          -> Compare & Fail
Check Route 2:    /api/v1/services/svc1/health          -> Compare & Fail
...
Check Route 1000: /api/v1/users/:userId/items/:itemId   -> Match! (Checked 1,000 routes)
```

- **Best Case (Route #1)**: Matches on iteration 1 $\to$ Fast.
- **Worst Case (Route #N)**: Must evaluate regex and string splitting on all $N$ patterns.
- **The Hidden Trap (GC Churn)**: On every single check, `pattern.split("/")` and `path.split("/")` allocate temporary `String[]` arrays and regex matchers. With 1,000 routes, a single HTTP request creates thousands of short-lived objects, thrashing the JVM Garbage Collector.

---

### Architecture 2: Segment Trie (`TrieRouter`) — `O(L)`
URLs are naturally hierarchical (`/` delimited). A **Trie (Prefix Tree)** decomposes the URL into path segments, where every node represents **one segment**:

```text
[root]
   └── "api"
         └── "v1"
               ├── "services"
               │     └── "svc0"
               │           └── "health" (GET Handler)
               └── "users"
                     └── [:userId]
                           └── "items"
                                 └── [:itemId] (GET Handler)
```

- **Cost**: $O(L)$, where $L$ is the number of path segments (usually 3–5). It is completely independent of the total number of routes $N$!
- **Backtracking**: When a static branch matches an intermediate segment (e.g. `/users/me`) but dies at a deeper segment (e.g. `/users/me/items/5`), the search rewinds and falls back to the parameter branch (`:userId`).
- **HTTP 405 for free**: If search reaches a valid leaf node but the HTTP method doesn't match, it returns `405 Method Not Allowed` instead of `404 Not Found`.

---

### Architecture 3: Radix Tree (`RadixTreeRouter`) — `O(L)` Compressed
In a Segment Trie, unbranched chains like `root -> "api" -> "v1" -> "services"` require multiple nodes, multiple `HashMap` lookups, and memory pointer hops.

A **Radix Tree** (used in production engines like Go's `httprouter`, Gin, and Echo) **compresses single-child chains into a single edge**:

```text
Segment Trie (4 nodes, 4 pointer hops):
[root] ──► ["api"] ──► ["v1"] ──► ["services"]

Radix Tree (1 node, 1 pointer hop):
[root] ──────────────("api/v1/services")──────────────► [Node]
```

- **Edge Splitting**: When inserting a route that partially shares an edge (e.g. inserting `/api/v1/users` when `/api/v1/services` already exists), the tree finds the Longest Common Prefix (`/api/v1/`) and splits the node in two.
- **Zero `split("/")` Allocations**: During dispatch, requests are matched using direct string slicing (`path.startsWith(...)` and `substring`), eliminating `String[]` array allocations entirely during routing.

---

## 3. Empirical Benchmark Results

We benchmarked all three routers under strict JVM container limits simulating a cloud environment:
- **1 CPU Core** (`-XX:ActiveProcessorCount=1`)
- **64MB RAM** (`-Xms64m -Xmx64m -XX:+AlwaysPreTouch`)
- **1,000 registered routes** (50% static, 30% single-param, 20% multi-param)
- **10 concurrent client threads** over real HTTP for 10 seconds per mode

### Master Throughput Comparison Table

| Router | Best Case (Route #1) | Worst Case (Route #1000) | 404 (Unmatched) | Random Traffic (Average) |
| :--- | :--- | :--- | :--- | :--- |
| **LINEAR** | 4,192.97 req/s | **650.54 req/s** *(85% drop!)* | 686.99 req/s | 1,361.82 req/s |
| **TRIE** | 4,156.94 req/s | **4,323.80 req/s** | 3,892.90 req/s | 4,166.26 req/s |
| **RADIX** | **4,346.57 req/s** | **4,294.34 req/s** | **4,054.26 req/s** | **4,302.22 req/s** |

### What the Data Proves
1. **The Linear Scan Cliff**: In `LinearScanRouter`, throughput collapsed from **4,192 req/s** down to **650 req/s** on Route #1,000 because each request evaluated all 1,000 route patterns.
2. **The Trie Flatline**: In `TrieRouter` and `RadixTreeRouter`, Route #1,000 performed at **~4,300 req/s**—virtually identical to Route #1! Path depth ($L$), not route count ($N$), dictates latency.
3. **Radix Efficiency**: `RadixTreeRouter` delivered the highest overall throughput across all traffic modes due to edge compression and zero-allocation path walking.

---

### Profiling Insights (Java Flight Recorder)

Using built-in JDK Flight Recorder (JFR), we profiled where the CPU spent time:

- **In Linear Scan (`linear/hot_methods.txt`)**:
  - `java.util.regex.Pattern`: **38% CPU**
  - `java.lang.String.split`: **29% CPU**
  - **Over 70% of CPU time was completely wasted** on string splitting and regex matching.
  - Memory allocations were dominated by temporary `byte[]`, `String`, and `Matcher` objects, driving constant GC pauses.
- **In Radix Tree (`radix/hot_methods.txt`)**:
  - `Pattern` and `String.split` dropped to **0%**.
  - CPU was spent almost entirely on actual HTTP socket I/O and header writing.

---

## 4. Running the Project & Benchmarks

### 1. Compile the Sources
```bash
cd http-router
javac -d out src/router/*.java
```

### 2. Run an Individual Server
You can start any of the three servers on `http://localhost:8080`:

```bash
# Run Linear Router Server
java -cp out router.LinearServer

# Run Trie Router Server
java -cp out router.TrieServer

# Run Radix Tree Router Server
java -cp out router.RadixServer
```

*(You can customize port and route count: `java -cp out router.Server --router=radix --port=9090 --routes=2000`)*

### 3. Test with `curl`
```bash
# Static route:
curl http://localhost:8080/api/v1/services/svc0/health

# Parameterized route (:userId):
curl http://localhost:8080/api/v1/users/usr_1005/items/5

# Wildcard route (*):
curl http://localhost:8080/static/images/avatar.png

# HTTP 405 Method Not Allowed:
curl -i -X POST http://localhost:8080/api/v1/users/me
```

---

## 5. Automated Benchmark Suite

We provide an automated benchmark runner that manages compilation, JVM resource constraints, server lifecycle, load testing, JFR profiling, and report generation:

```bash
# Benchmark a single router:
./benchmark/run_benchmark.sh linear
./benchmark/run_benchmark.sh trie
./benchmark/run_benchmark.sh radix

# Run all three routers sequentially and print the master comparison table:
./benchmark/run_benchmark.sh all

# View the summary comparison table from existing results:
./benchmark/run_benchmark.sh summary
```

### Result Artifacts
Every run writes to its own isolated folder under `benchmark/results/<router_name>/`:
- `results.txt`: Full throughput, request counts, and latency percentiles (min, p50, p90, p95, p99, max).
- `profile.jfr`: Binary flight recorder dump (open in IntelliJ IDEA $\to$ Profiler to view interactive Flamegraphs).
- `hot_methods.txt`: Table of top CPU-consuming methods.
- `allocations.txt`: Table of heap memory allocations by class.
- `server.log`: Standard output and error logs from the server run.

---

## 6. Project Structure

```text
http-router/
├── src/router/
│   ├── HttpRouter.java        # Common interface contract
│   ├── Handler.java           # Functional interface: Response handle(Request req)
│   ├── Request.java           # Request record (method, path, params, query)
│   ├── Response.java          # Response record (status, body)
│   ├── RouteGenerator.java    # Generates 1,000 realistic API routes
│   │
│   ├── LinearScanRouter.java  # O(N) linear brute-force router
│   ├── LinearServer.java      # Server launcher for LinearScanRouter
│   │
│   ├── TrieNode.java          # Segment trie node
│   ├── TrieRouter.java        # O(L) segment prefix tree router with backtracking
│   ├── TrieServer.java        # Server launcher for TrieRouter
│   │
│   ├── RadixNode.java         # Edge-compressed radix node
│   ├── RadixTreeRouter.java   # O(L) compressed prefix tree with edge splitting
│   ├── RadixServer.java       # Server launcher for RadixTreeRouter
│   │
│   └── Server.java            # Shared virtual-thread HTTP server engine
│
├── benchmark/
│   ├── load_test.py           # High-concurrency benchmark client (Python stdlib)
│   ├── run_benchmark.sh       # Automated benchmark & JFR profiling runner
│   └── results/               # Benchmark outputs & flamegraph dumps
│       ├── linear/
│       ├── trie/
│       └── radix/
│
└── README.md                  # This guide
```
