"""Dry-run by default. Explicit authenticated API apply only; never SQL or activation."""
import argparse
import getpass
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", help="Exact Player Hub website origin, not the backend")
    parser.add_argument("--apply-inactive-drafts", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((pathlib.Path(__file__).parent.parent / "docs/missions-starter/manifest.json").read_text())
    if not args.apply_inactive_drafts:
        print(json.dumps(manifest, indent=2))
        print("DRY RUN: no network request, drafts, approvals or payouts.")
        return
    origin = urllib.parse.urlsplit(args.origin or "")
    if origin.username or origin.password or origin.query or origin.fragment or origin.path not in ("", "/") or not origin.hostname:
        sys.exit("Supply an exact website origin without credentials or paths.")
    if origin.scheme != "https" and not (origin.scheme == "http" and origin.hostname in ("localhost", "127.0.0.1")):
        sys.exit("HTTPS is required outside loopback.")
    if not sys.stdin.isatty():
        sys.exit("Interactive terminal required for hidden session input.")
    if input(f"Create only inactive drafts on {origin.netloc}? Type CREATE_INACTIVE_DRAFTS: ") != "CREATE_INACTIVE_DRAFTS":
        sys.exit("Canceled.")
    session = getpass.getpass("Authenticated SUPER_ADMIN cz_session value (hidden): ")
    if not session or any(c in session for c in "\r\n;"):
        sys.exit("Invalid session format.")

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            raise RuntimeError("Redirect rejected; session not forwarded.")

    opener = urllib.request.build_opener(NoRedirect)
    base = urllib.parse.urlunsplit((origin.scheme, origin.netloc, "", "", ""))

    def call(path, body=None):
        request = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), headers={"Cookie": "cz_session=" + session, "Origin": base, "Content-Type": "application/json"})
        with opener.open(request, timeout=60) as response:
            return json.load(response)

    try:
        current = call("/api/admin/missions/starter-manifest")
        if current != manifest:
            sys.exit("Server manifest differs from the reviewed local manifest. No drafts created.")
        result = call("/api/admin/missions/starter-batch", {"batchKey": manifest["batchKey"], "manifestDigest": manifest["manifestDigest"]})
        # Allowlist output; never echo request headers, cookies or server error bodies.
        print(json.dumps({"batchKey": result["batchKey"], "missions": result["missions"], "allInactive": result["allInactive"], "activationPerformed": result["activationPerformed"], "approvalsGranted": result["approvalsGranted"]}, indent=2))
    except urllib.error.HTTPError as error:
        sys.exit(f"API rejected request (HTTP {error.code}). Stop and review; no automatic retry.")
    except Exception:
        sys.exit("API operation failed. Inspect administrator history before retrying; credentials withheld.")


if __name__ == "__main__":
    main()
