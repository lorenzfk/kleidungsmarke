# Deploying to Cloudflare Pages

1. **Install dependencies locally**
   ```bash
   npm install
   ```
   This pulls in `@cloudflare/next-on-pages` and `wrangler` which are used to build the Cloudflare bundle.

2. **Authenticate with Cloudflare**
   ```bash
   npx wrangler login
   ```
   This opens a browser window so you can grant Wrangler access to your Cloudflare account.

3. **Build the Cloudflare bundle (optional quick test)**
   ```bash
   npm run pages:build
   npx wrangler pages dev .vercel/output/static
   ```
   The adaptor emits Worker assets into the `.mf` folder and static files under `.vercel/output/static`. The `wrangler pages dev` command lets you smoke-test locally.

4. **Connect the repository to Cloudflare Pages**
   - In the Cloudflare dashboard choose *Pages → Create project → Connect to Git*.
   - Select this repository/branch.
   - Build command: `npm run pages:build`
   - Build output directory: `.vercel/output/static`
   - Add any required env vars (e.g. Shopify tokens, `NEXT_PUBLIC_*`).

5. **Trigger a deployment**
   Pushing to the connected branch will kick off the Pages build pipeline. The output of `npm run pages:build` is uploaded automatically.

### Notes
- The `wrangler.toml` file is used for local development with Wrangler and to configure variables for Pages.
- The `.mf` and `.wrangler` directories are ignored by git. They are recreated every build.
- If you ever need a manual production deploy, you can run `npm run pages:deploy` after `npm run pages:build` and follow the CLI prompts.
