---
title: "Decomposing a Legacy EJB Monolith"
description: "Why having microservices was better in this case and what problems we avoided for the future"
pubDatetime: 2026-07-05T14:30:00.000Z
draft: false
tags: ["ejb", "spring-boot", "microservices", "legacy"]
---

# Decomposing a Legacy EJB Monolith" (a system design deep-dive)

> 📝 **Note:** This post was edited with AI assistance for clarity and structure. The system design, implementation decisions, and technical thinking are entirely my own.

## TL;DR

*   Decomposed a legacy Java EJB monolith — the authoritative path for institutional client withdrawals, deposits, and transfers — into **four independently deployable services**: a Spring Boot REST API, a Spring Batch processor, a scoped-down commons library, and a CLI monitoring app.
    
*   Eliminated **EJB connection-pool exhaustion** entirely — previously triggered under batch load via a shared RMI-based EJB client — by moving batch processing off that client and onto REST calls to a modernized external signing service.
    
*   Replaced single-threaded, per-client **modulus-sharded** batch steps with multithreaded, chunk-based Spring Batch processing — ~70% throughput improvement.
    
*   Built a custom **state-reconciliation ("auto-recovery") engine** to resolve transactions left in ambiguous states after crashes or outages — because Spring Batch's own restart semantics can't be trusted when the source of truth for "did it happen" lives in an external system.
    
*   Ran a **dual API surface** (legacy XML-in-JSON alongside new pure JSON) simultaneously, migrated client-by-client and transaction-type-by-transaction-type, with feature-flag-based rollback at the routing layer.
    
*   Result: 4× release cadence, ~20% of prior rollback rate, zero pool-exhaustion incidents, ~1 hour of dev triage saved per outage.
    

* * *

## Introduction

Institutional clients can move money in and out and much more using multiple transactions — withdrawals, deposits, wires, ACH, DWAC, position transfers (FOP), etc. For years, the logic that actually authorized and signed these transfers lived inside an **EJB application owned by a separate team**. The REST/API-facing servlet application embedded that EJB's main jar directly and called its functions in-process; batch processing, by contrast, went through a separate EJB client artifact invoked over RMI — and it's this RMI-based path, used exclusively by batch, that became the source of the pool-exhaustion problems described below. Direct embedding was a reasonable choice when the integration was small. It stopped being reasonable once it quietly became the authoritative path for money movement for 100+ institutional clients processing 100,000+ requests a day — at which point the hard requirement became:

> The system authorizing money movement must be independently deployable, independently scalable, observable by the team that owns it, and resilient to partial failure in systems it doesn't control.

The legacy EJB integration met none of these.

* * *

## The Problem We Actually Had

Before REST ever entered the picture, the system went through two earlier eras worth understanding, because each one explains a layer of debt that had to be unwound later:

1.  **FTP + raw XML.** Clients dropped signed XML files onto an FTP server; scheduled batch jobs picked them up and processed them.
    
2.  **HTTP, XML retained.** The system moved to HTTP, but the XML message structure was too deeply embedded to remove — so clients sent a **base64-encoded, signed XML string wrapped inside a JSON payload.** JSON on the outside, XML doing all the real work on the inside.
    

By the time the EJB dependency became untenable, this was the operating scale:

| Dimension | Value |
| --- | --- |
| Institutional clients | 100+ |
| Transaction types | 30+ (ACH, WIRE, DWAC, FOP, deposits, withdrawals, etc.) |
| Daily requests | 100,000+ |
| EJB connection pool (per server, 2 servers) | 200+ slots, periodically exhausted |
| Wider EJB consumer footprint | Dozens of other frontend deployments and hundreds of scheduled jobs company-wide depended on the same EJB, well beyond this system alone |

* * *

## Why the Legacy EJB Architecture Failed

| Failure Mode | Symptom | Root Cause |
| --- | --- | --- |
| **EJB session-pool exhaustion** | Batch steps failing outright during heavy trading load, high request volume, or new-client onboarding | Long-running, single-threaded batch steps held pool connections for their entire duration, starving other work — the pool has no concept of fairness |
| **Zero visibility** | Cross-team, high-latency debugging for any production incident | Signing logic ran on access-restricted servers the team had no access to |
| **Architectural drift** | Deployment discipline ("never touch old code, only add") kept blast radius contained, but at a rising maintenance cost | A small, well-scoped integration organically became a critical dependency without ever being re-architected for that criticality |

### Key Elimination: Why Not Just Decouple Without Fully Splitting?

Before committing to a four-service decomposition, the alternatives were weighed honestly:

| Approach | Ends Ownership Problem | Fixes Pool Exhaustion | Independent Scaling | Independent Deploys |
| --- | --- | --- | --- | --- |
| Tune/enlarge the existing EJB pool | ❌ | Partial, temporary | ❌ | ❌ |
| Move to a different app server | ❌ | Partial | ❌ | ❌ |
| Replace EJB with one new monolith | ✅ | ✅ | ❌ | ❌ |
| Decompose into purpose-built services | ✅ | ✅ | ✅ | ✅ |

A single replacement monolith would have solved the ownership and pool problems but reproduced the same coupling risk in a different shape — one deployable unit for a monitoring change, a batch change, and a client-facing API change would all still ship and fail together. That's what pushed the design to four separately deployable components rather than one.

* * *

## System Architecture: Two Mechanisms, Two Concerns

Much like separating in-transit integrity from at-rest integrity in a signed-payments system, this redesign relies on **two distinct mechanisms solving two different problems** — and conflating them was exactly the old system's mistake.

### 1\. The Processing Pipeline (Moving Transactions Forward)

A lightweight **database polling table** acts as the queue between "signed" and "processed." It's deliberately thin:

```plaintext
{
  id,
  transactionStatus,
  transactionType,
  signature,
  ...metadata
}
```

The actual payload — account, amount, and other type-specific fields — lives in **separate per-transaction-type tables**, kept out of the polled table entirely. This isn't a placeholder for "we'll add Kafka later" — traffic volume didn't justify a broker, and proper indexing on a thin table was sufficient.

### 2\. The Auto-Recovery Engine (Resolving Ambiguous State)

This is the mechanism that answers a much harder question: *what happened to a transaction that crashed mid-flight, when the true answer lives in a system we don't control?* It's covered in depth below — it does not overlap with the processing pipeline's job. The pipeline moves transactions forward under normal conditions; the recovery engine exists solely to resolve abnormal ones.

* * *

## Transaction Lifecycle

```plaintext
External Institutional Client
     │
     │  Submits transaction request (authenticated via separate OAuth service)
     ▼
  REST API (Spring Boot)
     │
     ├─► Validate request
     │
     ├─► Persist as "pending"
     │
     ▼
  Batch Processor (Spring Batch, polls "pending")
     │
     ├─► Call external Signing REST API (sign + validate)
     │
     ├─► Mark "in processing"
     │
     ├─► Write to DB polling table (queue)
     │
     ▼
  Processing Step
     │
     ├─► Route by transaction type to internal API
     │    (FOP → API A, cash transfer → API B, ...)
     │
     ├─ success → mark "completed"
     ├─ known failure → mark "failed"
     └─ crash / timeout / unknown outcome
            → picked up by Auto-Recovery Engine
```

* * *

## Why Mark State Before the Call, Not After

During recovery, the question is never "what request did we send" — it's "what actually happened downstream." Marking a transaction `in processing` **before** calling out (rather than only recording state on response) is what gives the recovery engine something to anchor on. If the process crashes after the call but before a result is recorded, `in processing` is the signal that says: *this one needs verification, not automatic replay.*

Before the recovery engine acts on any stuck transaction, it runs a short sequence of checks:

1.  Has our own table already been updated with a result?
    
2.  Does polling the downstream service confirm the transaction was actually recorded on their end?
    
3.  Do related, dependent tasks provide additional evidence of the outcome?
    

Only after this evidence is gathered does the engine decide the transaction's correct resolution — completed, needs-retry, or failed. **It never blindly re-sends.**

> Spring Batch's own restart-from-checkpoint guarantee assumes the side effects of a step are captured by its local transaction. That assumption breaks the moment the real side effect — money moving — happens inside an external system Spring Batch has no visibility into. You cannot outsource idempotency to a batch framework when the source of truth lives outside it.

* * *

## Retry Design: Avoiding Double Processing

A blind retry on top of a timed-out network call is one of the most dangerous states this system can be in — it risks re-sending money that already moved. The design deliberately does **not** delegate retries to a generic transport-layer resilience library. Instead:

1.  Once a transaction is recorded, the client immediately receives a `pending` response.
    
2.  **The client is responsible for polling** — not the server for pushing.
    
3.  Actual retries of downstream work are driven entirely by the **batch + auto-recovery state machine**, which has full context on what has and hasn't actually happened.
    

This keeps every retry decision state-aware rather than blind — a generic retry-on-timeout policy has no way to know the difference between "the call never reached the downstream system" and "the call succeeded, but the response was lost."

* * *

## Fixing the Batch Architecture

The old batch design sharded work **per client**, single-threaded, using a modulus-based shard filter:

```plaintext
step.filter = (transaction_id % N == shardIndex)
# e.g., Client A → 4 steps, shard indices 0,1,2,3
```

This caused **step explosion** — step count scaled with clients × shard count — and wasted steps: a low-volume client still needed its full set of steps running, each one scanning and finding little or no work.

The replacement uses Spring Batch's multithreaded, chunk-based processing with async calls to internal downstream APIs:

```java
@Bean
public Step processTransactionsStep(
        TaskExecutor taskExecutor,
        ItemReader<Transaction> reader,
        ItemProcessor<Transaction, RoutedTransaction> processor,
        ItemWriter<RoutedTransaction> writer) {

    return stepBuilderFactory.get("processTransactions")
        .<Transaction, RoutedTransaction>chunk(CHUNK_SIZE)
        .reader(reader)
        .processor(processor)
        .writer(writer)
        .taskExecutor(taskExecutor)
        .throttleLimit(THREAD_POOL_SIZE)
        .build();
}
```

Most clients were consolidated into shared, chunked processing. A small number of **high-volume, tight-SLA clients kept dedicated steps** — an explicit carve-out, not a uniform rule, to protect them from noisy-neighbor contention in the shared pool.

* * *

## Multi-Transaction-Type Routing

Different transaction types (FOP, cash transfer, wire, ACH, and more) route to entirely different internal APIs, each with its own request shape. A branching approach doesn't scale:

```java
if (type == FOP) { ... }
else if (type == CASH_TRANSFER) { ... }
else if (type == WIRE) { ... }
```

Instead, routing is isolated behind a factory + strategy pattern:

```java
public interface TransactionRouter {
    RoutingResult route(SignedTransaction txn);
}

public class FopTransferRouter implements TransactionRouter { ... }
public class CashTransferRouter implements TransactionRouter { ... }
public class WireTransferRouter implements TransactionRouter { ... }

public class TransactionRouterFactory {
    public static TransactionRouter forType(TransactionType type) {
        return switch (type) {
            case FOP -> new FopTransferRouter();
            case CASH_TRANSFER -> new CashTransferRouter();
            case WIRE -> new WireTransferRouter();
            default -> throw new UnsupportedTransactionTypeException(type);
        };
    }
}
```

Signing, retry, and recovery logic all operate on one canonical `SignedTransaction` model and remain entirely type-agnostic. Adding a new transaction type is a new router implementation — no changes to core logic.

* * *

## Legacy vs. Modern API Surface

| Legacy (XML-in-JSON) | Modern (Pure JSON) |
| --- | --- |
| Base64-encoded, signed XML string inside a JSON envelope | Native JSON fields |
| Auth baked into the XML signing convention | OAuth2, delegated entirely to a separate auth service |
| One implicit "version" — the XML schema in use | Explicit URL-based versioning (`/v1`, `/v2`) |
| Every request pays a decode → parse → verify tax | Single canonical internal object model, translated once at the edge |

Both surfaces run **simultaneously** — not sequentially deprecated — translated at the edge into one internal model, so validation, signing, and processing never need to know which surface a request arrived on. This is what let migration happen client-by-client instead of as a single flag day.

* * *

## Migration: Granular, Reversible, Client-by-Client

*   Rollout was granular to **client + transaction type**: Client A's ACH traffic could move to the new service while their wire transfers stayed on the old path, independently controlled via routing rules at the OAuth/auth layer. (XML-surface migration specifically was coarser — client-level only.)
    
*   Validation was **manual sign-off per client**, checked against historical transaction data, backed by failure-rate monitoring to surface anomalies.
    
*   Rollback used **database-backed feature flags** throughout the codebase — including at the OAuth/routing layer — allowing traffic to flip back to the old path without a redeploy.
    
*   Not everything went cleanly: both old and new paths stored **serialized Java objects** in the database, and objects serialized by the new service turned out to be incompatible with deserialization on the legacy side. Fixing it required touching the old EJB codebase — something the migration had otherwise avoided for its entire duration.
    
*   Total timeline: **12+ months**, with ~6 months specifically spent on the client-by-client rollout, executed by a team of 5 engineers working this alongside other commitments. The legacy EJB path is still live today, deprecated but not decommissioned.
    

* * *

## Results

| Metric | Outcome |
| --- | --- |
| Release cadence | 4× improvement (bimonthly → biweekly) |
| Rollback rate | ~20% of prior levels |
| EJB pool-exhaustion incidents | Zero since migration |
| Batch processing throughput | ~70% improvement |
| Dev triage time per outage | ~1 hour saved, across 100–500 affected transactions |

* * *

## Is This "Microservices"?

Worth stating precisely rather than reaching for the label: this is **not** database-per-service, fully isolated microservices. All four components share one database schema, with ownership expressed at the table level rather than full isolation. A commons library is shared across all of them — deliberately scoped down to DTOs and translation logic only, as a conscious mitigation against repeating the original EJB-jar mistake, but a shared dependency nonetheless. The more accurate description: **a modular decomposition into purpose-built, independently deployable services, with deliberate, narrowly-scoped shared coupling retained by design** — not textbook microservices purity for its own sake.

* * *

## Key Takeaways

*   A shared connection/resource pool has no concept of fairness — one noisy client (or one onboarding event) can starve every other consumer sharing it.
    
*   Deployment discipline ("never touch old code, only add") can contain blast radius, but it's a manual workaround for coupling, not a fix for it.
    
*   Treat the "move transactions forward" pipeline and the "resolve ambiguous state" recovery engine as separate concerns — conflating them is what made the old system fragile.
    
*   You cannot outsource idempotency to a batch framework's restart semantics when the real source of truth for success lives in an external system you don't control.
    
*   Retry logic that risks re-sending money needs to be state-machine-driven, not a generic transport-layer policy.
    
*   A shared library is not inherently the old monolith's mistake repeated — scope matters. DTOs and translation only, not business logic.
    
*   Running two API surfaces simultaneously, translated to one canonical internal model, is what makes gradual, client-by-client migration possible instead of a forced flag day.
    
*   Be precise about what you actually built. "Modular decomposition with deliberate shared coupling" is a more defensible claim than "microservices" if the architecture doesn't fully earn the second term.