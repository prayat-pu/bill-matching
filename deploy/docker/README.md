# Running the app with Docker

Three buttons. No terminal knowledge needed.

| | Windows | Linux |
|---|---|---|
| Start | double-click `start.cmd` | `./deploy/docker/start.sh` |
| Stop | double-click `stop.cmd` | `./deploy/docker/stop.sh` |
| See what it is doing | double-click `logs.cmd` | `./deploy/docker/logs.sh` |

## What `start` does

1. Checks Docker is installed **and running**, and says plainly what to fix
   when it is not ("Start Docker Desktop, wait until its icon stops
   animating").
2. Checks `.env` for the Gemini API key. If the file is missing it asks for the
   key once and writes it.
3. `docker compose up -d --build`. The first run builds the image and takes a
   few minutes; after that it is seconds.
4. Waits until the app actually answers — up to two minutes, one dot per
   attempt — rather than claiming success the moment Docker returns.
5. Prints the addresses and, on Windows, opens the browser:

```
  ========================================================
   READY - open this in Chrome
  ========================================================

   this computer:
     http://localhost:40000

   other computers in the office:
     http://10.34.33.186:40000

  ========================================================
   to stop: double-click stop.cmd
  ========================================================
```

Only real network cards are listed. Docker's own adapters (`docker0`, `br-*`,
`vEthernet`, WSL) answer to nothing outside the machine, so printing them would
just send people to a dead link.

## Which address do the other computers use?

`start` prints the recommended one first:

```
   other computers:
     http://192.168.1.50:40000   <-- give this one to the others  (Ethernet)
     http://10.8.0.2:40000       (VPN, try this if the first does not work)
```

A Windows PC has more IPv4 addresses than you would think — Docker, WSL,
Hyper-V, VirtualBox and VPN clients each add one, and none of those reach the
office. The picker drops those adapters and then ranks what is left:
`192.168.*` first (the usual office range), then `10.*`, then `172.16-31.*`,
with `169.254.*` last because a link-local address reaches nothing at all.

Having a default gateway is deliberately **not** the test: a VPN usually owns
the default route while the office LAN sits on the physical card.

To confirm by hand: on another office PC, the first three numbers should match
its own address. `ipconfig` on the host shows the same thing — the adapter
with a "Default Gateway" filled in and an address in the same range as your
colleagues.

If nothing works from another machine, it is the firewall, not the address:

```
netsh advfirewall firewall add rule name="Bill Matching" dir=in action=allow protocol=TCP localport=40000
```

## Things worth knowing

- **Stopping loses a run in flight.** Nothing is stored between runs by design,
  so if someone is half way through a reconciliation, wait for their download.
- **The first start after an update rebuilds the image.** That is normal and
  only happens once per change.
- **Other computers need the port open.** On Windows, once:

  ```
  netsh advfirewall firewall add rule name="Bill Matching" dir=in action=allow protocol=TCP localport=40000
  ```

- **Changing the port**: edit `PORT` and `ports` in `docker-compose.yml`, and
  `set PORT=` at the top of `start.cmd` (or `PORT=` in `start.sh`).

## When it will not start

| What you see | What to do |
|---|---|
| `Docker is not installed, or Docker Desktop is not running` | start Docker Desktop and wait for it to finish starting |
| `.env has no GEMINI_API_KEY` | open `.env` next to `package.json` and put the key on one line |
| `It did not answer in two minutes` | run `logs.cmd` — the real reason is in the last lines |
| the page opens but every bill says `ขาดบิล` | the receipts PDF was read but matched nothing; check the company picker |

## Start it automatically when the machine boots

Docker restarts the container on its own: `docker-compose.yml` sets
`restart: unless-stopped`, so once started it comes back after a reboot or a
crash. You only need `start.cmd` again if someone ran `stop.cmd`.
