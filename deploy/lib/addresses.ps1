# Print the addresses other computers should use, best first.
#
# Not every IPv4 on a Windows box is reachable from the office. Docker, WSL,
# Hyper-V, VirtualBox and VPN clients all add adapters, and a machine that
# lost its network hands out a 169.254.x.x that reaches nothing. Having a
# default gateway is not enough either: a VPN usually owns the default route
# while the office LAN sits on the physical card.
#
# So: drop the virtual adapters, then rank by how likely the range is to be
# the office network.
param([int]$Port = 40000)

$virtual = 'Docker|WSL|Hyper-V|vEthernet|VirtualBox|VMware|Loopback|Bluetooth|TAP|TUN|WARP|Tailscale|ZeroTier|WireGuard|VPN|Npcap'

function Get-Rank([string]$ip) {
    if ($ip -like '192.168.*') { return 0 }   # the usual office range
    if ($ip -like '10.*') { return 1 }
    if ($ip -match '^172\.(1[6-9]|2[0-9]|3[01])\.') { return 2 }
    if ($ip -like '169.254.*') { return 9 }   # link-local: never reachable
    return 3
}

$candidates = @()
try {
    $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object {
            $_.IPAddress -ne '127.0.0.1' -and
            $_.InterfaceAlias -notmatch $virtual
        } |
        ForEach-Object {
            [pscustomobject]@{
                IP    = $_.IPAddress
                Alias = $_.InterfaceAlias
                Rank  = Get-Rank $_.IPAddress
            }
        } |
        Sort-Object Rank, IP
} catch {
    # Get-NetIPAddress is missing on very old PowerShell; fall back to ipconfig.
    $candidates = ipconfig |
        Select-String -Pattern 'IPv4.*?:\s*([0-9.]+)' |
        ForEach-Object {
            $ip = $_.Matches[0].Groups[1].Value
            [pscustomobject]@{ IP = $ip; Alias = 'network adapter'; Rank = Get-Rank $ip }
        } |
        Where-Object { $_.IP -ne '127.0.0.1' } |
        Sort-Object Rank, IP
}

if (-not $candidates) {
    Write-Output "     (no network address found - ask IT for this computer's address, then add :$Port)"
    return
}

$first = $true
foreach ($entry in $candidates) {
    if ($first) {
        Write-Output "     http://$($entry.IP):$Port   <-- give this one to the others  ($($entry.Alias))"
        $first = $false
    } else {
        Write-Output "     http://$($entry.IP):$Port   ($($entry.Alias), try this if the first does not work)"
    }
}
