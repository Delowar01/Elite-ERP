# PO-07 S1–S9b staging kit — PRIVATE VALUES. Never commit; never copy into the public repository.
# Sourced by lib.sh. Contains NO secret: every password and key is generated on the VPS (S4, S7) and never printed.
# shellcheck shell=bash disable=SC2034

KIT_VERSION="po07-s1s9-kit-2"   # kit-2: S6-R (verified external build) replaces the on-VPS build (decision S6-R1)

# ---- approved release (owner, Prompt 7) -------------------------------------------------------------------------
APPROVED_SHA="cf64ebc492b56ad91c28ba3aa7640722935e21c5"
APPROVED_TREE="6403cf5d822df491f6e16a56068ab9d7c2f1f138"   # git rev-parse cf64ebc^{tree}, computed on the PC
REPO_URL="https://github.com/Delowar01/Elite-ERP.git"
REPO_BRANCH="feat/platform-owner"

# ---- execution window (owner) ---------------------------------------------------------------------------------------
# EXPIRED: 23 Nov 2026 18:00–22:00 Saudi time (UTC+3). Set the NEXT window here from the owner's new written
# authorization before `pc-kit.sh update`; every --execute refuses outside the window.
WINDOW_START_UTC="2026-11-23T15:00:00Z"
WINDOW_END_UTC="2026-11-23T19:00:00Z"
# A stage is not STARTED when fewer than this many minutes remain (S6-R: archive checks, extraction, verification).
MIN_MINUTES_LEFT=15
S6_MIN_MINUTES_LEFT=30

# ---- S6-R: the verified external build (owner decision S6-R1, 23 Nov 2026) --------------------------------------------
ARTIFACT_REPO="Delowar01/Elite-ERP"
ARTIFACT_WORKFLOW=".github/workflows/po07-staging-artifact.yml"
ARTIFACT_WORKFLOW_NAME="po07-staging-artifact"
# The reviewed workflow commit(s) whose runs may be installed (space-separated; a run on any other commit is refused).
ARTIFACT_WORKFLOW_COMMITS="33f4024ebec399c7826fdf065a1a57737fd3f54d"   # run 45228504829 (23 Nov 2026), the first fully green run
ARTIFACT_NEXT="16.4.6"
ARTIFACT_NODE="v22.23.2"
INCOMING_DIR="/root/elite-po-kit/incoming"          # root 0700: the transferred archive (kept for audit until acceptance)
EXTRACT_DIR="/srv/elite-po-staging/.s6r-extract"   # app user 0700, created empty by S6-R, removed after the install

# ---- existing services (never changed) ------------------------------------------------------------------------------
ERP_HOST="erp.po07.test"
ERP_UNIT="po07-absent-erp.service"
ERP_USER="po07erp"
ERP_ROOT="/srv/po07-absent-erp"
ERP_PORT="13200"

# ---- staging identities and paths (S0: all free) -------------------------------------------------------------------
ADMIN_HOST="admin.po07.test"
CUST_HOST="customer.po07.test"
APP_USER="po07app"
PG_USER="po07pg"
APP_DIR="/srv/elite-po-staging"
APP_SRC="/srv/elite-po-staging/app"
BUILD_HOME="/srv/elite-po-staging/.build-home"
ETC_DIR="/etc/elite-po-staging"
VAR_DIR="/var/lib/elite-po-staging"
STORAGE_DIR="/var/lib/elite-po-staging/storage"
RUN_DIR="/run/elite-po-staging"
PG_RUN="/run/elite-po-pg"
NS="po07ns"
ADMIN_IN="13310"
CUST_IN="13300"
PG_PORT="15433"
CLUSTER="po07ns"
PG_VER="16"
DB="po07_ci_test_only_"
OWNER_ROLE="po07_owner_test_only_"
APP_ROLE="po07_app_test_only_"
BACKUP_ROLE="po07_backup_test_only_"
NGINX_GROUP="po07web"   # CI: a stand-in web-server group (created by the rehearsal)
CHROMIUM="/usr/bin/google-chrome"
NODE_BIN="/usr/bin/node"

# ---- the on-VPS kit location (root 0700) -----------------------------------------------------------------------------
KIT_DIR="/root/elite-po-kit"
STATE_DIR="/root/elite-po-kit/state"

# ---- thresholds (plan §F/§I; start thresholds proposed in the kit README §5 for owner acceptance) ---------------------
STOP_MEMAVAIL_MB=2560          # §I-5 MemAvailable below 2.5 GiB
STOP_SWAP_GROWTH_MB=256        # §I-5 swap growth within a stage
STOP_LOAD1="1.8"               # §I-5 for 5 minutes
STOP_DISK_FREE_GB=25           # §I-5
START_MEMAVAIL_MB=3584         # start of any stage
START_LOAD1="1.0"
START_DISK_FREE_GB=30

# (S6_START_MEMAVAIL_MB, the on-VPS build's own start threshold, was retired with the build: S6-R uses the normal one.)
# S0 units that start and stop on their own (idle exit / root session manager). Absent later = a note, not a STOP.
ONDEMAND_UNITS="user@0.service fwupd.service udisks2.service polkit.service ModemManager.service"

# ===== CI REHEARSAL VALUES — appended by tools/render-ci.sh. Fictional; GitHub-hosted runner only; never the VPS. =====
WINDOW_START_UTC="2000-01-01T00:00:00Z"
WINDOW_END_UTC="2100-01-01T00:00:00Z"
START_DISK_FREE_GB=8
STOP_DISK_FREE_GB=4
START_LOAD1="8.0"
