"""
One-time cloud sync (Python, retry-hardened) — upload the PDF library into
MongoDB Atlas GridFS and seed the collections. Idempotent.

This version retries every operation aggressively because some networks
(campus/shared ISP paths, and free M0 clusters in busy regions) randomly
reject TLS handshakes to Atlas with 'tlsv1 alert internal error'. Small
operations succeed on retry; we simply keep trying until each one sticks.

Usage (from noteversity-backend/):
    set MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/noteversity
    python scripts/sync_cloud.py
"""
import json
import os
import sys
import time

from gridfs import GridFS, errors as gridfs_errors
from pymongo import MongoClient
from pymongo.errors import AutoReconnect, NetworkTimeout, ServerSelectionTimeoutError

BUCKET = "pdfs"  # must match services/storage.js GridFSBucket bucketName
LEGACY_FIELDS = ("passwordHash", "otpHash", "otpExpiresAt")
RETRIES = 10
BACKOFF = 1.5


class Sync:
    def __init__(self, uri):
        self.uri = uri
        self.client = None
        self.db = None

    def connect(self):
        if self.client is not None:
            try:
                self.client.close()
            except Exception:
                pass
        self.client = MongoClient(self.uri, serverSelectionTimeoutMS=15000)
        self.db = self.client.get_default_database()
        self.db.command("ping")
        self.fs = GridFS(self.db, collection=BUCKET)

    def op(self, fn, *args, **kwargs):
        """Run a DB operation, retrying through flaky TLS connections."""
        last = None
        for attempt in range(1, RETRIES + 1):
            try:
                if self.client is None:
                    self.connect()
                return fn(*args, **kwargs)
            except (AutoReconnect, NetworkTimeout, ServerSelectionTimeoutError, OSError) as e:
                last = e
                print(f"      retry {attempt}/{RETRIES}: {str(e).split('(')[0][:70]}")
                time.sleep(BACKOFF * attempt)
                self.connect()
        raise RuntimeError(f"operation kept failing: {last}")


def main():
    uri = os.environ.get("MONGO_URI", "")
    if not uri or "127.0.0.1" in uri:
        print('[!] Set MONGO_URI to your Atlas connection string, e.g.:')
        print('    set MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/noteversity')
        sys.exit(1)

    backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    uploads = os.path.join(backend, "uploads")
    data_dir = os.path.join(backend, "data")

    sync = Sync(uri)
    sync.connect()
    print("Connected to Atlas.")

    # ── 1. Upload every PDF into GridFS (skip existing, retry each) ──
    existing = {f.filename for f in sync.fs.find()}
    pdfs = sorted(f for f in os.listdir(uploads) if f.lower().endswith(".pdf"))
    uploaded = skipped = failed = 0
    for idx, name in enumerate(pdfs, 1):
        if name in existing:
            skipped += 1
            continue
        with open(os.path.join(uploads, name), "rb") as fh:
            data = fh.read()
        try:
            print(f"[{idx}/{len(pdfs)}] {name} ({len(data)//1024} KB) ... ", end="", flush=True)
            sync.op(sync.fs.put, data, filename=name, contentType="application/pdf")
            uploaded += 1
            print("ok")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAILED: {e}")
    print(f"GridFS: {uploaded} uploaded, {skipped} already present, {failed} failed")

    # ── 2. Seed users / notes / pyqs from the local JSON mirrors ──
    # Upserts use natural keys (email / fileUrl) because Atlas may already hold
    # docs with different _ids from an earlier partial run. _id is immutable in
    # replace, so it is stripped and existing ids are kept.
    def load(fname):
        with open(os.path.join(data_dir, fname), encoding="utf-8") as fh:
            return json.load(fh)

    users_local = load("users.json") if os.path.exists(os.path.join(data_dir, "users.json")) else []
    local_email_by_id = {doc["_id"]: doc.get("email", "") for doc in users_local}

    for doc in users_local:
        for legacy in LEGACY_FIELDS:
            doc.pop(legacy, None)
        doc.pop("_id", None)
        if "email" not in doc:
            continue
        sync.op(sync.db["users"].replace_one, {"email": doc["email"]}, doc, upsert=True)
    atlas_id_by_email = {
        d["email"]: d["_id"] for d in sync.op(sync.db["users"].find, {}, {"email": 1})
    }
    print(f"users: {len(atlas_id_by_email)} upserted")

    for fname, coll_name in (("notes.json", "notes"), ("pyqs.json", "pyqs")):
        path = os.path.join(data_dir, fname)
        if not os.path.exists(path):
            print(f"{coll_name}: {fname} missing — skipped")
            continue
        docs = load(fname)
        upserted = 0
        for doc in docs:
            doc.pop("_id", None)
            # Remap uploadedBy to the Atlas user with the same email
            local_uploader = local_email_by_id.get(str(doc.get("uploadedBy", "")))
            atlas_id = atlas_id_by_email.get(local_uploader)
            if not atlas_id:
                atlas_id = atlas_id_by_email.get("faculty@akgec.ac.in")
            doc["uploadedBy"] = atlas_id
            sync.op(sync.db[coll_name].replace_one, {"fileUrl": doc["fileUrl"]}, doc, upsert=True)
            upserted += 1
        print(f"{coll_name}: {upserted} upserted")

    # ── 3. Summary ──
    def count(coll):
        return sync.op(sync.db[coll].count_documents, {})

    print("\n=== Sync complete ===")
    print(f"  users: {count('users')}")
    print(f"  notes: {count('notes')}")
    print(f"  pyqs:  {count('pyqs')}")
    print(f"  PDFs in GridFS: {len(list(sync.fs.find()))}")
    print("\nNext: add MONGO_URI, JWT_SECRET, ADMIN_PASSWORD_HASH, GEMINI_API_KEY in the")
    print("Vercel dashboard and deploy — the app connects to this same database.")
    sync.client.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted — safe to re-run, it resumes where it left off.")
        sys.exit(130)
