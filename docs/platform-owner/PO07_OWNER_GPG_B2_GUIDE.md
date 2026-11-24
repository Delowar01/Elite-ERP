# PO-07 S12 — the owner's own setup: backup key (GPG) and off-host storage (Backblaze B2)

**For the owner only.** Do these steps yourself, on your own PC and in your own browser. **Claude Code never sees, types
or receives** your private key, your passphrase, your Backblaze password, the application key's secret, or any recovery
code. The only things you pass on are:
- your **public** key file;
- its **fingerprint**;
- the **bucket name**;
- the words "rclone.conf in place".

Decisions: D5 (Backblaze B2) and D6 (an owner-controlled GPG private key), recorded 24 Nov 2026. Creating the account,
bucket and key is not authorized by any prompt so far: do it only when you decide to, before the S12 window.

## A. Your backup encryption key (Windows, Gpg4win / Kleopatra)

1. **Install Gpg4win** from its official site (gpg4win.org). Before running the installer, check it against the
   signature or SHA-256 published there. Accept the default components (Kleopatra and GnuPG).
2. **Create the key pair.** In Kleopatra: *File → New OpenPGP Key Pair…*
   - Name: `Elite PO staging backups`. E-mail: a staging-only address (not used in production).
   - *Advanced Settings*: **ECC** (Curve25519, the default "ed25519 + cv25519") or **RSA 4096**. Valid until: **two
     years**. Keep both the signing and the encryption capability ticked.
   - Choose a **strong passphrase** and store it in your password manager.
3. **Note the fingerprint.** Kleopatra shows it in the key's details: 40 hexadecimal characters, e.g.
   `ABCD 1234 …`. You will compare it later with the one the VPS prints at S12.
4. **Back up the private key, offline.** Right-click the key → *Backup Secret Keys…* → save the `.asc` file:
   - to an encrypted USB stick kept offline, and as an attachment in your password manager;
   - **never** to the VPS, a cloud folder that syncs automatically, e-mail, a chat, a ticket or the repository.

   Without this private key and its passphrase, no backup can be decrypted. Keep two offline copies.
5. **Export the public key.** Right-click → *Export…* → for example `elite-po-staging-backups-public.asc`. This file is
   public. Open it in Notepad: it must start with `-----BEGIN PGP PUBLIC KEY BLOCK-----`. If it says PRIVATE, do not
   use it.
6. **Hand over the public half.** When S12 is authorized, Claude Code runs
   `tools/pc-kit.sh backup-key <the public .asc file> <the fingerprint>`. It refuses a file containing a private key and
   a fingerprint that does not belong to the key. You compare the fingerprint the VPS prints with Kleopatra's.

## B. The off-host storage (Backblaze B2)

1. **Account.** Create a Backblaze account (B2 Cloud Storage) with a strong unique password, and **turn on two-factor
   authentication**.
2. **Caps & Alerts (billing protection).** In *Caps & Alerts*, set small daily caps (for example US$1/day) for
   storage, download bandwidth and each transaction class, and turn on the e-mail alerts. The expected cost of the
   fictional staging backups is **US$0** (they stay inside the free 10 GB; the 2026 price is US$6.95 per TB-month
   beyond it). The caps stop a mistake from costing money.
3. **Bucket.** *Buckets → Create a Bucket*:
   - name: unique, without personal data, e.g. `elitepo-staging-bk-<random letters>`;
   - Files in bucket: **Private**;
   - Default encryption: on (server-side; the backups are already encrypted with your key, so this is a second layer);
   - **Object Lock: Enable.** It can be enabled only when the bucket is created.
4. **Default retention.** In the bucket's *Object Lock* settings, set the default retention to **Governance, 14 days**.
   Every uploaded backup is then protected from deletion and change for 14 days, even if the upload key leaked. Only
   your master key could shorten a Governance retention.
5. **Lifecycle.** In *Lifecycle Settings*, choose a custom rule for the prefix `elite-po-staging/`: hide files **15
   days** after upload and delete hidden files **1 day** later. This is compatible with Object Lock: nothing locked can
   be deleted before its 14 days have passed.
6. **The upload key** (restricted; never the master key on the VPS). Use the B2 command-line tool on your PC, so the
   capabilities are exact:
   ```
   b2 account authorize          (your master application key: in your terminal only)
   b2 key create --bucket <bucket name> po07-staging-upload listBuckets,listFiles,writeFiles
   ```
   - No `deleteFiles`, no `readFiles`, no `bypassGovernance`, no retention or legal-hold capability.
   - The uploader never reads an object back. It lists the folder and checks sizes, and it never sends a HEAD or
     GET. So a leaked upload key can neither read, delete nor shorten the retention of any backup (rehearsed in CI
     with a key of exactly these rights).
   - Store the printed `keyID` and `applicationKey` in your password manager. The secret is shown only once.
   - Check with `b2 key list`: the key is restricted to that bucket, with exactly those three capabilities.
   - Optionally, for the restore drill, create a second key, `po07-staging-read`, with `listFiles,readFiles`, kept on
     your PC only. Or download through the B2 web console.
7. **Endpoint.** In the bucket's details, note the S3 endpoint (`s3.<region>.backblazeb2.com`) and the region.

## C. Placing the upload key on the VPS, in your own terminal (never through Claude Code)

When S12 is authorized, open your own session:
```
ssh -t <your VPS alias>      (or the NAT64 form from the private instructions)
set +o history
install -d -m 0700 /etc/elite-po-staging/offsite
umask 077
nano /etc/elite-po-staging/offsite/rclone.conf
```
Type or paste exactly this, with your values:
```
[po07offsite]
type = s3
provider = Other
endpoint = https://s3.<region>.backblazeb2.com
region = <region>
access_key_id = <keyID of po07-staging-upload>
secret_access_key = <applicationKey of po07-staging-upload>
no_check_bucket = true
```
Save, then run:
```
chmod 0600 /etc/elite-po-staging/offsite/rclone.conf
clear && printf '\033[3J'
exit
```
Tell Claude Code only: **"rclone.conf in place; bucket <bucket name>"**. The bucket name is not a secret. The S12 stage
checks the file's owner and mode and its section name only; it never prints it.

## D. The restore drill (before staging acceptance)

1. In the B2 web console, download the newest `po07-staging-<UTC>.tar.gpg` **and** its `.sha256` file from
   `elite-po-staging/`.
2. In **your own** Git Bash terminal on the PC:
   ```
   bash tools/pc-restore-drill.sh <the .tar.gpg file> <its .sha256 file>
   ```
   - It checks the file against its checksum.
   - Kleopatra/GnuPG then asks for **your passphrase** (your prompt).
   - It streams the decrypted backup over your SSH route into the VPS's restore check, which restores it into a
     disposable database and directory, verifies them, and removes them.
   - Nothing decrypted is written to your disk.
3. Tell Claude Code only the result line: `restore drill PASS …` or the STOP line.

## E. Disaster recovery: which owner-held secrets a full restore needs

A backup holds the database and the fictional files. It does **not** hold the env files or the keys. A complete staging
rebuild therefore needs:
- **your GPG private key and passphrase**, to decrypt the backup;
- **the three staging keys you saved at S9b** (`AUTH_SECRET`, `PLATFORM_AUTH_SECRET`, `FIELD_ENCRYPTION_KEYS`):
  - `FIELD_ENCRYPTION_KEYS` is essential: without it, the administrator's TOTP secret and any customer MFA data in the
    backup cannot be decrypted, and MFA must be enrolled again;
  - the other two may be regenerated: sessions end, and the throttle records simply stop matching;
- the administrator password: it is not in any backup; only its hash is, inside the encrypted dump.

You enter the keys into the rebuilt env files yourself, in your own terminal, before the apps start. The restore drill
proves each time that the encrypted fields decrypt with the field key currently in use.
