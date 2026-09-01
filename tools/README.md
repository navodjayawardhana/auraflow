# Demo account seeding

The walk-through screens only demonstrate anything if the account behind them has a
history. An account registered on a phone the night before shows empty states
everywhere, and Insights correctly reports that it has nothing to show.

There are two ways to fill one. They write the same data — the API path is generated
by exporting what the artisan path produced.

---

## A · On the server (preferred, when you have SSH)

```sh
ssh -i ~/.ssh/auraflow-aws ubuntu@<ELASTIC_IP>
cd /var/www/auraflow
php artisan auraflow:seed-demo test@example.com
```

| Flag | Effect |
|---|---|
| *(none)* | 30 nights, body profile, derived plan, 14 days of meals, movement history |
| `--timeline-only` | Only rebases the nights; leaves profile, plan, meals and sessions alone |
| `--force-profile` | Overwrites body-profile fields the account has already set |

Idempotent: nights upsert on the day, meals key on (day, name), sessions on
`client_uuid`. Re-running updates in place and never deletes a row it did not write.

> ⚠️ **The security group admits SSH from one address.** If `ssh` times out, the
> instance is fine (check `https://labourlynk.com` — it answers 200); your public IP
> has changed. Add it to `<SECURITY_GROUP_ID>` inbound on port 22, or use EC2
> Instance Connect / CloudShell from the AWS console.

## B · Over the public API (works from anywhere)

Writes through the same endpoints the app itself uses, so nothing lands that a phone
could not have written.

```sh
cd auraflow/tools
python seed_demo_via_api.py --email test@example.com
# password is prompted for; never passed on the command line
```

| Flag | Effect |
|---|---|
| `--dry-run` | Signs in, reports what would change, writes nothing |
| `--register-name 'Navod'` | Creates the account if it does not exist, with that display name |
| `--base-url` | Defaults to `https://api.labourlynk.com/api/v1` |
| `--password-file PATH` | Read the password from a file instead of the prompt |
| `--force-profile` | Overwrite body-profile fields already set |

**`users.name` is only settable at registration.** There is no endpoint that renames
an account, and the name is what the dashboard greets — "Hello, Navod". If the demo
account already exists under the wrong name, changing it needs path A.

### Regenerating the payload

`demo-payload.json` is exported from a local seeded account, so the two paths cannot
disagree about what the demo holds:

```sh
cd auraflow/api
php artisan migrate --force
php artisan db:seed --force                       # creates the local account and seeds it
php artisan auraflow:export-demo-payload test@example.com
```

---

## What gets seeded

| | |
|---|---|
| **30 nights** | sleep, deep/REM stages, resting heart rate (overnight), steps, water |
| **Body profile** | date of birth, sex, height, weight, activity level |
| **Plan** | derived through `RecalculatePlanUseCase` — not hand-written numbers, so it matches what the app would compute. Check `basis.missing` is empty. |
| **14 days of meals** | breakfast, lunch, dinner, a snack on most days; sources mixed across `photo`, `estimate` and `lookup` so the "looked-up values are marked apart from your own estimates" point has something to point at |
| **7 movement sessions** | intensity read off the day's *real* recovery score, so the history shows the gating: full ≥ 70, reduced ≥ 50, mobility below. Guided sessions carry no form count — nothing observed them. |

**Not seeded: the daily brief.** It is written by a queued job calling the model, and
a hand-written row would put advice on the dashboard that nothing generated — the one
screen whose whole claim is that the text came from the user's own figures. Open the
app once before the demo and let the queue worker produce it.

**Dates rebase to today on every run.** Seed a week early and re-run on the morning of
the demo; both times the dashboard is current. This is why the seeding is worth
re-running rather than doing once.

## Honesty

Everything written here is synthetic and says so in its own source metadata. It exists
so the screens have something plausible to draw. It is never a measurement, and it never
reaches training — `ml/provenance.py` and `test_no_synthetic_in_training.py` enforce
that separately and independently of anything in this directory.
