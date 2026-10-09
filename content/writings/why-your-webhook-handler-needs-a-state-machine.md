---
title: "Why Your Webhook Handler Needs a State Machine (And What That Actually Means in Practice)"
description: "How out-of-order webhook delivery breaks payment state and the transition guard pattern that fixes it"
pubDatetime: 2026-07-05T14:30:00.000Z
draft: false
tags: ["state-machines", "webhooks"]
---

# Why Your Webhook Handler Needs a State Machine (And What That Actually Means in Practice)

> 📝 **Note:** This post was edited with AI assistance for clarity and structure. The system design, implementation decisions, and technical thinking are entirely my own.

## TL;DR

*   Integrated a third-party payment provider with a dual-flow architecture (server-to-server token exchange + client-side browser SDK), where webhooks are the primary state update mechanism and polling is the fallback.
    
*   Discovered that webhook delivery order does not guarantee event order — SUCCESS webhooks arrive before PROCESSING, FAILURE before PROCESSING — silently corrupting the raw provider status table while internal state guards rejected the bad transitions downstream.
    
*   Modelled payment states into three groups: **intermediate states**, **final success states**, and **final failure states** — and derived all valid transitions from group membership alone.
    
*   Enforced transition guards at two layers: DB update procedures and Java service layer, rejecting reverse transitions and redundant same-state updates at both.
    
*   Added operational alerting on out-of-order webhook arrivals to make the failure mode observable rather than silent.
    

* * *

## Introduction

When integrating a third-party payment provider, most of the engineering attention goes to the obvious hard parts: authentication, request construction, error handling, and retry design. State management tends to feel like a solved problem — the provider tells you what happened, you update your records accordingly.

The assumption hidden in that sentence is that the provider tells you what happened *in the order it happened*. In practice, with webhook-based integrations, that assumption does not hold. Webhook delivery is not guaranteed to be ordered. Network conditions, provider-side queuing, and retry mechanisms mean that a SUCCESS notification for a payment can arrive at your server before the PROCESSING notification that logically preceded it.

This post is about the failure mode that surfaces when you trust webhook delivery order, the state modelling pattern that fixes it, and the specific enforcement approach we implemented.

* * *

## Integration Architecture

The payment provider integration uses a dual-flow design:

1.  **Server-to-server token exchange** — our backend calls the provider API to generate a short-lived token, which is passed to the client.
    
2.  **Client-side browser SDK** — the client uses the token to complete the payment flow directly with the provider. At the end of this flow, the provider returns a result event to the browser.
    
3.  **Webhook delivery** — simultaneously and independently of the browser event, the provider POSTs webhook notifications to our server as the payment progresses through its internal pipeline.
    

Webhooks are the **primary mechanism** for server-side state updates because they are event-driven and near real-time. Polling against the provider's status API runs as a **fallback** — batched, periodic, and intended to catch payments where webhooks were missed or dropped.

On the storage side, we maintain two separate tables:

*   **Provider status table** — stores the raw payment status as reported by the provider (webhook payloads, poll responses).
    
*   **Internal payment status table** — stores our own payment lifecycle state, derived from provider statuses via a sync process.
    

A background sync process reads from the provider status table, maps provider-specific statuses to our internal status model and applies the transition to the internal table. The internal table is the source of truth for all downstream systems.

![](https://cdn.hashnode.com/uploads/covers/5f367218877a013acb03c707/e6b7936f-b36e-4f4f-806f-6c2752d5dfb2.png align="center")

* * *

## State Model

### Provider Statuses

The provider exposes a set of statuses that cover the full lifecycle of a payment:

| Provider Status | Meaning |
| --- | --- |
| `INITIATED` | Payment request received by the provider |
| `PROCESSING` | Payment is being processed |
| `PENDING_APPROVAL` | Awaiting approval (bank-side or compliance hold) |
| `SUCCESS` | Payment completed successfully |
| `FAILED` | Payment failed (insufficient funds, rejected, etc.) |
| `RETURNED` | Payment was returned after initial success |
| `CANCELLED` | Payment was cancelled before processing completed |

### Internal Statuses

These map to our domain model, independent of provider-specific terminology:

| Internal Status | Meaning |
| --- | --- |
| `PENDING` | Payment initiated, not yet confirmed by provider |
| `IN_PROGRESS` | Provider is actively processing |
| `ON_HOLD` | Awaiting external approval |
| `COMPLETED` | Payment settled successfully |
| `FAILED` | Payment failed terminally |
| `RETURNED` | Payment reversed post-settlement |
| `CANCELLED` | Payment voided pre-settlement |

* * *

## State Grouping: The Core Design Decision

The first step in designing the transition model was not enumerating individual allowed transitions between statuses. That approach scales poorly — with N statuses, you potentially have N² pairs to reason about, and it becomes easy to miss a case or introduce an inconsistency.

Instead, we grouped statuses by their role in the payment lifecycle:

**Intermediate states** — the payment is still in progress; further transitions are expected. `PENDING`, `IN_PROGRESS`, `ON_HOLD`

**Final success states** — the payment has settled successfully; no further provider-driven transitions are valid.`COMPLETED`, `RETURNED` *(a return is a terminal outcome, not a reversal back to intermediate)*

**Final failure states** — the payment has terminated unsuccessfully. `FAILED`, `CANCELLED`

From these three groups, all valid transitions follow from four rules:

![](https://cdn.hashnode.com/uploads/covers/5f367218877a013acb03c707/01f399bb-ce67-4c9a-9cf2-c1b09f17c3c2.png align="center")

And two explicit rejections:

![](https://cdn.hashnode.com/uploads/covers/5f367218877a013acb03c707/33d23e14-1034-4ad1-9a0f-67f01c8ca70f.png align="center")

Note that final-to-same-final is treated as a no-op, not an error. A duplicate SUCCESS webhook for an already-COMPLETED payment is expected behaviour given webhook retry semantics. Silently ignoring it is the correct response — rejecting it as an error would generate false alerts.

### State Transition Diagram

![](https://cdn.hashnode.com/uploads/covers/5f367218877a013acb03c707/671a192d-fff1-45bd-9736-209f999e4e7a.png align="center")

* * *

## What Broke Before This Model

Before the transition guard was applied uniformly to both tables, the raw provider status table was updated on every incoming webhook without validation.

The failure scenario played out as follows:

![](https://cdn.hashnode.com/uploads/covers/5f367218877a013acb03c707/2805a30f-fa02-4b4d-bf09-4c60603f1c6d.png align="center")

The internal state was correct because the Java service layer already had transition guards. But the provider table had been overwritten to a stale state. Any process reading the provider table directly — monitoring queries, reconciliation jobs, support tooling — would see a payment stuck in PROCESSING that had already settled.

The only way to reconstruct the actual sequence of events was to go through the state transition audit log manually and trace each webhook arrival by timestamp.

The internal guards held. The problem was that the provider table had no equivalent protection, so the corruption happened one layer above where the guards lived.

* * *

## The Fix: Transition Guards at Every Layer

The fix was to apply the same group-based transition model to the provider status table, not just the internal one.

### Layer 1 — DB Update Procedures

Direct writes to either status table are not permitted from application code. All updates go through stored procedures. We added transition validation inside the procedures:

```sql
-- Pseudocode representation of the guard logic
IF current_group = 'FINAL' AND new_group = 'INTERMEDIATE' THEN
    -- Reverse transition: reject silently, raise alert
    RETURN;
END IF;
 
IF current_group = 'FINAL_SUCCESS' AND new_group = 'FINAL_FAILURE' THEN
    -- Cross-terminal transition: reject, raise alert
    RETURN;
END IF;
 
IF current_group = 'FINAL_FAILURE' AND new_group = 'FINAL_SUCCESS' THEN
    -- Cross-terminal transition: reject, raise alert
    RETURN;
END IF;
 
IF current_status = new_status THEN
    -- Idempotent duplicate: reject silently, no alert
    RETURN;
END IF;
 
-- Valid transition: proceed with update
UPDATE payment_status SET status = new_status ...
```

The DB layer is the last line of defence. If the application layer fails to catch something, the procedure will.

### Layer 2 — Java Service Layer

The service layer validates transitions before issuing any DB call, using an explicit group classification and an allowed-transition check:

```java
public enum PaymentStatusGroup {
    INTERMEDIATE, FINAL_SUCCESS, FINAL_FAILURE
}
 
public enum InternalPaymentStatus {
    PENDING(INTERMEDIATE),
    IN_PROGRESS(INTERMEDIATE),
    ON_HOLD(INTERMEDIATE),
    COMPLETED(FINAL_SUCCESS),
    RETURNED(FINAL_SUCCESS),
    FAILED(FINAL_FAILURE),
    CANCELLED(FINAL_FAILURE);
 
    private final PaymentStatusGroup group;
 
    InternalPaymentStatus(PaymentStatusGroup group) {
        this.group = group;
    }
 
    public PaymentStatusGroup getGroup() {
        return group;
    }
}
```

```java
public TransitionResult validateTransition(
        InternalPaymentStatus current,
        InternalPaymentStatus next) {
 
    PaymentStatusGroup currentGroup = current.getGroup();
    PaymentStatusGroup nextGroup = next.getGroup();
 
    // Idempotent: same status, nothing to do
    if (current == next) {
        return TransitionResult.IDEMPOTENT;
    }
 
    // Final → Intermediate: reverse transition
    if (currentGroup != INTERMEDIATE && nextGroup == INTERMEDIATE) {
        return TransitionResult.REJECTED_REVERSE;
    }
 
    // Cross-terminal: final success ↔ final failure
    if (currentGroup == FINAL_SUCCESS && nextGroup == FINAL_FAILURE
            || currentGroup == FINAL_FAILURE && nextGroup == FINAL_SUCCESS) {
        return TransitionResult.REJECTED_CROSS_TERMINAL;
    }
 
    // All other transitions are valid
    return TransitionResult.ALLOWED;
}
```

The service layer acts on the `TransitionResult`:

*   `ALLOWED` → proceed, call DB procedure
    
*   `IDEMPOTENT` → no-op, return without error
    
*   `REJECTED_REVERSE` or `REJECTED_CROSS_TERMINAL` → reject, fire alert
    

### Alerting

Silent rejection is operationally dangerous. If out-of-order webhooks are arriving and being silently dropped, you have no visibility into how frequently this happens, whether it is a transient network issue or a systematic provider problem, or which specific payments are affected.

We fire an alert on every rejected transition (excluding idempotent duplicates). The alert payload includes the payment ID, the current status, the rejected incoming status, the webhook timestamp, and the arrival timestamp — enough to reconstruct the ordering discrepancy without manual log archaeology.

* * *

## Key Takeaways

*   External payment providers do not guarantee webhook delivery order. Treat every incoming status update as potentially out-of-order.
    
*   Model payment states by group — intermediate, final success, final failure — and derive allowed transitions from group membership. This is more maintainable than enumerating individual valid pairs, and makes it trivial to classify any new status correctly.
    
*   Apply transition guards at every layer that stores payment state, not just the authoritative internal one. A raw provider status table with no guards will silently corrupt even when your internal table is protected.
    
*   Idempotent transitions (final → same final) should be silent no-ops, not errors. Duplicate webhook delivery is expected behaviour, not a bug.
    
*   Invalid transitions should fire operational alerts, not be silently dropped. Frequency and pattern of bad-order arrivals is genuinely useful signal for diagnosing provider behaviour.
    
*   Polling as a fallback is not optional. Webhooks can be missed or dropped; polling is what recovers payments that would otherwise get stuck in intermediate states indefinitely.