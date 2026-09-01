# Deployment

The API runs on one EC2 instance in Sydney. Everything below is reproducible from the AWS
console or CloudShell; nothing here depends on a laptop that happens to be online.

## What exists

> Instance id, Elastic IP and security group id are written as `<INSTANCE_ID>`,
> `<ELASTIC_IP>` and `<SECURITY_GROUP_ID>` here. The repository is public; the real
> values are an SSH target and the rule that admits it, and they belong in the AWS
> console rather than in a file anyone can read.

| | |
|---|---|
| Instance | `<INSTANCE_ID>` — t3.micro, Ubuntu 24.04, ap-southeast-2 |
| Elastic IP | `<ELASTIC_IP>` |
| Security group | `<SECURITY_GROUP_ID>` |
| Domain | `labourlynk.com` and `api.labourlynk.com`, both A records at Namecheap |
| Certificate | Let's Encrypt, both names, renews itself |
| Key pair | `auraflow-deploy` (ed25519). The private half is on the deploy machine only — AWS was given the public half, so it never held the secret. |

```
ssh -i ~/.ssh/auraflow-aws ubuntu@<ELASTIC_IP>
```

### The stack

nginx 1.24 → PHP 8.4 FPM → Laravel, with MariaDB 10.11 bound to `127.0.0.1` and a
systemd queue worker.

**PHP 8.4, not the 8.3 Ubuntu ships.** `composer.json` says `^8.3`, but `composer.lock`
was resolved on a machine running 8.4 and locked packages that require `>=8.4.1`. The
distribution's PHP installs and then refuses the lockfile. 8.4 comes from `ppa:ondrej/php`.

**MariaDB, not SQLite.** `QUEUE_CONNECTION`, `SESSION_DRIVER` and `CACHE_STORE` are all
`database`, so a queue worker polls the same file the web requests write sessions to.
SQLite takes a whole-database lock on write; that combination produces `database is
locked` under no particular load. It is tuned for a box with 911 MB that is also running
four other things — `innodb_buffer_pool_size=128M`, `performance_schema=off` — and there
is a 2 GB swapfile behind it.

**The queue worker is not optional.** `GenerateDailyBrief` is dispatched, not run inline.
Without `auraflow-queue.service` the dashboard waits on a brief that never starts.

```
systemctl status auraflow-queue
journalctl -u auraflow-queue -f
```

## Deploying a change

The repository is private, so the server does not clone it. Push the tree from a
machine that has it:

```sh
cd api
tar czf /tmp/api.tgz \
  --exclude=vendor --exclude=node_modules --exclude=.git \
  --exclude='database/*.sqlite' --exclude='storage/logs/*' \
  --exclude='storage/framework/cache/data/*' --exclude='storage/framework/sessions/*' \
  --exclude='storage/framework/views/*' --exclude=.env --exclude=.phpunit.result.cache .

ssh -i ~/.ssh/auraflow-aws ubuntu@<ELASTIC_IP> 'tar xzf - -C /var/www/auraflow' < /tmp/api.tgz

ssh -i ~/.ssh/auraflow-aws ubuntu@<ELASTIC_IP> 'cd /var/www/auraflow \
  && composer install --no-dev --optimize-autoloader --no-interaction \
  && php artisan migrate --force \
  && php artisan config:cache && php artisan route:cache && php artisan event:cache \
  && sudo systemctl restart auraflow-queue php8.4-fpm'
```

`.env` is excluded on purpose — it holds the database password and the model key, and it
belongs to the server rather than to any checkout. Restarting `php8.4-fpm` is what makes
a new `config:cache` take effect; without it the old cache stays resident.

## The mobile app

`EXPO_PUBLIC_API_URL` must be `https://api.labourlynk.com/api/v1`, and it has to be set in
**two** places for two different reasons:

- `mobile/.env.local` — for `expo start`. Gitignored.
- `mobile/eas.json`, under the build profile's `env` — for EAS. **EAS builds from the git
  tree, so it never sees `.env.local`.** Without it the APK compiles against
  `api-client.ts`'s fallback of `http://localhost:8000/api/v1`, which on a phone is the
  phone. Every screen fails and nothing says why.

It must stay `https`. Android blocks cleartext HTTP by default and the failure is a
connection that never explains itself.

### The lockfile has to be generated without `node_modules` present

`package-lock.json` was missing every non-Windows build of `lightningcss`, so `npm ci` on
EAS's Linux builders installed no native binary, nativewind's Metro config failed to load,
and the bundle step died — while the identical commit bundled fine on Windows.

Regenerating in place does not fix it: npm treats the existing lockfile *and the installed
tree* as the baseline, so a platform pruned out stays pruned. It has to be resolved from
the registry with nothing to read:

```sh
mkdir /tmp/lock && cp mobile/package.json /tmp/lock/
cd /tmp/lock && npm install --package-lock-only
cp package-lock.json <repo>/mobile/package-lock.json
```

Then check the result covers Linux before spending a build on it:

```sh
node -e "const p=require('./package-lock.json').packages;
  console.log(Object.keys(p).filter(k=>k.includes('linux-x64-gnu')))"
```

## Cost

The account is on the post-2025 Free Plan: $100 of credits over six months, and access
stops rather than a bill arriving. Roughly $15/month — about $10.70 compute, $3.60 for the
public IPv4 address, $1.60 for 20 GB of gp3.

**The IPv4 charge does not stop when the instance does.** AWS bills an Elastic IP whether
it is attached or idle, so stopping the instance to save money saves about two thirds of
it. Release the address when the project is finished.

## Known gaps

- **Everything was provisioned as the account root.** Fine for coursework, wrong in
  general; an IAM user with only the permissions used here is the correct arrangement.
- **Mail is not configured.** `MAIL_MAILER` is unset, so password reset codes go to the
  log. SES has a verified domain identity for `labourlynk.com` awaiting its DKIM CNAMEs,
  and a new SES account is confined to a sandbox that can only reach verified addresses
  until production access is granted.
- **No backups.** The database lives on one EBS volume with no snapshot schedule.
- **Deploys are not atomic.** The tar lands over a running application; a request arriving
  mid-extract can see a half-written tree.
