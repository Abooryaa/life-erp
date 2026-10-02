# Remote access from your phone

LIFE ERP runs on your laptop. Your phone reaches it in one of two ways:

```
                 ┌──────────── your laptop ────────────┐
 Phone on home   │  LIFE ERP  http://0.0.0.0:4600       │
 Wi-Fi  ───────► │     ▲                                │
                 │     │ (local)                        │
 Phone anywhere  │  Tailscale Serve  https://…ts.net    │
 (4G, office) ──►│  (encrypted WireGuard tunnel)        │
                 └──────────────────────────────────────┘
```

1. **Home Wi-Fi (LAN)**: `http://<laptop-ip>:4600`. Works without internet. Settings → Remote access shows the exact address.
2. **Anywhere: Tailscale** (recommended). A free, private, encrypted network between *your own* devices. Your phone gets a real HTTPS address like `https://my-laptop.tail1234.ts.net` that only your devices can reach.

## Why Tailscale

| Option | Verdict |
|---|---|
| **Tailscale** (free Personal plan) | ✅ Chosen. Nothing is exposed to the internet; it works behind Egyptian ISP CGNAT (no port forwarding); it has an Android app; and it provides **free HTTPS certificates**, which the phone needs to install LIFE ERP as an app. |
| Cloudflare Tunnel | Puts the app on the public internet, protected only by its login. A stable address needs your own domain. |
| ngrok / localtunnel | Public URLs, with limits on the free tiers. |
| Self-hosted WireGuard | Needs port forwarding, which CGNAT usually breaks. |
| ZeroTier | Works, but it has no HTTPS certificates, so the app can't be installed on the phone. |

**It needs a free Tailscale account** (sign in with Google, Microsoft or GitHub). The free Personal plan covers this use completely.

> Never turn on **Tailscale Funnel** for LIFE ERP: Funnel publishes a service to the whole internet. `tailscale serve` (below) is private to your devices.

## One-time setup

### 1. On the laptop
1. Download Tailscale for Windows from https://tailscale.com/download and install it.
2. Sign in from the Tailscale tray icon.
3. Open https://login.tailscale.com/admin/dns and make sure **MagicDNS** is on. Under **HTTPS Certificates**, click **Enable HTTPS**.
4. Start LIFE ERP (`npm start`), then open **PowerShell** and run:

   ```powershell
   tailscale serve --bg 4600
   ```

   It prints your private address, for example `https://my-laptop.tail1234.ts.net`. `--bg` keeps it running in the background and it survives restarts. The first HTTPS request can take a few seconds while the certificate is issued.

### 2. On your Android phone
1. Install **Tailscale** from the Play Store and sign in with the **same account**.
2. Turn the Tailscale switch on.
3. Open Chrome and go to the `https://…ts.net` address from step 1.4. Sign in to LIFE ERP.
4. Chrome menu (⋮) → **Add to Home screen** → **Install**. LIFE ERP now opens like an app.

### 3. Turn on two-factor authentication
Settings → Security → Two-factor authentication. Strongly recommended once the phone can reach the laptop from outside.

## Daily use

| Task | How |
|---|---|
| Start LIFE ERP | `npm start` (or let it auto-start at login — see [setup.md](setup.md#auto-start-at-login)) |
| Start remote access | Nothing to do: `tailscale serve --bg` persists. Just keep Tailscale running on the laptop. |
| Use from phone | Tailscale switched on → open the LIFE ERP app icon |
| Stop LIFE ERP | `npm run stop`, or Ctrl+C in its window |
| Stop remote access | `tailscale serve --https=443 off` (or `tailscale serve reset`), or quit Tailscale on the laptop |
| Check remote access | `tailscale serve status` and `tailscale status` |

**The laptop must stay on and awake.** Windows Settings → System → Power → *When plugged in, put my device to sleep after* → **Never**. Control Panel → Power Options → *Choose what closing the lid does* → **Do nothing** (plugged in).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Phone: "Cannot reach LIFE ERP" | Is the laptop awake and online? Is Tailscale on (on **both** devices)? Does `tailscale status` show the phone? |
| `https://…ts.net` doesn't load on the laptop either | Is LIFE ERP running (`http://localhost:4600`)? Run `tailscale serve status`; if it's empty, run `tailscale serve --bg 4600` again. |
| Certificate error / "HTTPS not enabled" | Enable HTTPS certificates in the Tailscale admin DNS page (step 1.3) and wait a minute. |
| No "Install app" option on the phone | Installation needs HTTPS: use the `ts.net` address, not `http://192.168…`. |
| Works at home but not outside | Some phone VPN apps conflict with Tailscale (Android allows one VPN at a time). Disable the other VPN. |
| LAN address doesn't load | On first start Windows asks whether Node.js may use the network. Allow **Private networks** only. To fix it later: Windows Security → Firewall → Allow an app → Node.js → Private. |
| Signed out on the phone | Sessions last 30 days without use. Restoring a backup or changing your password also signs other devices out. |

## Maximum lockdown (optional)

If you only ever use Tailscale, set `LIFE_ERP_LAN=0` in `.env`. LIFE ERP then listens only on `127.0.0.1`; Tailscale Serve still works because it connects locally. On your home Wi-Fi, keep the phone's Tailscale switched on and use the `ts.net` address.
