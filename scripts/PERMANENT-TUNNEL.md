# Permanent public URL (named Cloudflare Tunnel)

Quick tunnels (`*.trycloudflare.com`) change every time `cloudflared`
restarts. For a URL that never changes you need:

1. A free Cloudflare account.
2. A domain added to Cloudflare DNS (e.g. `yourproject.org`).
3. A named tunnel pointing to `http://localhost:3000`.

Example stable URL: `https://lexa.yourdomain.com`

## One-time setup (PowerShell)

1. Install cloudflared:

   ```powershell
   winget install Cloudflare.cloudflared
   ```

2. Log in (opens a browser):

   ```powershell
   cloudflared tunnel login
   ```

3. Create a named tunnel and note the UUID it prints:

   ```powershell
   cloudflared tunnel create lexa
   ```

4. Route DNS:

   ```powershell
   cloudflared tunnel route dns lexa lexa.YOUR_DOMAIN
   ```

5. Create `%USERPROFILE%\.cloudflared\config.yml`:

   ```yaml
   tunnel: TUNNEL_UUID
   credentials-file: C:\Users\YOU\.cloudflared\TUNNEL_UUID.json

   ingress:
     - hostname: lexa.YOUR_DOMAIN
       service: http://localhost:3000
     - service: http_status:404
   ```

6. Set `AUTH_URL` in `.env.local`:

   ```
   AUTH_URL=https://lexa.YOUR_DOMAIN
   ```

7. Run the tunnel (or install it as a Windows service):

   ```powershell
   cloudflared tunnel run lexa
   # optional, start on boot:
   cloudflared service install
   ```

8. Restart the app so `AUTH_URL` is picked up:

   ```powershell
   scripts\start-stack-keep-url.ps1
   ```
