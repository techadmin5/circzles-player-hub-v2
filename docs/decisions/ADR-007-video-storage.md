# ADR-007: Provider-Independent Video Storage

## Status

Accepted for backend blueprint.

## Decision

Store video binaries in object storage, not PostgreSQL. Backend issues signed upload URLs and stores metadata references.

## Rationale

Submissions can involve large mobile uploads. Direct browser-to-object-storage upload supports retries and avoids overloading the API server.

## Consequences

Provider choice remains deferred. The backend should define an `ObjectStorageProvider` interface before choosing S3/R2/GCS/etc.
