param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$allowedEmails = @(
    "vitorhsanchesz@gmail.com",
    "110067551+vitorhsanches@users.noreply.github.com"
)

$currentBranch = git branch --show-current
$currentEmail = git config user.email
$currentName = git config user.name

if ($currentBranch -ne "main") {
    Write-Error "Você não está na branch main. Branch atual: $currentBranch"
    exit 1
}

if ($allowedEmails -notcontains $currentEmail) {
    Write-Error "E-mail do Git não está correto para contar no GitHub: $currentEmail"
    exit 1
}

if ($currentName -ne "vitorhsanches") {
    Write-Error "Nome do Git não está correto: $currentName"
    exit 1
}

$changedFiles = git status --short

if (-not $changedFiles) {
    Write-Host "Nenhuma alteração para commitar."
    exit 0
}

New-Item -ItemType Directory -Force -Path "docs" | Out-Null

$devlogPath = "docs/devlog.md"

if (!(Test-Path $devlogPath)) {
    "# Fina Sync Devlog`n" | Set-Content -Path $devlogPath -Encoding utf8
}

$date = Get-Date -Format "yyyy-MM-dd HH:mm"

Add-Content -Path $devlogPath -Value "`n## $date`n- $Message`n" -Encoding utf8
Add-Content -Path $devlogPath -Value "Changed files:" -Encoding utf8

$changedFiles | ForEach-Object {
    Add-Content -Path $devlogPath -Value "- $_" -Encoding utf8
}

git add .
git commit -m "$Message"

if ($LASTEXITCODE -ne 0) {
    Write-Error "Falha ao criar commit."
    exit 1
}

git push origin main

if ($LASTEXITCODE -ne 0) {
    Write-Error "Falha ao fazer push."
    exit 1
}

Write-Host ""
Write-Host "Último commit enviado:"
git log -1 --pretty=format:"%h %an <%ae> - %s"
