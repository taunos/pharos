# Real Citation Visibility (Dim 6) test, run by Bruno in his own terminal.
# Keys are typed hidden, kept only in this PowerShell session, and cleared at the end.
# Never paste keys into chat or files. Cost: about $0.16 per site (worst case $0.65).
# Needs the local AI proxy running (node tools/report-panel/start-proxy.mjs).
#
# Usage, from F:\pharos:
#   powershell -ExecutionPolicy Bypass -File tools\report-panel\run-dim6-real.ps1 -Sites rachelqueiroz
param([string]$Sites = "rachelqueiroz")

function Read-Secret([string]$name) {
  $s = Read-Host -AsSecureString "Paste $name (hidden)"
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$env:OPENAI_API_KEY     = Read-Secret "OPENAI_API_KEY"
$env:ANTHROPIC_API_KEY  = Read-Secret "ANTHROPIC_API_KEY"
$env:GOOGLE_AI_API_KEY  = Read-Secret "GOOGLE_AI_API_KEY"
$env:PERPLEXITY_API_KEY = Read-Secret "PERPLEXITY_API_KEY"
try {
  node tools/report-panel/run.mjs --only $Sites --dim6 env --no-synthetic-dim6 --out tools/report-panel/out/dim6-real
  node tools/report-panel/check.mjs --out tools/report-panel/out/dim6-real
} finally {
  Remove-Item Env:OPENAI_API_KEY, Env:ANTHROPIC_API_KEY, Env:GOOGLE_AI_API_KEY, Env:PERPLEXITY_API_KEY -ErrorAction SilentlyContinue
  Write-Host "Keys removed from this session. Report: tools\report-panel\out\dim6-real\<site>\report.pdf"
}
