$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$portableJava = Get-ChildItem -LiteralPath (Join-Path $root 'local_ai_worker\runtime\jdk21') `
  -Recurse -Filter java.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\bin\\java\.exe$' } |
  Select-Object -First 1

if ($portableJava) {
  $env:JAVA_HOME = Split-Path (Split-Path $portableJava.FullName)
  $env:Path = "$env:JAVA_HOME\bin;$env:Path"
}

$major = 21
if (-not $portableJava) {
  $versionOutput = (cmd /c "java -version 2>&1" | Out-String)
  if ($versionOutput -notmatch 'version "(\d+)') {
    throw 'Java tidak ditemukan. Firebase Emulator membutuhkan JDK 21 atau lebih baru.'
  }
  $major = [int]$Matches[1]
}

if ($major -lt 21) {
  throw "Java $major terdeteksi. Firebase Emulator membutuhkan JDK 21 atau lebih baru."
}

Push-Location $root
try {
  & firebase emulators:exec --only database --project demo 'node --test tests/database-rules.test.mjs'
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
