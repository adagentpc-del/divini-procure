# Object Storage and Encryption at Rest

Divini Procure stores uploaded documents (vendor insurance certificates, W9s,
licenses, legal agreements, RFQ specs, profile collateral) through a pluggable
object storage layer. By default these files live on the local disk of the
application server. For production you should move them to an S3-compatible
object store with versioning and, where the documents are sensitive, enable
encryption at rest.

Many of these documents are sensitive vendor insurance, certification, and legal
records. Treat the bucket and the encryption key with the same care as the
database.

## Default behavior (no configuration)

With none of the variables below set, behavior is identical to before this
feature existed:

- Provider is `local`: files are written under `FILE_STORAGE_DIR`
  (default `/data/procure-files`).
- No encryption: files are stored as plaintext bytes on disk.
- Downloads use the same short-lived HMAC-signed URL flow as today.

## Provider selection

| Env var | Default | Notes |
| --- | --- | --- |
| `STORAGE_PROVIDER` | `local` | `local` or `s3` |
| `FILE_STORAGE_DIR` | `/data/procure-files` | local provider root |
| `S3_ENDPOINT` | (unset) | full HTTPS endpoint, see per-vendor table |
| `S3_REGION` | `us-east-1` | use `auto` for Cloudflare R2 |
| `S3_BUCKET` | (unset) | bucket name |
| `S3_ACCESS_KEY_ID` | (unset) | access key |
| `S3_SECRET_ACCESS_KEY` | (unset) | secret key |
| `STORAGE_ENCRYPTION_KEY` | (unset) | base64 of 32 bytes; enables AES-256-GCM |

The S3 client is a self-contained AWS Signature V4 signer over the global
`fetch`. There is no AWS SDK dependency. Path-style addressing is used
(`<endpoint>/<bucket>/<key>`), which all four vendors below support.

## Configuring S3 / R2 / B2 / MinIO

### AWS S3

```
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.us-east-1.amazonaws.com
S3_REGION=us-east-1
S3_BUCKET=diviniprocure-docs
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
```

Create the bucket in the same region as `S3_REGION`. Keep it private (block all
public access). Grant the IAM user only `s3:PutObject`, `s3:GetObject`, and
`s3:DeleteObject` on `arn:aws:s3:::diviniprocure-docs/*`.

### Cloudflare R2

```
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=diviniprocure-docs
S3_ACCESS_KEY_ID=<R2 access key id>
S3_SECRET_ACCESS_KEY=<R2 secret>
```

R2 uses region `auto`. Generate an R2 API token scoped to the bucket.

### Backblaze B2 (S3-compatible API)

```
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
S3_REGION=us-west-004
S3_BUCKET=diviniprocure-docs
S3_ACCESS_KEY_ID=<keyID>
S3_SECRET_ACCESS_KEY=<applicationKey>
```

Use the S3-compatible endpoint and region shown in the B2 bucket details. The
`keyID` / `applicationKey` pair maps to the access key id / secret.

### MinIO (self-hosted)

```
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://minio.internal:9000
S3_REGION=us-east-1
S3_BUCKET=diviniprocure-docs
S3_ACCESS_KEY_ID=<minio access key>
S3_SECRET_ACCESS_KEY=<minio secret key>
```

MinIO accepts any region label; match it to your MinIO server config.

## Encryption at rest

Set `STORAGE_ENCRYPTION_KEY` to the base64 encoding of exactly 32 random bytes.
When set, every object is encrypted with AES-256-GCM before it is stored and
decrypted on read. This applies to BOTH the local and S3 providers. With the key
unset, objects are stored as plaintext (today's behavior).

Generate a key:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Stored format is self-describing (`magic | version | iv | tag | ciphertext`), so
objects written before the key was introduced still read correctly as
plaintext. After enabling encryption, newly written objects are encrypted;
existing plaintext objects keep working.

### Losing the key loses the files

`STORAGE_ENCRYPTION_KEY` is a master secret. If it is lost or changed, every
object encrypted under it becomes permanently unrecoverable. Anthropic cannot
recover it for you. Store it in your secrets manager, back it up out of band, and
rotate it only with a planned re-encryption pass. Because these are sensitive
vendor insurance, certification, and legal documents, also confirm your key
custody meets any contractual or regulatory retention requirements before
turning encryption on.

## Backups

These documents are business critical (proof of insurance, signed agreements),
so back them up independently of the application.

### S3 / R2 / B2

- Enable bucket versioning so overwrites and deletes are recoverable.
- Add a lifecycle rule to expire noncurrent versions after a retention window
  (for example 90 to 365 days) to control cost while keeping a recovery window.
- For AWS, optionally enable cross-region replication or scheduled backups to a
  second bucket / account for disaster recovery.
- If encryption at rest is enabled, your backups contain ciphertext. Back up the
  `STORAGE_ENCRYPTION_KEY` separately and securely, or the backups are useless.

### Local disk

If you stay on the local provider, snapshot `FILE_STORAGE_DIR` on a schedule.
Example nightly cron creating a dated tarball and pruning old ones:

```
0 2 * * *  tar czf /backups/procure-files-$(date +\%F).tgz -C /data procure-files \
           && find /backups -name 'procure-files-*.tgz' -mtime +30 -delete
```

Copy those snapshots off the box (object storage, another host) so a disk
failure does not also lose the backups. As with the bucket case, if encryption
is enabled keep the key backed up separately.
