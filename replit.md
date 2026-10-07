# SOGO — dokumenty i porównania

Polskojęzyczna aplikacja robocza dla firmy budowlanej do pracy z projektami, dokumentami ofertowymi, porównaniami zakupowymi i ustaleniami.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/sogo run dev` — run the SOGO web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- SOGO env: `VITE_AWS_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_DOMAIN`, `VITE_API_BASE_URL`
- AWS region and Cognito identifiers have safe defaults in `artifacts/sogo/src/lib/config.ts`; the Cognito Hosted UI domain and AWS API Gateway URL are configured through environment variables.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/sogo/src/App.tsx` — Polish application shell and route-level surfaces
- `artifacts/sogo/src/lib/config.ts` — environment configuration and connection-state messages
- `artifacts/sogo/src/lib/auth.ts` — Cognito OIDC Authorization Code + PKCE setup
- `artifacts/sogo/src/lib/api.ts` — typed transport for the AWS SOGO API, including projects, documents, uploads and offer analysis
- `lib/api-spec/openapi.yaml` — shared API contract source; SOGO business endpoints are not added until the AWS contract is delivered
- `artifacts/sogo/src/index.css` — SOGO theme tokens and visual system

## Architecture decisions

- The frontend never creates demo records or invents SOGO endpoints. Business surfaces use only the supplied AWS contract or show an explicit connection state.
- Cognito uses `oidc-client-ts` with Authorization Code + PKCE and `sessionStorage` for OIDC state/user data; tokens are never written to `localStorage`.
- File upload and document analysis remain separate UI actions. Uploaded PDF offers can be analyzed manually; active analysis statuses are refreshed from the AWS API without auto-starting analysis.
- Unknown numeric costs are rendered as `Do ustalenia`, not as zero, and supplier comparison UI does not choose a winner client-side.

## Product

The SOGO frontend includes configuration-aware entry/auth callback screens and the planned project, document, document detail, comparison, assistant, and decision routes. The initial build intentionally has no fake project or document data.

## User preferences

- Interfejs ma być po polsku, roboczy i profesjonalny.
- Nie dodawać trybu DEMO, fikcyjnych danych, sztucznych odpowiedzi AI ani pozorowanych sukcesów operacji.

## Gotchas

- `VITE_COGNITO_DOMAIN` and `VITE_API_BASE_URL` are configured for the supplied AWS services. Do not invent replacement API URLs.
- `artifacts/sogo/src/lib/auth.ts` derives the Cognito issuer from the User Pool ID and AWS region; the hosted UI domain is still required for discovery/login configuration.
- The shared API server is only the workspace scaffold health service, not the SOGO AWS backend.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
