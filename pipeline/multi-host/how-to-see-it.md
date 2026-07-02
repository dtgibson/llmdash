# Seeing multi-host locally

This walks you through viewing the multi-host dashboard on your own machine. No
prior knowledge of running a dev server is assumed.

## The short version

Multi-host is off until you name your other machines. You do that with one
environment variable, `LLMDASH_HOSTS`, then restart llmdash. Unset, the dashboard
looks exactly as it does today (just this machine).

## Step by step

1. **Open a terminal** in your llmdash project folder.

2. **Find your other machine's tailnet address.** On that other machine, run:
   ```
   tailscale ip -4
   ```
   It prints something like `100.64.0.7`. That machine must also be running
   llmdash (on its default port 8787, unless you changed it).

3. **Start llmdash with that machine in the host list.** Back on this machine:
   ```
   LLMDASH_HOSTS="100.64.0.7=Desktop" npm start
   ```
   - `100.64.0.7` is the other machine's tailnet IP from step 2.
   - `=Desktop` is a friendly name you pick (optional).
   - To add more machines, separate them with commas:
     `LLMDASH_HOSTS="100.64.0.7=Desktop,100.64.0.9:8790=Work laptop"`
     (add `:8790` only if that machine runs llmdash on a non-default port).

   The startup log will confirm it, e.g.:
   `Multi-host: 1 peer configured — this instance issues a read-only GET /api/state
   to 100.64.0.7:8787 …`

4. **Open the dashboard** in your browser:
   ```
   http://localhost:8787
   ```
   (or your machine's tailnet IP, if you're viewing from your phone).

5. **What you should see:**
   - A header that now reads **"2 hosts · updated Ns ago"**.
   - If both machines are on the **same account**, an **"Account limits"** banner at
     the top showing the shared limit gauges **once** (they're identical — the
     account's numbers, not two separate budgets).
   - **One card per machine**, your local machine first and marked **`you`**. Each
     card leads with that machine's **activity** — tokens, sessions, cache rate,
     estimated value — because activity is the genuinely per-machine data.
   - If a machine is **asleep or not running llmdash**, its card shows a plain
     **"… is unreachable"** callout naming the machine and the fix — never a
     stale meter, never made-up zeros. The other machines are unaffected.

6. **To go back to the single-machine view**, just start llmdash without the
   variable:
   ```
   npm start
   ```
   With `LLMDASH_HOSTS` unset, the dashboard is byte-for-byte today's single-host
   view — no host cards, no banner, no changes.

## Trying it without a second machine

If you want to see the multi-host layout but only have one machine handy, you can
run a second llmdash on a different port in another terminal and point at it:

```
# Terminal A — a "second machine" on port 8788
LLMDASH_PORT=8788 npm start

# Terminal B — the main dashboard, aggregating it
LLMDASH_HOSTS="127.0.0.1:8788=Second instance" npm start
```

Then open `http://localhost:8787`. You'll see both instances as hosts. (Because
they read the *same* account limits, they'll collapse into the one "Account
limits" banner — which is exactly the honesty behavior to look for.)
