#!/usr/bin/env python3
"""
Seed the demo account on a deployed AuraFlow API, over the public API.

Why this exists rather than `php artisan auraflow:seed-demo` on the server: the
seeder is the right tool when you have a shell on the box, and the security group
only admits SSH from one address. This does the same job from anywhere the API is
reachable, using the same endpoints the app itself writes through -- so nothing is
written that a phone could not have written.

The payload is *exported* from a local run of the artisan seeder rather than
regenerated here, so the two can never disagree about what the demo account holds.
Regenerate it with `php artisan auraflow:export-demo-payload <email>`; see README.md.

Dates are rebased on every run: the last night always lands on today. Seed a week
before the demo and re-run it on the morning, and the dashboard is current both
times.

Idempotent, because each endpoint already is:
  * health snapshots upsert on (user, day)
  * exercise sessions return the existing row for a known client_uuid
  * meals have no natural key, so existing ones are read back and skipped by
    (day, name) -- this never deletes a meal it did not write

Usage
-----
    python seed_demo_via_api.py --email test@example.com

The password is never taken from the command line, where it would land in shell
history. In order of preference:
    * typed at the prompt (default)
    * --password-file PATH
    * AURAFLOW_DEMO_PASSWORD in the environment
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, date, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_PAYLOAD = HERE / "demo-payload.json"
DEFAULT_BASE = "https://api.labourlynk.com/api/v1"

# 60 writes a minute is the tightest throttle on the routes used here, so one a
# second is the pace that never trips it. A 429 is still handled, because the
# account may be in use from a phone at the same time.
PACE_SECONDS = 1.05


class ApiError(RuntimeError):
    pass


def request(method: str, url: str, token: str | None = None, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode() or "{}"
            return response.status, json.loads(raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode() or "{}"
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"message": raw[:400]}
        return exc.code, parsed
    except urllib.error.URLError as exc:
        raise ApiError(f"{method} {url}: {exc.reason}") from exc


def write(method: str, url: str, token: str, body: dict, label: str) -> dict:
    """One write, retried once through a rate limit."""
    for attempt in (1, 2):
        status, payload = request(method, url, token, body)

        if status in (200, 201):
            return payload

        if status == 429 and attempt == 1:
            time.sleep(20)
            continue

        raise ApiError(f"{label}: HTTP {status} {json.dumps(payload)[:300]}")

    raise ApiError(f"{label}: rate limited twice")


def rebase(payload: dict) -> dict:
    """Shift every date so the last night lands on today."""
    nights = [datetime.strptime(s["recorded_on"], "%Y-%m-%d").date() for s in payload["snapshots"]]
    offset = (date.today() - max(nights)).days

    if offset == 0:
        return payload

    def shift_date(value: str) -> str:
        return (datetime.strptime(value, "%Y-%m-%d").date() + timedelta(days=offset)).isoformat()

    def shift_stamp(value: str) -> str:
        return (datetime.strptime(value, "%Y-%m-%d %H:%M:%S") + timedelta(days=offset)).strftime("%Y-%m-%d %H:%M:%S")

    for snapshot in payload["snapshots"]:
        snapshot["recorded_on"] = shift_date(snapshot["recorded_on"])
    for meal in payload["meals"]:
        meal["eaten_at"] = shift_stamp(meal["eaten_at"])
    for session in payload["sessions"]:
        session["performed_at"] = shift_stamp(session["performed_at"])
        # The uuid carries the day so a re-seed updates the same session rather
        # than minting a second one beside it.
        session["client_uuid"] = "demo-seed-" + session["performed_at"][:10].replace("-", "")

    print(f"  rebased by {offset:+d} days so the last night is today")
    return payload


def server_now(base: str) -> datetime:
    """
    The API's clock, from the HTTP Date header.

    The local machine's clock is the wrong one to compare against. The application
    runs in UTC and this laptop does not, so a meal at 13:10 that is comfortably in
    the past here is five and a half hours in the future there — and the endpoint
    refuses it. Asking the server what time it thinks it is removes the guess.
    """
    probe = urllib.request.Request(f"{base}/me")
    probe.add_header("Accept", "application/json")

    try:
        # Unauthenticated, so this answers 401 — which carries the Date header just as
        # a 200 would, and costs the server nothing.
        with urllib.request.urlopen(probe, timeout=30) as response:
            header = response.headers["Date"]
    except urllib.error.HTTPError as exc:
        header = exc.headers["Date"]
    except urllib.error.URLError as exc:
        raise ApiError(f"reading the server clock: {exc.reason}") from exc

    if not header:
        raise ApiError("the API sent no Date header, so its clock cannot be read")

    return parsedate_to_datetime(header)


def to_instants(payload: dict, offset: timedelta, now: datetime) -> dict:
    """
    Turn wall-clock strings into ISO 8601 instants carrying an offset, and pull any
    that are still in the future back to just before the server's now.

    The offset is not decoration. `MealController::store` files the day from the
    offset the client sent precisely so a meal eaten at half past midnight lands on
    the day the eater was living in — the app sends "ISO 8601 *with the phone's
    offset*" for that reason, and a seeder that sends a bare wall-clock string would
    have every meal filed against UTC and a Colombo breakfast filed as lunch.

    The clamp is separate and narrower. Both endpoints validate `before_or_equal:now`,
    correctly — a meal logged for tonight is a plan, not a record. But rebasing puts
    today's dinner at 19:30, so seeding in the morning would drop it and the one day
    the presenter demonstrates would be the day missing its meals. Those rows are
    moved back to the minutes before now, in order. Nothing is invented; only the
    clock moves, on rows that were always synthetic.
    """
    tz = timezone(offset)
    clamped = {"meals": 0, "sessions": 0}

    for key, field in (("meals", "eaten_at"), ("sessions", "performed_at")):
        rows = sorted(payload[key], key=lambda row: row[field])
        future = []

        for row in rows:
            local = datetime.strptime(row[field], "%Y-%m-%d %H:%M:%S").replace(tzinfo=tz)
            if local > now:
                future.append(row)
            else:
                row[field] = local.isoformat()

        # Two minutes of clearance, so a slow run cannot drift back into the future
        # between building the body and the server validating it.
        for position, row in enumerate(reversed(future), start=1):
            row[field] = (now - timedelta(minutes=1 + position)).astimezone(tz).isoformat()

        clamped[key] = len(future)

    for key, count in clamped.items():
        if count:
            print(f"  {count} of today's {key} moved back to just before the server's now")

    return payload


def _format_offset(offset: timedelta) -> str:
    total = int(offset.total_seconds())
    sign = '+' if total >= 0 else '-'
    total = abs(total)
    return f"{sign}{total // 3600:02d}:{(total % 3600) // 60:02d}"


def parse_offset(text: str) -> timedelta:
    sign = -1 if text.startswith("-") else 1
    hours, _, minutes = text.lstrip("+-").partition(":")
    return sign * timedelta(hours=int(hours), minutes=int(minutes or 0))


def resolve_password(args: argparse.Namespace) -> str:
    if args.password_file:
        return Path(args.password_file).read_text(encoding="utf-8").strip()
    if os.environ.get("AURAFLOW_DEMO_PASSWORD"):
        return os.environ["AURAFLOW_DEMO_PASSWORD"]
    if not sys.stdin.isatty():
        raise SystemExit(
            "No password available. Run this from a terminal, or pass --password-file, "
            "or set AURAFLOW_DEMO_PASSWORD."
        )
    return getpass.getpass("Password for the demo account: ")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", required=True, help="the demo account to seed")
    parser.add_argument("--base-url", default=DEFAULT_BASE)
    parser.add_argument("--payload", default=str(DEFAULT_PAYLOAD))
    parser.add_argument("--password-file", help="file holding the password; keep it gitignored")
    parser.add_argument(
        "--register-name",
        metavar="NAME",
        help="create the account with this display name if it does not exist yet. "
             "The name is only settable at registration, and it is what the dashboard greets.",
    )
    parser.add_argument(
        "--force-profile",
        action="store_true",
        help="overwrite body-profile fields the account has already set",
    )
    parser.add_argument(
        "--utc-offset",
        default=None,
        metavar="+05:30",
        help="the offset the demo phone lives at, used to file each day. Defaults to this machine's.",
    )
    parser.add_argument("--dry-run", action="store_true", help="log in, report what would change, write nothing")
    args = parser.parse_args()

    payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    base = args.base_url.rstrip("/")

    print(f"API      {base}")
    print(f"Account  {args.email}")

    password = resolve_password(args)
    status, body = request(
        "POST",
        f"{base}/login",
        body={"email": args.email, "password": password, "device_name": "demo-seeder"},
    )

    if status != 200 and args.register_name:
        # `users.name` is only settable at registration — there is no endpoint that
        # renames an account — and the name is what the dashboard greets. So an
        # account that does not exist yet is worth creating here rather than being
        # created on a phone and greeting the room as somebody else.
        #
        # A 422 also means "wrong password for an account that does exist"; that case
        # falls through to a plain "email has already been taken" below, which is the
        # honest thing to report rather than guessing which it was.
        print(f"  no session - registering {args.email} as {args.register_name!r}")
        status, body = request(
            "POST",
            f"{base}/register",
            body={
                "name": args.register_name,
                "email": args.email,
                "password": password,
                # The rule set is `confirmed`, so the field is required even when the
                # caller is a script that typed the password once.
                "password_confirmation": password,
                "device_name": "demo-seeder",
            },
        )
        if status not in (200, 201):
            raise SystemExit(f"Registration failed: HTTP {status} {json.dumps(body)[:300]}")

    if status not in (200, 201):
        raise SystemExit(
            f"Login failed: HTTP {status} {json.dumps(body)[:300]}\n"
            "If the account does not exist yet, re-run with --register-name 'Navod'."
        )

    token = body["data"]["token"]
    print(f"  signed in as {body['data']['user'].get('name', '?')}")

    offset = (parse_offset(args.utc_offset) if args.utc_offset
              else datetime.now().astimezone().utcoffset() or timedelta(0))
    now = server_now(base)
    print(f"  server clock {now.isoformat()}; filing days at UTC{_format_offset(offset)}")
    payload = to_instants(rebase(payload), offset, now)

    # ---------------------------------------------------------------- profile
    status, current = request("GET", f"{base}/profile", token)
    stored = (current.get("data") or {}) if status == 200 else {}
    wanted = {k: v for k, v in payload["profile"].items() if v is not None}

    if args.force_profile:
        changes = wanted
    else:
        # Only fill gaps. Overwriting a height somebody actually entered to make a
        # demo tidier is the tool editing the user's own record behind them.
        changes = {k: v for k, v in wanted.items() if stored.get(k) in (None, "", "unspecified")}

    if changes and not args.dry_run:
        write("PUT", f"{base}/profile", token, changes, "profile")
    print(f"  profile: {len(changes)} field(s) {'to set' if args.dry_run else 'set'}"
          f"{' - nothing missing' if not changes else ''}")

    # ------------------------------------------------------------- snapshots
    print(f"  nights: {len(payload['snapshots'])} (upsert on the day, so re-runs update)")
    if not args.dry_run:
        for index, snapshot in enumerate(payload["snapshots"], 1):
            write("POST", f"{base}/health-snapshots", token, snapshot, f"night {snapshot['recorded_on']}")
            print(f"\r    {index}/{len(payload['snapshots'])}", end="", flush=True)
            time.sleep(PACE_SECONDS)
        print()

    # ----------------------------------------------------------------- meals
    days = sorted({m["eaten_at"][:10] for m in payload["meals"]})
    status, listed = request("GET", f"{base}/meals?from={days[0]}&to={days[-1]}", token)
    already = {(m["eaten_on"], m["name"]) for m in listed.get("data", [])} if status == 200 else set()

    pending = [m for m in payload["meals"] if (m["eaten_at"][:10], m["name"]) not in already]
    print(f"  meals: {len(pending)} to add, {len(payload['meals']) - len(pending)} already present")
    if not args.dry_run:
        for index, meal in enumerate(pending, 1):
            body = {k: v for k, v in meal.items() if v is not None}
            write("POST", f"{base}/meals", token, body, f"meal {meal['name']}")
            print(f"\r    {index}/{len(pending)}", end="", flush=True)
            time.sleep(PACE_SECONDS)
        if pending:
            print()

    # -------------------------------------------------------------- sessions
    print(f"  movement sessions: {len(payload['sessions'])} (idempotent on client_uuid)")
    if not args.dry_run:
        for index, session in enumerate(payload["sessions"], 1):
            body = {k: v for k, v in session.items() if v is not None}
            write("POST", f"{base}/exercise-sessions", token, body, f"session {session['performed_at'][:10]}")
            print(f"\r    {index}/{len(payload['sessions'])}", end="", flush=True)
            time.sleep(PACE_SECONDS)
        print()

    # ------------------------------------------------------------------ plan
    if not args.dry_run:
        plan = write("POST", f"{base}/plan/recalculate", token, {}, "plan")["data"]
        missing = plan.get("basis", {}).get("missing", [])
        print(f"  plan: version {plan['version']} ({plan['source']}), "
              f"{'every formula ran' if not missing else 'missing ' + ', '.join(missing)}")

    if args.dry_run:
        print("\nDry run — nothing was written.")
    else:
        print("\nDone. Open the app once so the queue worker generates today's brief.")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ApiError as error:
        print(f"\nFailed: {error}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
