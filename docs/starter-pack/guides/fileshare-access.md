# File Share Access (Samba)

How to connect to the durable file share from Windows and Linux **over Tailscale** (works the same at
home or away).

> **Note:** unlike the rest of this pack, this is a **live operational runbook**, not a portable
> template — the addresses (`100.106.130.121`, `vault`, `pbs1`) are the actual homelab fileshare and
> are meant to be used as-is. Build/design + monitoring detail lives in the vault's own `cr-007`
> record in that project's repo.

> **Last reviewed:** 2026-06-30.

## The share

| | |
|---|---|
| **Address** | `\\100.106.130.121\fileshare` (Windows) · `smb://100.106.130.121/fileshare` (Linux) |
| **Name** | MagicDNS `fileshare` also works (`\\fileshare\fileshare` / `smb://fileshare/fileshare`) if your client has Tailscale MagicDNS; otherwise use the IP `100.106.130.121` |
| **Login** | **Always required** — user `cfbieder` + SMB password (SMB3, **no guest/anonymous**) |
| **Requires** | **Tailscale running + logged in** on your device. Access is **admin-only** (tailnet ACL default-deny) |
| **Durability** | data on `vault`'s 8 TB **ZFS mirror** + nightly client-encrypted PBS backup → `pbs1` |

> Prereq: be connected to the tailnet (Tailscale up on your device). Set/reset the SMB password (admin,
> on `vault`): `ssh root@192.168.1.62 pct exec 111 -- smbpasswd cfbieder`.

## Windows

- **Quick open:** File Explorer → address bar → `\\100.106.130.121\fileshare` → Enter → sign in as
  `cfbieder` + password (tick *Remember my credentials*).
- **Map a drive (persistent):** right-click **This PC → Map network drive** → drive `Z:` → folder
  `\\100.106.130.121\fileshare` → tick *Connect using different credentials* → Finish → `cfbieder` + password.
- **Command line:** `net use Z: \\100.106.130.121\fileshare /user:cfbieder * /persistent:yes`
  (prompts for the password). Disconnect: `net use Z: /delete`.

## Linux

**GUI** (GNOME Files / KDE Dolphin): *Other Locations → Connect to Server* →
`smb://100.106.130.121/fileshare` → user `cfbieder`.

**CLI — one-off mount:**
```bash
sudo apt install -y cifs-utils            # once
sudo mkdir -p /mnt/fileshare
sudo mount -t cifs //100.106.130.121/fileshare /mnt/fileshare \
  -o username=cfbieder,uid=$(id -u),gid=$(id -g),vers=3.0
# prompts for the password; unmount with: sudo umount /mnt/fileshare
```

**CLI — persistent (survives reboot):**
```bash
# 1. root-only credentials file
sudo tee /etc/cifs-fileshare >/dev/null <<'EOF'
username=cfbieder
password=YOUR_SMB_PASSWORD
EOF
sudo chmod 600 /etc/cifs-fileshare

# 2. add to /etc/fstab (adjust uid/gid to your local user, usually 1000)
//100.106.130.121/fileshare  /mnt/fileshare  cifs  credentials=/etc/cifs-fileshare,uid=1000,gid=1000,vers=3.0,_netdev  0  0

# 3. mount it
sudo mkdir -p /mnt/fileshare && sudo mount -a
```

## Troubleshooting

- **Can't reach it** → confirm **Tailscale is connected** on your device, and that the `fileshare` node
  shows online in your tailnet. If the `fileshare` name won't resolve, use the IP `100.106.130.121`
  (MagicDNS isn't enabled on every client). Service health: System Monitor `/network` page → the
  **`smb-fileshare`** node, or the `FileshareSMBDown` alert.
- **Connection refused / protocol error** → SMB1 is disabled by design; use SMB2/3 (`vers=3.0`). Very
  old clients won't connect.
- **Auth fails** → a password is always required; reset it with the `smbpasswd` command above.

## What to store here

It's durable (mirror + encrypted off-box backup), so **trusted / irreplaceable files** are fine here.
Re-downloadable bulk (media, ISOs, scratch) is better placed on `vmhost2`'s cheap tier once it's live —
keep this mirror for what matters.

---

## Appendix — deploying an SSH key to a Windows client (adjacent task)

Not part of the fileshare, but the fileshare is often where the key material lives, so
it's kept here. To install a private key pulled from the share (drive `Z:`) into a Windows
client's SSH config and lock down its permissions:

```powershell
Copy-Item Z:\secrets\linux1 $env:USERPROFILE\.ssh\linux1
icacls "$env:USERPROFILE\.ssh\linux1" /inheritance:r /grant:r "$($env:USERNAME):F"
```

Then add a matching host entry in `~/.ssh/config` (example — substitute your host, IP,
and key name):

```sshconfig
Host <alias>
    HostName <tailscale-ip>
    User cfbieder
    IdentityFile ~/.ssh/linux1
    IdentitiesOnly yes
```

> The `icacls … /inheritance:r /grant:r` step is required — OpenSSH on Windows refuses a
> key file that inherits broad permissions ("unprotected private key file"), so resetting
> inheritance and granting only your user full control is what makes the key usable.
