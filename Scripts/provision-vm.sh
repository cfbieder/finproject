#!/usr/bin/env bash
#
# provision-vm.sh — Create the 'fin' KVM guest on vmhost (192.168.1.61)
#
# All images are stored in /mnt/vm-ssd (the vm-ssd libvirt storage pool).
# Uses virsh volume management (no sudo required — user must be in libvirt group).
# Nothing goes in /tmp.
#
# Usage:  scp to KVM host and run, OR:
#   ssh cfbieder@192.168.1.61 'bash -s' < provision-vm.sh
#
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────
VM_NAME="fin"
VCPUS=2
RAM_MB=4096
DISK_GB=40
STATIC_IP="192.168.1.82"
GATEWAY="192.168.1.1"
DNS="192.168.1.1"
BRIDGE="br0"
POOL="vm-ssd"
POOL_DIR="/mnt/vm-ssd"
VIRSH="virsh --connect qemu:///system"

CLOUD_IMG_URL="https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
BASE_VOL="${VM_NAME}-base.qcow2"
DISK_VOL="${VM_NAME}.qcow2"
SEED_VOL="${VM_NAME}-seed.iso"
STAGING_DIR="${HOME}/vm-staging"

USERNAME="cfbieder"

# ── Preflight checks ──────────────────────────────────────────────────
echo "==> Preflight checks"

if $VIRSH dominfo "$VM_NAME" &>/dev/null; then
    echo "ERROR: VM '$VM_NAME' already exists. Remove it first:"
    echo "  $VIRSH destroy $VM_NAME"
    echo "  $VIRSH undefine $VM_NAME --remove-all-storage"
    exit 1
fi

$VIRSH pool-info "$POOL" &>/dev/null || { echo "ERROR: Pool '$POOL' not found"; exit 1; }

mkdir -p "$STAGING_DIR"

# ── Generate SSH key on KVM host if needed ─────────────────────────────
if [ ! -f "$HOME/.ssh/id_ed25519" ]; then
    echo "==> Generating SSH keypair on KVM host"
    ssh-keygen -t ed25519 -f "$HOME/.ssh/id_ed25519" -N "" -C "${USERNAME}@vmhost"
fi
HOST_PUBKEY=$(cat "$HOME/.ssh/id_ed25519.pub")

# Also include the dev machine's key (from authorized_keys)
DEV_PUBKEY=""
if [ -f "$HOME/.ssh/authorized_keys" ]; then
    DEV_PUBKEY=$(cat "$HOME/.ssh/authorized_keys")
fi

# ── Download cloud image to staging ───────────────────────────────────
STAGING_IMG="${STAGING_DIR}/${BASE_VOL}"
if [ ! -f "$STAGING_IMG" ]; then
    echo "==> Downloading Ubuntu 24.04 cloud image..."
    wget -q --show-progress -O "$STAGING_IMG" "$CLOUD_IMG_URL"
    echo "==> Download complete: $(du -h "$STAGING_IMG" | cut -f1)"
else
    echo "==> Cloud image already downloaded: ${STAGING_IMG}"
fi

# ── Upload base image to libvirt pool ─────────────────────────────────
IMG_SIZE=$(stat --format="%s" "$STAGING_IMG")
echo "==> Creating base volume in pool '${POOL}' (${IMG_SIZE} bytes)"

if ! $VIRSH vol-info "$BASE_VOL" "$POOL" &>/dev/null; then
    $VIRSH vol-create-as "$POOL" "$BASE_VOL" "$IMG_SIZE" --format qcow2
    echo "==> Uploading cloud image to pool..."
    $VIRSH vol-upload "$BASE_VOL" "$STAGING_IMG" --pool "$POOL"
    echo "==> Base image uploaded to pool"
else
    echo "==> Base volume already exists in pool"
fi

# ── Create overlay disk via libvirt ───────────────────────────────────
echo "==> Creating ${DISK_GB}GB overlay disk: ${DISK_VOL}"

# Create overlay qcow2 with backing file using vol-create with XML
DISK_BYTES=$((DISK_GB * 1024 * 1024 * 1024))
$VIRSH vol-create "$POOL" /dev/stdin <<VOLXML
<volume type='file'>
  <name>${DISK_VOL}</name>
  <capacity unit='bytes'>${DISK_BYTES}</capacity>
  <target>
    <format type='qcow2'/>
  </target>
  <backingStore>
    <path>${POOL_DIR}/${BASE_VOL}</path>
    <format type='qcow2'/>
  </backingStore>
</volume>
VOLXML

echo "==> Overlay disk created"

# ── Create cloud-init config ──────────────────────────────────────────
echo "==> Creating cloud-init configuration"

cat > "${STAGING_DIR}/user-data" << 'USERDATA_EOF'
#cloud-config
hostname: fin
manage_etc_hosts: true
locale: en_US.UTF-8
timezone: America/New_York

users:
  - name: cfbieder
    gecos: Chris Bieder
    groups: [sudo, docker]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: true
    ssh_authorized_keys:
USERDATA_EOF

# Append SSH keys dynamically
echo "      - ${HOST_PUBKEY}" >> "${STAGING_DIR}/user-data"
if [ -n "$DEV_PUBKEY" ]; then
    while IFS= read -r key; do
        [ -n "$key" ] && echo "      - ${key}" >> "${STAGING_DIR}/user-data"
    done <<< "$DEV_PUBKEY"
fi

cat >> "${STAGING_DIR}/user-data" << 'USERDATA2_EOF'

package_update: true
package_upgrade: true
packages:
  - ca-certificates
  - curl
  - gnupg
  - git
  - qemu-guest-agent

runcmd:
  # Install Docker (official method)
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  - chmod a+r /etc/apt/keyrings/docker.asc
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  - apt-get update
  - apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  - systemctl enable --now docker
  - usermod -aG docker cfbieder
  # Enable guest agent
  - systemctl enable --now qemu-guest-agent

power_state:
  mode: reboot
  message: "Cloud-init complete, rebooting"
  timeout: 30
  condition: true
USERDATA2_EOF

cat > "${STAGING_DIR}/network-config" << NETEOF
version: 2
ethernets:
  enp1s0:
    dhcp4: false
    addresses:
      - ${STATIC_IP}/24
    routes:
      - to: default
        via: ${GATEWAY}
    nameservers:
      addresses:
        - ${DNS}
        - 8.8.8.8
NETEOF

cat > "${STAGING_DIR}/meta-data" << METAEOF
instance-id: ${VM_NAME}-$(date +%s)
local-hostname: ${VM_NAME}
METAEOF

# ── Build cloud-init ISO in staging, then upload to pool ──────────────
STAGING_ISO="${STAGING_DIR}/${SEED_VOL}"
echo "==> Building cloud-init seed ISO"
cloud-localds -v --network-config="${STAGING_DIR}/network-config" \
    "$STAGING_ISO" \
    "${STAGING_DIR}/user-data" \
    "${STAGING_DIR}/meta-data"

ISO_SIZE=$(stat --format="%s" "$STAGING_ISO")
echo "==> Uploading seed ISO to pool (${ISO_SIZE} bytes)"

if $VIRSH vol-info "$SEED_VOL" "$POOL" &>/dev/null; then
    $VIRSH vol-delete "$SEED_VOL" --pool "$POOL"
fi
$VIRSH vol-create-as "$POOL" "$SEED_VOL" "$ISO_SIZE" --format raw
$VIRSH vol-upload "$SEED_VOL" "$STAGING_ISO" --pool "$POOL"
echo "==> Seed ISO uploaded to pool"

# ── Clean up staging area ─────────────────────────────────────────────
rm -rf "$STAGING_DIR"
echo "==> Staging directory cleaned up"

# ── Create VM ─────────────────────────────────────────────────────────
echo "==> Creating VM '${VM_NAME}'"
virt-install \
    --connect qemu:///system \
    --name "$VM_NAME" \
    --vcpus "$VCPUS" \
    --memory "$RAM_MB" \
    --os-variant ubuntu24.04 \
    --disk "vol=${POOL}/${DISK_VOL},bus=virtio" \
    --disk "vol=${POOL}/${SEED_VOL},device=cdrom" \
    --network "bridge=${BRIDGE},model=virtio" \
    --channel unix,target.type=virtio,target.name=org.qemu.guest_agent.0 \
    --graphics none \
    --console pty,target_type=serial \
    --noautoconsole \
    --boot hd \
    --cpu host-passthrough \
    --import

# ── Enable autostart ──────────────────────────────────────────────────
echo "==> Enabling autostart for '${VM_NAME}'"
$VIRSH autostart "$VM_NAME"

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "  VM '${VM_NAME}' created successfully!"
echo "=========================================="
echo ""
echo "  Storage (all in pool '${POOL}' → ${POOL_DIR}):"
$VIRSH vol-list "$POOL" | grep "$VM_NAME"
echo ""
echo "  Specs: ${VCPUS} vCPUs, ${RAM_MB}MB RAM"
echo "  IP:    ${STATIC_IP} (static, bridged via ${BRIDGE})"
echo "  User:  ${USERNAME} (sudo, SSH key auth)"
echo ""
echo "  The VM is now booting and running cloud-init."
echo "  It will reboot once after initial setup."
echo "  Wait ~3-5 minutes, then:"
echo ""
echo "    ssh ${USERNAME}@${STATIC_IP}"
echo ""
echo "  To check cloud-init progress (from VM console):"
echo "    $VIRSH console ${VM_NAME}"
echo "    (Ctrl+] to detach)"
echo "=========================================="
