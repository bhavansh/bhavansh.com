---
title: "HTTP Signatures in Real-Time Payments"
description: "A wire transfer gone wrong isn’t a bug you hotfix. It’s a compliance incident."
pubDatetime: 2026-06-27T14:30:00.000Z
draft: false
tags: ["http-signatures", "payments"]
---


> 📝 **Note:** This post was edited with AI assistance for clarity and structure. The system design, implementation decisions, and technical thinking are entirely my own.

## TL;DR

*   Designed a dual-signature model for a multi-currency real-time payments system:
    
    *   **HTTP Signatures** (RFC 9421 / draft-cavage) for in-transit integrity, authentication, and non-repudiation.
        
    *   **HMAC** persisted alongside transfer records for at-rest tamper detection.
        
*   Eliminated mTLS, OAuth, and shared-secret signing after a systematic security requirements analysis.
    
*   Built idempotent retries with a client-generated correlation ID to prevent duplicate transfers during network timeouts.
    
*   A background integrity job re-validates persisted HMACs; mismatches halt retries and raise alerts.
    
*   Isolated currency-specific request construction behind a factory + strategy pattern, keeping core logic currency-agnostic.
    

* * *

## Introduction

Our payments platform previously routed interbank fund transfers over traditional correspondent banking rails. While reliable, settlement could take several hours. Integrating with a real-time payments API gave us near-instant settlement, but introduced a hard security requirement:

> Every request must be authenticated, tamper-proof in transit, tamper-evident at rest, and non-repudiable.

* * *

## Security Requirements

Before choosing an authentication mechanism, we defined what we actually needed:

*   **Sender authentication** — cryptographic proof the request originated from our service.
    
*   **Message integrity (in transit)** — any modification to payload or headers in flight must be detectable.
    
*   **Integrity at rest** — if a persisted transfer record is modified after the fact, we must know before retrying it.
    
*   **Non-repudiation** — the authorizing party cannot later deny that the request was made with those exact parameters.
    
*   **Replay protection** — a captured valid request must not be replayable.
    

* * *

## Why Not JWT, OAuth, or mTLS?

| Mechanism | Sender Authentication | Message Integrity | Non-Repudiation | Replay Protection |
| --- | --- | --- | --- | --- |
| OAuth / JWT | ✅ | ❌ | ❌ | ❌ |
| mTLS | ✅ | Transport only | ❌ | Transport only |
| HMAC Request Signing | ✅ | ✅ | ❌ | Implementation-specific |
| HTTP Signatures | ✅ | ✅ | ✅\* | ✅\* |

> *   Requires asymmetric keys for non-repudiation and timestamps/nonces with server-side validation for replay protection.
>     

### Key Eliminations

*   **mTLS** protects the transport channel, not the message. Once a request is stored in a database, mTLS has done its job and is gone.
    
*   **HMAC** requires a shared secret. Since both parties can generate valid signatures, it does not provide non-repudiation.
    
*   **JWT and OAuth** operate at the token level, not the HTTP request level. They authenticate principals but do not protect individual headers, request targets, or payload integrity.
    

HTTP Signatures (`draft-cavage-http-signatures-12`, later standardized as RFC 9421) was the only mechanism that met all our requirements without additional round-trips or a separate verification service.

* * *

## How HTTP Signatures Work

The specification defines a **signing string** — a canonical, newline-separated concatenation of selected HTTP components — which is then signed and base64-encoded into the request headers.

Here's what the signing string looks like for a typical transfer request — this exact string is what gets signed with your private key:

### Signing String

```plaintext
(request-target): post /v1/transfers
(created): 1718300000
host: api.example.com
digest: SHA-256=X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=
content-length: 142
x-nonce: a3f9c21b-7e84-4d12-b001-9e5c3d8f0a72
```

### Authorization Header

```plaintext
Authorization: Signature
  keyId="payments-service-prod",
  algorithm="hs2019",
  headers="(request-target) (created) host digest content-length x-nonce",
  signature="Base64(Signature(signing-string))"
```

The header order in the signature string is a bilateral contract with the payment provider. Our agreed canonical order is:

`(request-target)` → `(created)` → `host` → `digest` → `content-length` → `x-nonce`

### Component Breakdown

| Component | Purpose |
| --- | --- |
| `(request-target)` | Prevents method or path tampering |
| `(created)` | Limits replay window |
| `host` | Prevents endpoint substitution |
| `digest` | Protects request body integrity |
| `content-length` | Prevents truncation or padding attacks (defense-in-depth) |
| `x-nonce` | Prevents replay of captured requests |

* * *

## RFC 9421 vs `draft-cavage-http-signatures-12`

The mental model is nearly identical. The terminology evolved:

| draft-cavage-12 | RFC 9421 |
| --- | --- |
| Signing string | Signature input |
| `(request-target)` | `@method` + `@target-uri` derived components |
| `(created)` / `(expires)` | Same concept with cleaner specification language |
| Nonce | Explicitly covered in security considerations |

The investment in understanding `draft-cavage-http-signatures-12` transfers directly to RFC 9421. The model remains the same; the specification simply tightened the details.

With that context established, here's how both mechanisms fit together in practice.

* * *

## System Architecture

We use two distinct signing mechanisms serving two different concerns.

### 1\. HTTP Signatures (In Transit)

The outbound request to the payment provider is signed using HTTP Signatures with an **asymmetric keypair** (e.g., Ed25519). The private key signs the signing string; the provider verifies with our public key. This provides non-repudiation — we cannot later deny having generated the request. The signature covers:

*   `(request-target)`
    
*   `(created)`
    
*   `digest`
    
*   `x-nonce`
    
*   agreed headers
    

This protects the request while it traverses networks and intermediary infrastructure.

### 2\. HMAC Stored in the Database (At Rest)

The business intent is independently signed with an **HMAC** (symmetric, shared only between our signing and verification services) and persisted alongside the transfer record.

```plaintext
{
  sourceIdentifier,
  destinationIdentifier,
  amount,
  currency,
  timestamp
}
```

This HMAC serves as an at-rest tamper-detection mechanism and is entirely separate from the HTTP Signature. It cannot provide non-repudiation (the verifying side also knows the key), but that’s not its job — it exists solely to detect unauthorized modification after the fact.

* * *

## Request Lifecycle

```plaintext
Internal Transfer Initiator
     │
     │  Input: Source ID, Destination ID, Amount, Currency
     ▼
  Payments Service
     │
     ├─► Resolve payment details
     │
     ├─► Compute HMAC over
     │    {source, destination, amount, currency, timestamp}
     │
     ├─► Persist
     │    {transfer payload + HMAC}
     │
     ├─► Construct outbound request
     │    (fresh timestamp, nonce, correlation ID)
     │
     ├─► Sign outbound request via HTTP Signatures
     │
     └─► POST to payment provider
          │
          ├─ 2xx → update state
          ├─ 4xx → fail request
          └─ timeout / transient failure
                 → asynchronous retry workflow
```

* * *

## Why Sign the Input Instead of the Outbound Request?

During retries, the outbound request is reconstructed:

*   New timestamp
    
*   New nonce
    
*   New correlation identifiers
    

These changes are legitimate.

What must never change is the business intent:

> Who is transferring what amount to whom.

Signing the input at receipt cryptographically locks the business intent at the moment of authorization.

Before every retry:

1.  Recompute HMAC from persisted values.
    
2.  Compare with stored HMAC.
    
3.  If they differ, halt processing and raise an operational alert.
    

A modified amount or substituted beneficiary never reaches the payment provider.

* * *

## Retry Design: Avoiding Double Posts

A timeout during a real-time payment operation is one of the most dangerous states in fintech. Retrying blindly risks duplicate transfers.

### Idempotency

The payment provider supports idempotent requests through a client-generated correlation identifier.

The service:

1.  Generates the identifier during the first attempt.
    
2.  Persists it alongside the transfer record.
    
3.  Reuses the same identifier for every retry.
    

This guarantees duplicate submissions resolve to the original transaction rather than creating additional transfers.

The HMAC verification gate serves a dual purpose:

*   security validation, and
    
*   correctness validation that retries are reconstructing the identical business intent.
    

* * *

## Multi-Currency Request Construction

A single transfer endpoint often supports multiple currencies, but field requirements vary considerably:

*   Fields mandatory for currency A may be optional or invalid for currency B.
    
*   Corridor-specific requirements may apply only to certain regions.
    
*   Some fields must be explicitly omitted for specific currency pairs.
    

A branching approach quickly becomes unmaintainable:

```java
if (currency == USD) { ... }
else if (currency == GBP) { ... }
else if (currency == EUR) { ... }
```

Instead, we implemented a factory and generator pattern:

```java
public interface PaymentRequestGenerator {
    PaymentRequest generate(TransferInput input);
}

public class UsdPaymentRequestGenerator
        implements PaymentRequestGenerator { ... }

public class GbpPaymentRequestGenerator
        implements PaymentRequestGenerator { ... }

public class EurPaymentRequestGenerator
        implements PaymentRequestGenerator { ... }

public class PaymentRequestGeneratorFactory {
    public static PaymentRequestGenerator
            forCurrency(Currency currency) {

        return switch (currency) {
            case USD -> new UsdPaymentRequestGenerator();
            case GBP -> new GbpPaymentRequestGenerator();
            case EUR -> new EurPaymentRequestGenerator();
            default ->
                throw new UnsupportedCurrencyException(currency);
        };
    }
}
```

The signing, retry, and tamper-detection layers operate entirely on `TransferInput` and remain currency-agnostic.

Adding a new payment corridor becomes a single new generator implementation with no changes to core logic.

* * *

## Key Takeaways

*   HTTP Signatures provide authentication, message integrity, and—when asymmetric keys are used—non-repudiation in a stateless mechanism.
    
*   Replay protection requires timestamps and nonce validation; neither alone is sufficient.
    
*   Sign what you receive, not what you send. Outbound requests legitimately evolve across retries; business intent must not.
    
*   Treat in-transit signatures and at-rest integrity verification as separate concerns. They answer different threat questions.
    
*   A factory plus generator pattern cleanly isolates currency-specific rules and keeps core logic currency-agnostic.
    
*   Header ordering is a bilateral contract between producer and consumer. Establish it before writing code.