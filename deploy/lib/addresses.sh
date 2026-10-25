#!/usr/bin/env bash
# Print the addresses other computers should use, best first.
#
# Not every address on a machine is reachable from the office: Docker bridges,
# WSL, VPN tunnels and link-local addresses all look like IPv4 and none of
# them are what a colleague should type. So candidates are filtered by
# interface, then ranked by how likely the range is to be the office LAN.
#
#   usage: addresses.sh <port>
set -uo pipefail
PORT="${1:-40000}"

VIRTUAL='^(docker|br-|veth|virbr|tun|tap|lo|wg|tailscale|zt|utun|CloudflareWARP)'

rank() {
  case "$1" in
    192.168.*) echo 0 ;;   # the usual office range
    10.*) echo 1 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) echo 2 ;;
    169.254.*) echo 9 ;;   # link-local: never reachable
    *) echo 3 ;;
  esac
}

candidates=$(
  ip -4 -o addr show scope global 2>/dev/null |
    awk -v virt="$VIRTUAL" '$2 !~ virt {split($4,a,"/"); print $2 " " a[1]}'
)

[ -z "$candidates" ] && exit 0

printed=0
while read -r iface ip; do
  [ -z "${ip:-}" ] && continue
  echo "$(rank "$ip") $ip $iface"
done <<< "$candidates" | sort -n | while read -r _ ip iface; do
  if [ "$printed" -eq 0 ]; then
    echo "     http://${ip}:${PORT}   <-- give this one to the others  (${iface})"
    printed=1
  else
    echo "     http://${ip}:${PORT}   (${iface}, try this if the first does not work)"
  fi
done
