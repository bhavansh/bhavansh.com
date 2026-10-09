---
title: "Placeholder"
description: "something exciting coming up"
status: "completed"
startDate: 2025-06-01
updatedDate: 2025-08-15
cover: "./cover.png"
coverAlt: "Task queue architecture diagram"
tech: ["Go", "Redis", "Docker"]
github: https://github.com/bhavansh/dist-task-queue
draft: true
---

## Overview

I needed a simple background job processor for a personal project but found Celery and RabbitMQ too heavy. I decided to build my own minimal task queue using Go and Redis.

## Approach

The system leverages Redis Streams for message queuing, ensuring reliable delivery even if a worker crashes midway. 

## Lessons Learned

Handling worker crashes was the hardest part. Implementing a dead-letter queue and a background process to reclaim stalled jobs taught me a lot about distributed systems fault tolerance.

