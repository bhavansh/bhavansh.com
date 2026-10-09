---
title: "Building an Internal Admin Dashboard with HTMX and Thymeleaf in 2025"
description: "A legacy admin interface with a shared password isn't a security posture. It's a liability waiting for a postmortem."
pubDatetime: 2026-06-27T14:30:00.000Z
draft: false
tags: ["thymeleaf", "dashboard", "ui"]
---


> 📝 *Note: This post was edited with AI assistance for clarity and structure. The system design, implementation decisions, and technical thinking are entirely my own.*

## TL;DR

Built a full internal admin platform — health dashboards, approval workflows, RBAC, query consoles, batch job management — using Spring Boot, Thymeleaf, and HTMX. Single deployable JAR. Zero React.

*   Replaced a legacy administrative interface with limited access controls and no audit trail with a dedicated, properly secured application.
    
*   Chose HTMX over React for three concrete reasons: backend team skillset, single deployable requirement, and internal dependency approval overhead. AI made HTMX + Tailwind the obvious choice — Thymeleaf templates are straightforward to prompt for, and we went from zero to working prototype faster than we could have set up a React project.
    
*   Used `hx-trigger` polling for live health dashboards, partial swaps for search, and modals for Prometheus snapshots.
    
*   Built a config approval workflow with a git-like diff view — JSON CLOB deserialized against the same Java class for validation.
    
*   Layered custom RBAC on top of SSO using Spring Security's built-in authority model.
    
*   Discovered (the hard way) that DOM ID collisions are HTMX's scaling gotcha — solved with namespace conventions on Thymeleaf fragments.
    

* * *

## Introduction

When we migrated a backend service from a legacy Java 8 EJB monolith to modern Spring Boot, we inherited a problem that had nothing to do with the migration itself:

A legacy administrative interface secured by a single shared password known to the entire team.

No audit trail. No per-user accountability. No roles. Just a URL and a password in an internal wiki.

When the new service went live, we decided we weren't dragging that interface along. We'd build a dedicated internal admin platform — properly secured, decoupled from the application it managed, and extensible enough to absorb future operational needs.

What started as a simple tracking UI grew into:

*   **Health check dashboard** — live status for dozens of backend services and their dependencies, with Prometheus/Micrometer metrics
    
*   **Audit log viewer** — searchable by record ID, live lifecycle status
    
*   **Query console** — prebuilt debugging queries for non-engineering teams
    
*   **Spring Batch job management** — trigger, monitor, and inspect batch job runs
    
*   **Config management with approval workflows** — diff views, async approval, RBAC-gated persistence
    
*   **User management** — role assignment, internal auth integration, server-side integrity-validated RBAC changes
    

* * *

## Why Not React?

Before describing what we built, it's worth being direct about the decision not to reach for React or Vue.

React was never seriously considered. Here's the actual reasoning:

**Team skillset.** We're a backend team. Java, Spring, SQL, distributed systems. Nobody had strong React experience, and a migration project is not the right moment to introduce a framework none of us know well.

**Single deployable.** A React SPA means a client-side application with its own build pipeline, deployment target, and hosting, talking to a Spring Boot backend over JSON APIs. That's two things to deploy, two things to monitor, two things to break at 2am. We wanted one JAR that runs with `java -jar`.

**Internal dependency overhead.** On internal systems, adding new libraries isn't always frictionless. A typical React project can pull in hundreds of transitive npm packages. Getting security approval for all of them — especially those with known CVEs — is a real process that takes real time. HTMX is a single JavaScript file with no transitive dependencies. That matters operationally.

**No JSON translation layer.** With Thymeleaf, the server renders HTML directly. With React, the server renders JSON, the client consumes it, and the client renders HTML. For an internal dashboard that displays operational data and executes actions, that translation layer adds complexity without adding value.

The question wasn't "HTMX vs React." It was: does the complexity React brings actually serve our requirements? The answer was no.

**AI as a deciding factor.** One thing worth calling out explicitly: AI-assisted development made HTMX + Tailwind an even clearer choice. Thymeleaf templates are plain HTML with attributes — easy to describe, easy to prompt for, and the output is immediately readable and debuggable. We went from zero to a working prototype faster than we could have bootstrapped a React project. With React, you're prompting for components, hooks, state management, and build config. With Thymeleaf + HTMX, you're prompting for HTML. The feedback loop is tighter.

| Concern | React + Spring Boot | Thymeleaf + HTMX |
| --- | --- | --- |
| Deployables | 2 (client + server) | 1 |
| Team ramp-up | High | Low (mostly HTML) |
| Dependency footprint | Large (npm tree) | Minimal |
| Spring Security integration | Manual (CORS, JWT) | Native |
| Time to first working prototype | Days | Hours |
| Suitable for rich client-side state | ✅ | ❌ |

* * *

## Dynamic Interfaces with HTMX

HTMX's model is simple: HTML attributes trigger server requests and swap fragments into the DOM. Here's where it delivered concretely.

### Health Dashboard — Polling Without JavaScript

The health dashboard shows live status for dozens of internal services. Each card displays current health and key Prometheus metrics. Clicking a card opens a modal with a full point-in-time stats snapshot.

The polling setup is four attributes:

```html
<div id="health-grid"
     hx-get="/admin/health"
     hx-trigger="every 10s"
     hx-swap="innerHTML">
  <!-- Server renders updated cards as a Thymeleaf fragment -->
</div>
```

Every 10 seconds, HTMX fires a GET, the server renders the updated fragment, and only that region of the DOM is replaced. No WebSockets. No SSE setup. No JavaScript.

The Prometheus metrics are point-in-time snapshots — a live scrape of `/actuator/prometheus` at request time. We deliberately chose not to store time-series data. For our use case ("is this service healthy right now?"), a snapshot at the moment of viewing was enough. Storing historical time-series would have introduced infrastructure we didn't need.

The modal for drill-down stats follows the same pattern — `hx-get` on the card element, `hx-target` pointing at a modal container, server returns a rendered fragment.

### Server-Driven Search

The query console — used by non-engineering teams to look up records — has a search input that filters results in place as you type:

```html
<input type="text"
       name="query"
       hx-get="/admin/console/search"
       hx-trigger="input changed delay:400ms"
       hx-target="#results-table"
       hx-swap="innerHTML"
       placeholder="Search...">
```

Debounced, server-driven search. The results table updates without a page reload. Four attributes, no JavaScript event handlers.

The audit log viewer works differently — it's primarily a developer debugging tool. You enter a specific record ID and retrieve the full lifecycle event trace for that record. No live filtering; a deliberate lookup. HTMX handles the form submission and swaps the result panel in place, but the interaction model is submit-and-display rather than type-and-filter.

This pattern — debounced input triggering a partial server render — is where HTMX makes the "mostly static server-rendered site" feel genuinely interactive.

* * *

## Config Management with Approval Workflows

Configuration changes — application parameters and feature flags — go through a two-step async flow:

1.  A **requestor** submits a proposed config change via the UI
    
2.  An **approver** reviews the diff and approves or rejects it at their convenience
    

The interesting implementation detail: we store config state as a JSON CLOB in the database, serialized from the same Java class that represents the config at runtime.

When an approver reviews a pending change, we deserialize both the current and proposed config, diff them, and render the result as a structured diff view:

```plaintext
  feature.rateLimitEnabled:  true
- feature.maxRequestsPerMin: 100
+ feature.maxRequestsPerMin: 250
  feature.retryOnFailure:    true
```

On approval, the proposed JSON is deserialized back against the config class, validated, and persisted. The same class handles serialization and deserialization — no schema drift, no separate migration scripts for config format changes.

We deliberately did not build live UI updates for approval status. When something gets approved, the requestor finds out via internal notification. The HTMX live-update complexity wasn't justified for a workflow that operates on the timescale of minutes-to-hours, not seconds.

* * *

## Authentication and Authorization

### Internal Auth + Custom RBAC

We integrated with the organization's internal authentication system — users log in with the same credentials they use across internal tooling. The shared password was gone on day one.

The internal auth system handled authentication cleanly. Authorization was a different story.

Its role model was too coarse-grained for what we needed. It could tell us who someone was, not what they were allowed to do inside our specific dashboard. We layered our own RBAC on top using Spring Security's built-in authority model.

Users can hold multiple roles simultaneously. Roles map to Spring Security authorities, which gives us `sec:authorize` in Thymeleaf templates:

```html
<!-- Only rendered for users with the APPROVER role -->
<button sec:authorize="hasRole('APPROVER')"
        hx-post="/admin/config/approve"
        hx-target="#approval-status">
  Approve Change
</button>
```

And `@PreAuthorize` on controller methods for actual enforcement (template visibility alone is never sufficient):

```java
@PostMapping("/config/approve")
@PreAuthorize("hasRole('APPROVER')")
public String approveConfigChange(...) {
    // ...
}
```

Privileged roles — approvers, admins — are pinned to specific credentials managed at the server level. RBAC changes are validated using server-side authorization and integrity checks before any role modification takes effect.

* * *

## DOM ID Collisions at Scale

As the codebase grew — more fragments, more interactive regions, more reused components — a class of bugs started appearing that were time-consuming to track down: event listeners firing multiple times, interactions behaving unpredictably, state leaking between sections of the page.

The root cause was straightforward once identified: ID collisions across Thymeleaf fragments.

When multiple instances of the same fragment exist on a page — a service health card rendered for dozens of services, for example — and each fragment contains `id="status-badge"` or `id="refresh-btn"`, the DOM behaves unpredictably. The browser doesn't enforce ID uniqueness; it quietly picks one and ignores the rest. HTMX targets by ID, so the wrong element gets updated.

The fix is a namespacing convention: propagate a context identifier from the calling template into every fragment, and use it as the dynamic suffix of every element ID.

```html
<!-- Caller passes a context ID -->
<div th:replace="~{fragments/service-card :: card(serviceId=${service.id})}"></div>

<!-- Fragment namespaces all IDs using that context -->
<div th:fragment="card(serviceId)">
  <div th:id="'status-' + ${serviceId}">...</div>

  <button th:id="'refresh-' + ${serviceId}"
          th:attr="hx-get='/admin/health/' + ${serviceId},
                   hx-target='#status-' + ${serviceId}">
    Refresh
  </button>
</div>
```

Static prefix, dynamic suffix. Safe fragment reuse, predictable HTMX targeting.

This is the discipline that React's component model enforces by default through scoped rendering. With HTMX and Thymeleaf, you enforce it yourself — as a team convention established early, before the codebase is large enough to make retroactive fixes painful.

* * *

## When This Stack Makes Sense

For an internal tool on a backend team, the calculus is clear: one deployable, native Spring Security integration, no build pipeline, and you ship faster. With AI assistance, the gap widens further — Thymeleaf templates are plain HTML that's easy to prompt for and immediately readable. By the time a React project is bootstrapped, you've already shipped v1.

The threshold where we'd reconsider:

| Requirement | Recommendation |
| --- | --- |
| Display data, execute actions, enforce permissions | HTMX + Thymeleaf |
| Backend team, single deployable, fast iteration | HTMX + Thymeleaf |
| Rich client-side state (drag-and-drop, collaborative editing) | React / Vue |
| Complex multi-step wizard with branching client-side logic | React / Vue |
| Dedicated frontend team, component reuse at scale | React / Vue |

The shared password is gone. The legacy interface is gone. And we never had to write a Redux reducer.

* * *

## Key Takeaways

*   **Single deployable wins for internal tools.** Two servers means two failure domains, two deployment pipelines, and double the on-call surface area.
    
*   **HTMX's model is** `hx-get` **+** `hx-trigger` **+** `hx-swap`**.** Most interactive requirements — polling, search, modals, in-place updates — reduce to these three attributes.
    
*   **AI + HTMX is a fast prototyping stack.** Thymeleaf templates are plain HTML — easy to describe, easy to prompt for, and immediately debuggable. The feedback loop is significantly tighter than with component-based frameworks.
    
*   **Template-level visibility (**`sec:authorize`**) is never sufficient.** Always enforce authorization at the controller layer with `@PreAuthorize`. UI hiding is UX, not security.
    
*   **Store config as a serialized domain object.** Deserializing proposed changes against the same Java class at approval time means the validation layer and the storage layer share a single source of truth — no schema drift.
    
*   **Establish a fragment ID namespacing convention early.** DOM ID collisions are HTMX's main scaling pitfall. Dynamic suffixes from context identifiers keep fragment reuse safe and HTMX targeting predictable.
    
*   **React is the right tool for rich client-side state.** It's the wrong default for every web interface.