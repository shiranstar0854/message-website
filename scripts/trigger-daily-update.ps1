param(
  [string]$Repository = "shiranstar0854/message-website",
  [string]$Workflow = "daily-update.yml",
  [string]$Ref = "main"
)

$ErrorActionPreference = "Stop"

$credentialInput = "protocol=https`nhost=github.com`n`n"
$credential = $credentialInput | git credential fill
$tokenLine = $credential | Where-Object { $_ -like "password=*" } | Select-Object -First 1

if (-not $tokenLine) {
  throw "GitHub credential is unavailable. Sign in with Git Credential Manager before triggering the workflow."
}

$token = $tokenLine.Substring(9)
$headers = @{
  Accept = "application/vnd.github+json"
  Authorization = "Bearer $token"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "message-choose-external-scheduler"
}
$body = @{ ref = $Ref } | ConvertTo-Json -Compress
$uri = "https://api.github.com/repos/$Repository/actions/workflows/$Workflow/dispatches"

Invoke-RestMethod -Method Post -Headers $headers -ContentType "application/json" -Body $body -Uri $uri | Out-Null
Write-Output "Triggered $Workflow on $Repository@$Ref."
