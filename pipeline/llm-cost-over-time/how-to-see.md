## Seeing LLM Cost Over Time locally

1. Open Terminal.

2. Go to the project folder:

   ```sh
   cd /Users/developer/devwork/llmdash
   ```

3. Start the dashboard:

   ```sh
   npm start
   ```

4. Wait until Terminal says `llmdash running at http://0.0.0.0:8787`, then open
   this address in your browser:

   <http://localhost:8787>

5. Scroll past Account limits and Tool details to **Cost analysis**. It defaults
   to **30d** and is labeled **This machine**.

6. Check the four top values. They mean different things and should never be
   added together:

   - **Configured subscription spend** is fixed access you confirmed locally.
   - **API-equivalent · observed cache** estimates the supported recorded work
     at public API token prices with the caching that occurred.
   - **API-equivalent · no cache** reprices those same supported records as if
     input-like cache tokens had used the normal input price.
   - **Cache effect** is No cache minus Observed cache. It is signed and is not a
     provider bill.

7. Select **7d**, **30d**, and **90d**. The summary, Combined/Claude/Codex rows,
   cumulative charts, and evidence details should update together. The Trend
   range above and the Codex insights range should not move.

8. Read the status badges and Evidence notes. **Partial** means the displayed
   amount is known but some local evidence was omitted or lacks an exact
   reviewed rate. **Unavailable** is not zero.

9. If Configured subscription spend says **Unavailable**, create
   `data/subscriptions.json` using the example under **Cost analysis setup** in
   README, replace its example amounts/dates with your actual confirmed access
   periods, and restart the dashboard. llmdash deliberately cannot infer these
   amounts from `Max`, `Pro`, or another plan label.

10. When everything is working, the Combined values equal Claude + Codex, each
    chart ends at the matching summary value, cumulative lines never fall, and
    incomplete evidence is labeled/dashed rather than presented as complete.
