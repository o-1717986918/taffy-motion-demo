param(
  [string]$OutputDirectory = "build\desktop",
  [string]$AvatarModelDirectory = $env:TAFFY_AVATAR_MODEL_DIR,
  [string]$VCClientDirectory = $env:TAFFY_VCCLIENT_DIR
)

$ErrorActionPreference = "Stop"
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
if ([string]::IsNullOrWhiteSpace($AvatarModelDirectory) -or [string]::IsNullOrWhiteSpace($VCClientDirectory)) {
  throw "Set TAFFY_AVATAR_MODEL_DIR and TAFFY_VCCLIENT_DIR to local folders containing assets you are allowed to use."
}
$avatarRoot = [IO.Path]::GetFullPath($AvatarModelDirectory)
$vcRoot = [IO.Path]::GetFullPath($VCClientDirectory)

if ([IO.Path]::GetPathRoot($outputRoot) -eq $outputRoot) {
  throw "桌面包输出目录不能是磁盘根目录：$outputRoot"
}
if (!(Test-Path -LiteralPath (Join-Path $vcRoot "main.exe") -PathType Leaf)) {
  throw "未找到 VCClient：$vcRoot"
}
foreach ($manifest in @("desktop\avatar-manifest.json", "desktop\voice-model-manifest.json")) {
  if (!(Test-Path -LiteralPath (Join-Path $projectRoot $manifest) -PathType Leaf)) {
    throw "缺少本地资产清单 $manifest。请从对应的 .example.json 复制并填写自己有权使用的资源。"
  }
}

$outputDrive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($outputRoot).Substring(0, 1))
if ($outputDrive.Free -lt 4GB) {
  throw "输出磁盘至少需要 4 GB 可用空间，当前仅有 $([math]::Round($outputDrive.Free / 1GB, 2)) GB。"
}

$env:TAFFY_DESKTOP_OUTPUT = $outputRoot
$env:TAFFY_AVATAR_MODEL_DIR = $avatarRoot
$env:TAFFY_VCCLIENT_DIR = $vcRoot

Push-Location $projectRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "前端生产构建失败。" }
  & npm.cmd exec electron-builder -- --config electron-builder.config.cjs --win --x64 --dir
  if ($LASTEXITCODE -ne 0) { throw "Electron 桌面封装失败。" }
  Write-Host "桌面包已生成：$(Join-Path $outputRoot 'win-unpacked\TaffyMotion.exe')"
} finally {
  Pop-Location
}
