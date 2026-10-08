# AWS worker source snapshot

Source snapshot of sogo-document-worker after the 2026-10-08 runtime fixes.
The last recorded verified deployed ZIP SHA-256 is `dvleEgUxBonZr3ZQe3ejOqcrwbJgPAY//FZhIbC5x/4=`. This is the deployment archive hash, not a reproducible source tree hash.

Includes bounded extraction recovery, separate conversation wait budget, explicit Sonnet 5 extraction thinking configuration, and complete fenced JSON recovery.

Run offline regression checks with `python3 backend/test_runtime.py`. No AWS calls or paid model calls are made by these tests.

This directory is the worker only, not the sogo-web-api source or infrastructure/IAM configuration. Publishing this repository does not deploy Lambda. Preserve existing environment settings and triggers during a separately authorized deployment.

Known limitation: successful processing does not prove semantic completeness. The last live test had 28 materials, 10 quantities known, and needs quality improvements. The facts-first pilot is experimental and is intentionally not included in production code.
