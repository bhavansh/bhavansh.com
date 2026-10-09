---
title: "About Me"
description: "My career, resume, and a bit about me."
---

Hi, I'm Bhavansh Gupta. I'm a software engineer who enjoys building robust backend systems, clean APIs, and tinkering around a little. 

I'm currently focused on distributed systems, systems at scale and learning new things on the go. Outside of work, I enjoy reading, running & weightlifting, and tinkering with ideas I find interesting.

[Download my Resume (PDF)](https://drive.google.com/file/d/1To9h4AdAoV8XvEqtKeKRVt8IdHI3cqUU/view)

---

## Core Skills

- **Languages:** Java, Python, JavaScript, SQL (Oracle)
- **Frameworks:** Spring Boot, Spring Batch, Spring Security, Thymeleaf, HTMX, Micrometer, Prometheus 
- **Architecture:** Microservices, Event-driven architecture, API Design (REST, GraphQL)
- **Integrations & Tools:** Plaid, Adyen, Zerohash, JPM Global Payments, Safetypay, Docker, Jenkins, Git, IntelliJ IDEA, Postman

---

## Career

## 2022-07-01 · Software Engineer at Interactive Brokers
- Funds and Banking Platform
  - Owned the legacy Funds & Banking API serving institutional broker clients across 30+ transaction types (ACH, WIRE,
DWAC, FOP, Position Transfers, Deposits, Withdrawals and more), processing 100k+ daily requests with per-client
customizations and burst traffic support.
  - Led the migration to the modernized REST API, decomposing a legacy Java 8 EJB monolith (prone to connection-pool exhaustion
under peak and client-onboarding load) into 4 independently deployable modules (Spring Boot REST API, Spring Batch processor,
commons library, CLI monitoring app), maintaining parallel API support across a 12-month migration and eliminating
pool-exhaustion incidents entirely.
  - Designed a state-reconciliation engine for transaction recovery after partial failures, deliberately independent of Spring Batch’s
restart semantics since success/failure state for downstream calls lived in external systems, eliminating manual developer triage.
  - Impact: Release cadence improved 4× (bimonthly → biweekly); batch processing throughput improved ∼70% via multithreaded,
chunk-based redesign; rollback rate dropped to ∼20% of prior levels; auto-recovery saved ∼1 hour of dev triage per outage across
100–500 stuck transactions per event.
- Payment Integrations 
   - Integrated Plaid for ACH bank verification and EU payments (GBP + EUR) with a state machine managing polling, webhooks,
and lifecycle state transitions, processing high-volume daily ACH and EU deposit traffic while maintaining 99.9% monthly
service uptime.
  - Extended payment coverage by integrating Adyen for debit card deposits and Zerohash for crypto withdrawals; drove LATAM
expansion via SafetyPay for instant deposits across Argentina, Brazil, Chile, and Colombia.
- Real-Time Payments (RTP) 
  - Built a vendor-agnostic RTP platform routing interbank transfers across multiple banking rails – JPMorgan and Standard
Chartered (5 currencies) – with treasury selecting vendors based on preference and outgoing payment requests generated
internally from SWIFT address book data.
  - Implemented HTTP Signatures (draft-cavage-12) to cryptographically sign outbound calls to the JPM Global Payments API,
backed by a resilient client guaranteeing response under downstream failures.
  - Established rule-based retry logic, polling fallbacks, and failure-rate alert monitoring; the platform handles high-value,
mission-critical daily bulk payment volume for institutional treasury operations.
- Internal Admin Platform & Observability 
  - Architected a Spring Boot + Thymeleaf + HTMX internal dashboard with: a custom health metrics UI surfacing live data from
Actuator/Micrometer/Prometheus endpoints across 30+ services, a DB-backed transaction audit log viewer (searchable by
transaction ID), a self-serve query console with prebuilt debugging queries for sales/ops, Spring Batch job management, config
management with approval workflows, and RBAC user management.
  - Impact: Eliminated developer involvement for routine sales queries and config changes, reducing turnaround from hours (dev
ticket queue) to self-serve minutes.
  - Developed a Python health-monitoring service polling 200+ internal service endpoints with configurable retry logic and
developer alerting, and AppManager, an internal Java library managing a common control plane for managed microservices –
layering on top of Spring Boot Actuator while also handling standardized /heartbeat, /healthcheck endpoints; also defined
Spring Boot production-readiness standards and automated jar-based deployment pipelines.

## 2021-06-01 · FSG Intern at PTC
- Created automation scripts for deployment and testing; resolved 50+ SPRs including critical fixes, reducing testing time by 30%;
recognized with the Excellence & Innovation Award.

